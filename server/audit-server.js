import express from "express";
import { load } from "cheerio";
import * as chromeLauncher from "chrome-launcher";
import puppeteer from "puppeteer-core";
import cors from "cors";
import "dotenv/config";

process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
  process.exit(1);
});

console.log("PSI_API_KEY loaded:", Boolean(process.env.PSI_API_KEY));

const app = express();

const ALLOWED_ORIGINS = [
  "https://jadedurkinasp.github.io",
  "http://localhost:5173",
];

const PORT = process.env.PORT || 8787;
const TARGET_URL = process.env.TARGET_URL || "";

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // non-browser requests
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

function toAbs(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function fileNameFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const last = u.pathname.split("/").filter(Boolean).pop() || urlStr;
    return decodeURIComponent(last);
  } catch {
    return urlStr;
  }
}

async function getRemoteSizeBytes(url, { timeoutMs = 12000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    // 1) HEAD
    const head = await fetch(url, { method: "HEAD", signal: ac.signal });
    const cl = head.headers.get("content-length");
    if (cl && Number.isFinite(Number(cl))) return Number(cl);

    // 2) Range probe
    const range = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: ac.signal,
    });

    const cr = range.headers.get("content-range"); // bytes 0-0/12345
    if (cr) {
      const total = cr.split("/")[1];
      if (total && Number.isFinite(Number(total))) return Number(total);
    }

    const cl2 = range.headers.get("content-length");
    if (cl2 && Number.isFinite(Number(cl2))) return Number(cl2);

    // 3) last resort: measure what downloaded
    const buf = await range.arrayBuffer();
    return buf.byteLength;
  } finally {
    clearTimeout(t);
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await mapper(items[idx], idx);
      } catch {
        results[idx] = null;
      }
    }
  }

  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results.filter(Boolean);
}

async function getTopImagesForUrls({
  urls,
  topN = 3,
  maxToCheck = 40,
  concurrency = 6,
}) {
  const list = (urls || []).slice(0, maxToCheck);

  const sized = await mapWithConcurrency(list, concurrency, async (url) => {
    const bytes = await getRemoteSizeBytes(url);
    return {
      url,
      name: fileNameFromUrl(url),
      bytes,
      kb: Math.round(bytes / 1024),
      mb: Number((bytes / (1024 * 1024)).toFixed(2)),
    };
  });

  sized.sort((a, b) => b.bytes - a.bytes);
  return sized.slice(0, topN);
}


function to100(v) {
  return typeof v === "number" ? Math.round(v * 100) : null;
}

function pickScores(lhr) {
  const c = lhr?.categories || {};
  return {
    performance: to100(c.performance?.score),
    accessibility: to100(c.accessibility?.score),
    bestPractices: to100(c["best-practices"]?.score),
    seo: to100(c.seo?.score),
  };
}

function pickLabMetrics(lhr) {
  const a = lhr?.audits || {};
  const n = (id) =>
    typeof a[id]?.numericValue === "number" ? a[id].numericValue : null;

  return {
    fcpMs: n("first-contentful-paint"),
    lcpMs: n("largest-contentful-paint"),
    cls: n("cumulative-layout-shift"),
    tbtMs: n("total-blocking-time"),
    siMs: n("speed-index"),
    ttfbMs: n("server-response-time"),
  };
}

function pickFieldData(data) {
  // Prefer page-level CrUX; fallback to origin-level
  const exp = data?.loadingExperience || data?.originLoadingExperience;
  const m = exp?.metrics || {};

  const metric = (key) => {
    const v = m[key];
    if (!v) return null;
    return {
      percentile: v.percentile ?? null,
      // distributions: [{min,max,proportion}, ...]
      distributions: v.distributions ?? null,
      category: v.category ?? null, // "FAST"/"AVERAGE"/"SLOW" etc
    };
  };

  return exp
    ? {
        id: exp.id ?? null,
        lcp: metric("LARGEST_CONTENTFUL_PAINT_MS"),
        inp: metric("INTERACTION_TO_NEXT_PAINT_MS"),
        cls: metric("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
        // optional extras:
        fcp: metric("FIRST_CONTENTFUL_PAINT_MS"),
        ttfb: metric("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
      }
    : null;
}

function pickOpportunities(lhr, limit = 8) {
  const audits = lhr?.audits || {};
  const opps = Object.entries(audits)
    .map(([id, a]) => ({ id, ...a }))
    .filter((a) => a?.details?.type === "opportunity")
    .map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      // savings are commonly in details.overallSavingsMs
      savingsMs: a?.details?.overallSavingsMs ?? null,
    }))
    .sort((a, b) => (b.savingsMs || 0) - (a.savingsMs || 0))
    .slice(0, limit);

  return opps;
}

function pickDiagnostics(lhr) {
  const a = lhr?.audits || {};
  const n = (id) => (typeof a[id]?.numericValue === "number" ? a[id].numericValue : null);

  return {
    // These are numericValue-driven
    totalByteWeight: n("total-byte-weight"),
    domSize: a["dom-size"]?.details ?? null, // dom-size uses details, not just numericValue
    thirdPartySummary: a["third-party-summary"]?.details ?? null,
    resourceSummary: a["resource-summary"]?.details ?? null,
    networkRequests: a["network-requests"]?.details ?? null,
    mainthreadWork: a["mainthread-work-breakdown"]?.details ?? null,
    bootupTime: a["bootup-time"]?.details ?? null,
  };
}

app.get("/api/ping", (req, res) => res.json({ ok: true }));
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/audit", async (req, res) => {
  try {
    const key = process.env.PSI_API_KEY;
    if (!key) return res.status(500).json({ error: "Missing PSI_API_KEY env var" });

    const target = (req.query.url || TARGET_URL || "").toString();
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return res.status(400).json({ error: "Invalid url" });
    }
    if (!parsed.protocol.startsWith("http")) {
      return res.status(400).json({ error: "URL must be http/https" });
    }

    const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    url.searchParams.set("url", target);
    url.searchParams.set("key", key);
    url.searchParams.set("strategy", "desktop");
    url.searchParams.append("category", "performance");
    url.searchParams.append("category", "accessibility");
    url.searchParams.append("category", "best-practices");
    url.searchParams.append("category", "seo");

    const r = await fetch(url.toString());
    const data = await r.json();

    console.log("loadingExperience:", data?.loadingExperience?.id, Boolean(data?.loadingExperience?.metrics));
    console.log("originLoadingExperience:", data?.originLoadingExperience?.id, Boolean(data?.originLoadingExperience?.metrics));

    if (!r.ok) {
      return res.status(r.status).json({
        error: data?.error?.message || JSON.stringify(data),
      });
    }

    const lhr = data?.lighthouseResult;

    // If PSI ever returns a weird/partial payload, fail loudly (helps debugging)
    if (!lhr?.categories) {
      return res.status(500).json({
        error: "No lighthouseResult.categories returned by PSI",
      });
    }

    res.json({
      targetUrl: target,
      requestedUrl: lhr?.requestedUrl,
      finalUrl: lhr?.finalUrl,
      fetchTime: lhr?.fetchTime,
      scores: pickScores(lhr),
      metrics: pickLabMetrics(lhr),
      fieldData: pickFieldData(data),
      opportunities: pickOpportunities(lhr, 8),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

async function getRenderedAspCounts(targetUrl) {
  const chrome = await chromeLauncher.launch({
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
    logLevel: "silent",
  });

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${chrome.port}`,
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36"
    );

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 90000 });

    // Trigger lazy-render / sliders that init on visibility
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const step = Math.floor(window.innerHeight * 0.9);
      for (let i = 0; i < 6; i++) {
        window.scrollBy(0, step);
        await sleep(350);
      }
      window.scrollTo(0, 0);
      await sleep(300);
    });

    const counts = await page.evaluate(() => {
      const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

      const getCarouselRoots = (scope = document) => {
        // Prefer ASP component wrappers as the only “root” per widget
        const aspRoots = [
          ...qsa(".w-icatcher-slider", scope),
          ...qsa(".w-testimonials", scope),
        ];

        const isInsideAspRoot = (el) => aspRoots.some((wrap) => wrap !== el && wrap.contains(el));

        // Generic roots (only if NOT inside ASP wrappers, to avoid double counting)
        const genericRoots = [
          ...qsa(".slick-slider", scope),
          ...qsa(".swiper, .swiper-container", scope),
        ].filter((el) => !isInsideAspRoot(el));

        const combined = Array.from(new Set([...aspRoots, ...genericRoots]));

        // Keep only outermost roots
        return combined.filter((el) => !combined.some((other) => other !== el && other.contains(el)));
      };

      const countSlidesInCarousel = (rootEl) => {
        // -----------------------
        // 1) ASP icatcher (Slick)
        // -----------------------
        if (rootEl.classList.contains("w-icatcher-slider")) {
          // Prefer original items rather than slick’s generated structure
          const items = qsa(".w-icatcher-slider__list__item:not(.slick-cloned)", rootEl);
          if (items.length) return items.length;

          // Fallback to slick-track if needed
          const track = rootEl.querySelector(".slick-track");
          if (track) return qsa(".slick-slide:not(.slick-cloned)", track).length;

          return 0;
        }

        // --------------------------
        // 2) ASP testimonials (Swiper)
        // --------------------------
        if (rootEl.classList.contains("w-testimonials")) {
          const wrapper = rootEl.querySelector(".swiper-wrapper");
          if (!wrapper) return 0;

          const slides = qsa(".swiper-slide", wrapper);

          // Best: count unique real slides via data-swiper-slide-index (handles loop duplicates)
          const indices = slides
            .map((s) => s.getAttribute("data-swiper-slide-index"))
            .filter((v) => v !== null);

          if (indices.length) return new Set(indices).size;

          // Fallback: exclude obvious duplicates if present
          const nonDupes = slides.filter((s) => !s.classList.contains("swiper-slide-duplicate"));
          return nonDupes.length;
        }

        // -----------------------
        // 3) Generic Slick
        // -----------------------
        const slickTrack = rootEl.querySelector(".slick-track");
        if (slickTrack) return qsa(".slick-slide:not(.slick-cloned)", slickTrack).length;

        // -----------------------
        // 4) Generic Swiper
        // -----------------------
        const swiperWrapper = rootEl.querySelector(".swiper-wrapper");
        if (swiperWrapper) {
          const slides = qsa(".swiper-slide", swiperWrapper);

          const indices = slides
            .map((s) => s.getAttribute("data-swiper-slide-index"))
            .filter((v) => v !== null);

          if (indices.length) return new Set(indices).size;

          const nonDupes = slides.filter((s) => !s.classList.contains("swiper-slide-duplicate"));
          return nonDupes.length;
        }

        return 0;
      };

    const detectCarouselType = (rootEl) => {
      if (rootEl.classList.contains("w-icatcher-slider")) return "slick";
      if (rootEl.classList.contains("w-testimonials")) return "swiper";
      if (rootEl.querySelector(".slick-track")) return "slick";
      if (rootEl.querySelector(".swiper-wrapper")) return "swiper";
      return "unknown";
    };


      // -----------------------------
      // SECTION-BY-SECTION BREAKDOWN
      // -----------------------------
      const main = document.querySelector("main") || document;
      const sectionEls = qsa("main .section");

      const sectionBreakdown = sectionEls.map((section, i) => {
        const images = qsa("img", section).length;
        const videos = qsa("video", section).length;
        const iframes = qsa("iframe", section).length;

        // Collect image URLs in this section (unique)
        const imageUrlsSet = new Set();

        qsa("img", section).forEach((img) => {
          // currentSrc is best (accounts for srcset selection)
          const src = img.currentSrc || img.src || img.getAttribute("src");
          if (src) imageUrlsSet.add(src);
        });

        // Also consider <source srcset> inside <picture> (optional, helps)
        qsa("source[srcset]", section).forEach((source) => {
          const srcset = source.getAttribute("srcset");
          if (!srcset) return;

          // pick the last candidate (often biggest)
          const last = srcset
            .split(",")
            .map((s) => s.trim().split(" ")[0])
            .filter(Boolean)
            .pop();

          if (last) imageUrlsSet.add(last);
        });

        const imageUrls = Array.from(imageUrlsSet).slice(0, 60); // cap to avoid massive payloads

        const carouselsInSection = getCarouselRoots(section);

        const carouselBreakdown = carouselsInSection.map((c, idx) => ({
          index: idx + 1,
          type: detectCarouselType(c),
          slides: countSlidesInCarousel(c),
        }));

        const carouselSlidesInSection = carouselBreakdown.reduce((sum, c) => sum + c.slides, 0);

        return {
          index: i + 1,
          id: section.id || null,
          classes: section.className || null,
          images,
          videos,
          iframes,
          imageUrls,
          carousels: carouselsInSection.length,
          carouselSlides: carouselSlidesInSection,
          carouselBreakdown,
        };
      });

      // -----------------------------
      // GLOBAL TOTALS (your original shape, plus sections breakdown)
      // -----------------------------
      const carouselsGlobal = getCarouselRoots(document);
      const slidesPerCarousel = carouselsGlobal.map((el) => countSlidesInCarousel(el));

      const carouselMeta = carouselsGlobal.map((el, idx) => ({
        index: idx + 1,
        slides: countSlidesInCarousel(el),
        type: el.querySelector(".slick-track")
          ? "slick"
          : el.querySelector(".swiper-wrapper")
          ? "swiper"
          : "unknown",
      }));

      

      const testimonials = qsa(".w-testimonials");
      const testimonialsItemsPerBlock = testimonials.map((el) => {
        const wrapper = el.querySelector(".swiper-wrapper");
        if (wrapper) return qsa(".swiper-slide", wrapper).length;

        const slickReal = qsa(".slick-slide:not(.slick-cloned)", el).length;
        const swiper = qsa(".swiper-slide", el).length;
        return Math.max(slickReal, swiper);
      });

      const testimonialsCounts = {
        count: testimonials.length,
        itemsTotal: testimonialsItemsPerBlock.reduce((a, b) => a + b, 0),
        itemsPerBlock: testimonialsItemsPerBlock,
        note: "Rendered DOM count (swiper/slick).",
      };

      const librariesOuterCount = qsa(".js-library-list-outer").length;

      const libraryTypes = {
        news: qsa(".m-libraries-news-list").length,
        products: qsa(".m-libraries-products-list").length,
        video: qsa(".m-libraries-video-list").length,
        sponsor: qsa(".m-libraries-sponsor-list").length,
      };

      const libraryTypesTotal =
        libraryTypes.news +
        libraryTypes.products +
        libraryTypes.video +
        libraryTypes.sponsor;

      const media = {
        images: qsa("img").length,
        videos: qsa("video").length,
        iframes: qsa("iframe").length,
      };

      const adSpace = {
        skyscraperLeft: qsa(".skyscraper-left").length,
        skyscraperRight: qsa(".skyscraper-right").length,
        skyscraperTop: qsa(".skyscraper-top").length,
        skyscraperBottom: qsa(".skyscraper-bottom").length,
      };

      const adSpaceTotal =
        adSpace.skyscraperLeft +
        adSpace.skyscraperRight +
        adSpace.skyscraperTop +
        adSpace.skyscraperBottom;

      return {
        // ✅ sections is now richer, with breakdown
        sections: {
          total: sectionEls.length,
          breakdown: sectionBreakdown,
        },

        carousels: {
          selector: "slick/swiper/w-icatcher-slider",
          count: carouselsGlobal.length,
          slidesPerCarousel,
          slidesTotal: slidesPerCarousel.reduce((a, b) => a + b, 0),
          breakdown: carouselMeta,
          note: "Rendered DOM count (slick/swiper).",
        },

        testimonials: testimonialsCounts,

        libraries: {
          containers: librariesOuterCount,
          types: libraryTypes,
          typesTotal: libraryTypesTotal,
        },

        media,

        adSpace: { ...adSpace, total: adSpaceTotal },
      };
    });

    // ✅ NEW: For each section, compute top 3 largest images by byte size
    if (counts?.sections?.breakdown?.length) {
      const targetBase = targetUrl; // for resolving relative urls if any slip through

      await Promise.all(
        counts.sections.breakdown.map(async (section) => {
          // Ensure absolute urls (currentSrc is usually absolute, but be safe)
          const absUrls = (section.imageUrls || [])
            .map((u) => toAbs(u, targetBase))
            .filter(Boolean);

          const topImages = await getTopImagesForUrls({
            urls: absUrls,
            topN: 3,
            maxToCheck: 40,
            concurrency: 6,
          });

          section.topImages = topImages;

          // Optional: remove raw urls to keep payload smaller
          // delete section.imageUrls;
        })
      );
    }


    await page.close();
    return counts;
  } finally {
    try {
      if (browser) await browser.disconnect();
    } catch {}
    try {
      await chrome.kill();
    } catch {}
  }
}

app.post("/api/recommendations", async (req, res) => {
  try {
    const { apiKey, audit } = req.body || {};
    if (!apiKey || typeof apiKey !== "string") {
      return res.status(400).json({ error: "Missing or invalid apiKey" });
    }
    if (!audit) {
      return res.status(400).json({ error: "Missing audit data" });
    }

    const pageUrl =
      audit.finalUrl || audit.targetUrl || audit.requestedUrl || audit.url;

    if (!pageUrl) {
      return res.status(400).json({ error: "Audit payload missing a URL" });
    }

    // Fetch HTML + extract meta + sample content
    const html = await fetchPageHtml(pageUrl);
    const pageMeta = extractPageMetaAndContent(html);

    // Keep audit summary small (avoid token limit errors)
    const auditSummary = {
      url: pageUrl,
      scores: audit.scores,
      metrics: audit.metrics,
      fieldData: audit.fieldData
        ? {
            id: audit.fieldData.id ?? null,
            lcp: audit.fieldData.lcp
              ? { percentile: audit.fieldData.lcp.percentile ?? null, category: audit.fieldData.lcp.category ?? null }
              : null,
            inp: audit.fieldData.inp
              ? { percentile: audit.fieldData.inp.percentile ?? null, category: audit.fieldData.inp.category ?? null }
              : null,
            cls: audit.fieldData.cls
              ? { percentile: audit.fieldData.cls.percentile ?? null, category: audit.fieldData.cls.category ?? null }
              : null,
          }
        : null,
      opportunities: Array.isArray(audit.opportunities)
        ? audit.opportunities
            .slice()
            .sort((a, b) => (b?.savingsMs || 0) - (a?.savingsMs || 0))
            .slice(0, 6)
            .map((o) => ({ id: o.id, title: o.title, savingsMs: o.savingsMs ?? null }))
        : [],
      diagnostics: audit.diagnostics
        ? {
            totalByteWeight: audit.diagnostics.totalByteWeight ?? null,
          }
        : null,
    };

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          {
            role: "system",
            content:
              "You are a SEO + web performance + accessibility auditor. Use British spellings. Be specific and practical.",
          },
          {
            role: "user",
            content:
              "Given (1) audit summary JSON and (2) page metadata/content sample, produce:\n" +
              "A) Performance/accessibility recommendations (top 8)\n" +
              "B) Keyword recommendations:\n" +
              "   - Existing keywords (if any): comment briefly\n" +
              "   - 12-18 new/expanded keyword suggestions based on the content\n" +
              "   - Group into clusters (e.g. brand, product, intent, long-tail)\n" +
              "   - End with EXACTLY this line format:\n" +
              "     Suggested keywords: kw1, kw2, kw3\n" +
              "C) Optional: improved meta title + meta description suggestions (1 each)\n\n" +
              "Constraints:\n" +
              "- Do not invent facts not implied by the content sample/headings.\n" +
              "- Avoid keyword stuffing.\n\n" +
              `AUDIT:\n${JSON.stringify(auditSummary)}\n\n` +
              `PAGE_META_AND_CONTENT:\n${JSON.stringify(pageMeta)}`,
          },
        ],
      }),
    });

    const raw = await openaiRes.text();
    if (!openaiRes.ok) return res.status(openaiRes.status).send(raw);

    const json = JSON.parse(raw);
    const text = (json.output || [])
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("\n")
      .trim();

      const suggestedKeywords = parseSuggestedKeywords(text);

      return res.json({
        recommendations: text || "No recommendations returned.",
        extracted: pageMeta,
        suggestedKeywords,
      });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});


// helper functions

function parseSuggestedKeywords(text) {
  if (!text) return [];
  const m = text.match(/(?:\*{0,2}\s*)?suggested keywords(?:\s*\*{0,2})?\s*[:\-]\s*(.+)/i);
  const line = (m?.[1] || "").trim();
  if (!line) return [];
  return line.split(",").map(s => s.trim()).filter(Boolean).slice(0, 30);
}

async function fetchPageHtml(url, { timeoutMs = 20000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        // helps avoid some bot blocks
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!r.ok) throw new Error(`Failed to fetch HTML: ${r.status} ${r.statusText}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function normaliseSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function clip(s, max = 1800) {
  const t = normaliseSpace(s);
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function extractPageMetaAndContent(html) {
  const $ = load(html);

  const title = normaliseSpace($("title").first().text());

  const metaDescription = normaliseSpace(
    $('meta[name="description"]').attr("content") || ""
  );

  const metaKeywordsRaw = normaliseSpace(
    $('meta[name="keywords"]').attr("content") || ""
  );

  const metaKeywords = metaKeywordsRaw
    ? metaKeywordsRaw
        .split(",")
        .map((k) => normaliseSpace(k))
        .filter(Boolean)
        .slice(0, 40)
    : [];

  const h1 = normaliseSpace($("h1").first().text());
  const h2s = $("h2")
    .slice(0, 12)
    .map((_, el) => normaliseSpace($(el).text()))
    .get()
    .filter(Boolean);

  // Remove obvious junk before sampling text
  $("script, style, noscript, svg, iframe").remove();

  // Prefer main content if available
  const $main = $("main").first().length ? $("main").first() : $("body");

  // Grab a reasonable amount of page text (avoid token explosions)
  const bodyText = clip($main.text(), 2200);

  return {
    title,
    metaDescription,
    metaKeywords,
    headings: {
      h1: h1 || null,
      h2: h2s,
    },
    contentSample: bodyText || null,
    notes: {
      hasMetaKeywords: metaKeywords.length > 0,
    },
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function makeFinding({ key, label, value, severity, points, message, threshold }) {
  return { key, label, value, severity, points, message, threshold };
}

function minimiseAuditForAI(audit) {
  const opps = Array.isArray(audit.opportunities) ? audit.opportunities : [];

  return {
    url: audit.finalUrl || audit.targetUrl || audit.requestedUrl || null,

    // small + useful
    scores: audit.scores || null,
    metrics: audit.metrics || null,

    // keep only percentiles/categories, ditch distributions
    fieldData: audit.fieldData
      ? {
          id: audit.fieldData.id ?? null,
          lcp: pickFieldMetric(audit.fieldData.lcp),
          inp: pickFieldMetric(audit.fieldData.inp),
          cls: pickFieldMetric(audit.fieldData.cls),
          ttfb: pickFieldMetric(audit.fieldData.ttfb),
        }
      : null,

    // keep top opportunities only
    opportunities: opps
      .slice()
      .sort((a, b) => (b?.savingsMs || 0) - (a?.savingsMs || 0))
      .slice(0, 6)
      .map((o) => ({
        id: o.id,
        title: o.title,
        savingsMs: o.savingsMs ?? null,
      })),

    // diagnostics: keep tiny headline numbers only (no giant tables)
    diagnostics: audit.diagnostics
      ? {
          totalByteWeight: audit.diagnostics.totalByteWeight ?? null,
          // optionally add dom-size numeric if you can extract it
          domSizeSummary: summariseDomSize(audit.diagnostics.domSize),
        }
      : null,
  };
}

function pickFieldMetric(m) {
  if (!m) return null;
  return {
    percentile: m.percentile ?? null,
    category: m.category ?? null,
  };
}

function summariseDomSize(domSizeDetails) {
  // Lighthouse dom-size details are usually a table-like structure
  // Keep it tiny to avoid token bloat.
  try {
    const items = domSizeDetails?.items || domSizeDetails?.details?.items;
    const first = Array.isArray(items) ? items[0] : null;
    // best-effort: return a compact object if present
    if (first && typeof first === "object") {
      return {
        totalElements: first.totalElements ?? null,
        depth: first.maxDepth ?? null,
        width: first.maxChildren ?? null,
      };
    }
  } catch {}
  return null;
}

app.get("/api/asp-recommendations", async (req, res) => {
  try {
    const target = (req.query.url || TARGET_URL || "").toString();

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return res.status(400).json({ error: "Invalid url" });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "URL must be http/https" });
    }

    // ✅ Rendered DOM counts (headless Chrome)
    const counts = await getRenderedAspCounts(target);

    // ✅ Keep your scoring logic unchanged (it expects sections to be a number)
    const normalisedCounts = {
      ...counts,
      sections: counts.sections?.total ?? 0,
    };

    const asp = scoreAspCounts(normalisedCounts);

    res.json({
      targetUrl: target,
      finalUrl: target,
      counts,
      asp,
      mode: "rendered-dom",
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

function countChildren($, parentSel, childSel) {
  const $parents = $(parentSel);
  const perParent = $parents
    .map((_, el) => $(el).find(childSel).length)
    .get();
  return {
    parentCount: $parents.length,
    totalChildren: perParent.reduce((a, b) => a + b, 0),
    childrenPerParent: perParent,
  };
}

function buildAspPerfCounts(html) {
  const $ = load(html);

  const sections = $(".section").length;

// 2) Carousels: .w-icatcher-slider
// Count REAL slides per carousel (ignore slick-cloned)
const icatcher = $(".w-icatcher-slider");

const icatcherSlidesPerCarousel = icatcher
  .map((_, el) => {
    const $el = $(el);

    // Prefer slick-track children (avoids nested sliders)
    const $track = $el.find(".slick-track").first();

    const $slides = $track.length
      ? $track.children(".slick-slide")
      : $el.find(".slick-slide");

    // Exclude cloned slides (slick infinite mode)
    const realSlides = $slides.not(".slick-cloned").length;

    return realSlides;
  })
  .get();

  const carousels = {
    selector: ".w-icatcher-slider",
    count: icatcher.length,
    slidesPerCarousel: icatcherSlidesPerCarousel,
    slidesTotal: icatcherSlidesPerCarousel.reduce((a, b) => a + b, 0),
    note:
    "Counts non-cloned .slick-slide per .w-icatcher-slider (HTML source only).",
  };


  const testimonials = $(".w-testimonials");
  const testimonialsItemsPerBlock = testimonials
    .map((_, el) => {
      const $el = $(el);
      const wrapper = $el.find(".swiper-wrapper").first();
      if (!wrapper.length) {
        // fallback: count inside block
        const slick = $el.find(".slick-slide").length;
        const swiper = $el.find(".swiper-slide").length;
        return Math.max(slick, swiper);
      }
      const slick = wrapper.find(".slick-slide").length;
      const swiper = wrapper.find(".swiper-slide").length;
      return Math.max(slick, swiper);
    })
    .get();

  const testimonialsCounts = {
    count: testimonials.length,
    itemsTotal: testimonialsItemsPerBlock.reduce((a, b) => a + b, 0),
    itemsPerBlock: testimonialsItemsPerBlock,
    note: "Counts .swiper-slide or .slick-slide (whichever is greater) within .swiper-wrapper.",
  };

  // 4) Libraries used on the page
  const librariesOuterCount = $(".js-library-list-outer").length;

  // 5) Library types
  const libraryTypes = {
    news: $(".m-libraries-news-list").length,
    products: $(".m-libraries-products-list").length,
    video: $(".m-libraries-video-list").length,
    sponsor: $(".m-libraries-sponsor-list").length,
  };

  const libraryTypesTotal =
    libraryTypes.news +
    libraryTypes.products +
    libraryTypes.video +
    libraryTypes.sponsor;

  // 6) Media / embeds
  const media = {
    images: $("img").length,
    videos: $("video").length,
    iframes: $("iframe").length,
  };

  // 7) Ad space usage
  const adSpace = {
    skyscraperLeft: $(".skyscraper-left").length,
    skyscraperRight: $(".skyscraper-right").length,
    skyscraperTop: $(".skyscraper-top").length,
    skyscraperBottom: $(".skyscraper-bottom").length,
  };

  const adSpaceTotal =
    adSpace.skyscraperLeft +
    adSpace.skyscraperRight +
    adSpace.skyscraperTop +
    adSpace.skyscraperBottom;

  return {
    sections,
    carousels,
    testimonials: testimonialsCounts,
    libraries: {
      containers: librariesOuterCount,
      types: libraryTypes,
      typesTotal: libraryTypesTotal,
    },
    media,
    adSpace: { ...adSpace, total: adSpaceTotal },
  };
}

function severityFromScore(score) {
  if (score >= 85) return "good";
  if (score >= 65) return "warn";
  return "bad";
}

function scoreAspCounts(counts) {
  const findings = [];
  let score = 100;

  // --- Sections (.section) ---
  // Heavy pages often have too many stacked components.
  if (counts.sections > 24) {
    score -= 18;
    findings.push(
      makeFinding({
        key: "sections",
        label: "Sections (.section)",
        value: counts.sections,
        severity: "bad",
        points: -18,
        threshold: { warnAbove: 16, badAbove: 24 },
        message: "High number of sections can increase DOM complexity and layout work.",
      })
    );
  } else if (counts.sections > 16) {
    score -= 10;
    findings.push(
      makeFinding({
        key: "sections",
        label: "Sections (.section)",
        value: counts.sections,
        severity: "warn",
        points: -10,
        threshold: { warnAbove: 16, badAbove: 24 },
        message: "Consider reducing sections or combining smaller blocks.",
      })
    );
  } else {
    findings.push(
      makeFinding({
        key: "sections",
        label: "Sections (.section)",
        value: counts.sections,
        severity: "good",
        points: 0,
        threshold: { warnAbove: 16, badAbove: 24 },
        message: "Section count looks reasonable.",
      })
    );
  }

  // --- Carousels (.w-icatcher-slider) ---
  // More sliders = more JS, more layout, more images.
  const carouselCount = counts.carousels?.count ?? 0;
  const carouselSlides = counts.carousels?.slidesTotal ?? 0;

  if (carouselCount >= 3) {
    score -= 15;
    findings.push(
      makeFinding({
        key: "carousels",
        label: "Carousels (.w-icatcher-slider)",
        value: `${carouselCount} carousels / ${carouselSlides} slides`,
        severity: "bad",
        points: -15,
        threshold: { warnAbove: 1, badAtOrAbove: 3 },
        message: "Multiple carousels can significantly increase JS and image load.",
      })
    );
  } else if (carouselCount >= 2) {
    score -= 10;
    findings.push(
      makeFinding({
        key: "carousels",
        label: "Carousels (.w-icatcher-slider)",
        value: `${carouselCount} carousels / ${carouselSlides} slides`,
        severity: "warn",
        points: -10,
        threshold: { warnAbove: 1, badAtOrAbove: 3 },
        message: "Limit carousels where possible, and avoid heavy slides above the fold.",
      })
    );
  } else {
    findings.push(
      makeFinding({
        key: "carousels",
        label: "Carousels (.w-icatcher-slider)",
        value: `${carouselCount} carousels / ${carouselSlides} slides`,
        severity: "good",
        points: 0,
        threshold: { warnAbove: 1, badAtOrAbove: 3 },
        message: "Carousel usage looks controlled.",
      })
    );
  }

  // Extra: penalise huge slide counts (even if carouselCount is low)
  if (carouselSlides > 16) {
    score -= 8;
    findings.push(
      makeFinding({
        key: "carouselSlides",
        label: "Carousel slides total",
        value: carouselSlides,
        severity: carouselSlides > 24 ? "bad" : "warn",
        points: -8,
        threshold: { warnAbove: 16, badAbove: 24 },
        message: "Large numbers of slides often means many images and heavy layout work.",
      })
    );
  }

  // --- Testimonials (.w-testimonials) ---
  const testimonialBlocks = counts.testimonials?.count ?? 0;
  const testimonialItems = counts.testimonials?.itemsTotal ?? 0;

  if (testimonialBlocks >= 3 || testimonialItems > 18) {
    score -= 10;
    findings.push(
      makeFinding({
        key: "testimonials",
        label: "Testimonials (.w-testimonials)",
        value: `${testimonialBlocks} blocks / ${testimonialItems} items`,
        severity: "warn",
        points: -10,
        threshold: { warnItemsAbove: 12, badItemsAbove: 18 },
        message: "Consider limiting testimonial items and lazy-loading offscreen content.",
      })
    );
  } else {
    findings.push(
      makeFinding({
        key: "testimonials",
        label: "Testimonials (.w-testimonials)",
        value: `${testimonialBlocks} blocks / ${testimonialItems} items`,
        severity: "good",
        points: 0,
        threshold: { warnItemsAbove: 12, badItemsAbove: 18 },
        message: "Testimonials look fine at a glance.",
      })
    );
  }

  // --- Libraries list containers ---
  const libContainers = counts.libraries?.containers ?? 0;
  const libTypesTotal = counts.libraries?.typesTotal ?? 0;

  if (libContainers > 1 || libTypesTotal >= 3) {
    score -= 10;
    findings.push(
      makeFinding({
        key: "libraries",
        label: "Library components",
        value: `${libContainers} containers / ${libTypesTotal} types`,
        severity: libTypesTotal >= 4 ? "bad" : "warn",
        points: -10,
        threshold: { warnTypesAtOrAbove: 3, badTypesAtOrAbove: 4 },
        message: "Multiple library modules can increase DOM and resource load depending on implementation.",
      })
    );
  } else {
    findings.push(
      makeFinding({
        key: "libraries",
        label: "Library components",
        value: `${libContainers} containers / ${libTypesTotal} types`,
        severity: "good",
        points: 0,
        threshold: { warnTypesAtOrAbove: 3, badTypesAtOrAbove: 4 },
        message: "Library usage looks reasonable.",
      })
    );
  }

  // --- Media ---
  const images = counts.media?.images ?? 0;
  const videos = counts.media?.videos ?? 0;
  const iframes = counts.media?.iframes ?? 0;

  if (images > 60) {
    score -= 12;
    findings.push(
      makeFinding({
        key: "images",
        label: "Images (<img>)",
        value: images,
        severity: images > 90 ? "bad" : "warn",
        points: -12,
        threshold: { warnAbove: 40, badAbove: 60 },
        message: "High image counts can hurt LCP and increase network cost. Ensure compression, sizing, and lazy-loading.",
      })
    );
  } else if (images > 40) {
    score -= 7;
    findings.push(
      makeFinding({
        key: "images",
        label: "Images (<img>)",
        value: images,
        severity: "warn",
        points: -7,
        threshold: { warnAbove: 40, badAbove: 60 },
        message: "Consider reducing image count, using responsive images, and lazy-loading below the fold.",
      })
    );
  } else {
    findings.push(
      makeFinding({
        key: "images",
        label: "Images (<img>)",
        value: images,
        severity: "good",
        points: 0,
        threshold: { warnAbove: 40, badAbove: 60 },
        message: "Image count looks fine.",
      })
    );
  }

  if (videos >= 3) {
    score -= 10;
    findings.push(
      makeFinding({
        key: "videos",
        label: "Videos (<video>)",
        value: videos,
        severity: videos >= 5 ? "bad" : "warn",
        points: -10,
        threshold: { warnAtOrAbove: 3, badAtOrAbove: 5 },
        message: "Multiple videos can be heavy. Use poster images, defer loading, and avoid autoplay.",
      })
    );
  } else {
    findings.push(
      makeFinding({
        key: "videos",
        label: "Videos (<video>)",
        value: videos,
        severity: "good",
        points: 0,
        threshold: { warnAtOrAbove: 3, badAtOrAbove: 5 },
        message: "Video usage looks reasonable.",
      })
    );
  }

  if (iframes >= 4) {
    score -= 15;
    findings.push(
      makeFinding({
        key: "iframes",
        label: "Iframes (<iframe>)",
        value: iframes,
        severity: iframes >= 6 ? "bad" : "warn",
        points: -15,
        threshold: { warnAtOrAbove: 4, badAtOrAbove: 6 },
        message: "Iframes often add third-party JS and can slow down rendering. Defer, lazy-load, and minimise.",
      })
    );
  } else if (iframes >= 2) {
    score -= 8;
    findings.push(
      makeFinding({
        key: "iframes",
        label: "Iframes (<iframe>)",
        value: iframes,
        severity: "warn",
        points: -8,
        threshold: { warnAtOrAbove: 2, badAtOrAbove: 6 },
        message: "Consider lazy-loading iframes and reviewing third-party impact.",
      })
    );
  } else {
    findings.push(
      makeFinding({
        key: "iframes",
        label: "Iframes (<iframe>)",
        value: iframes,
        severity: "good",
        points: 0,
        threshold: { warnAtOrAbove: 2, badAtOrAbove: 6 },
        message: "Iframe usage looks fine.",
      })
    );
  }

  const adTotal = counts.adSpace?.total ?? 0;
  if (adTotal >= 5) {
    score -= 15;
    findings.push(
      makeFinding({
        key: "adSpace",
        label: "Ad slots (skyscrapers)",
        value: adTotal,
        severity: "bad",
        points: -15,
        threshold: { warnAtOrAbove: 3, badAtOrAbove: 5 },
        message: "Lots of ad slots usually means more scripts and requests. Consider reducing or deferring below-the-fold slots.",
      })
    );
  } else if (adTotal >= 3) {
    score -= 8;
    findings.push(
      makeFinding({
        key: "adSpace",
        label: "Ad slots (skyscrapers)",
        value: adTotal,
        severity: "warn",
        points: -8,
        threshold: { warnAtOrAbove: 3, badAtOrAbove: 5 },
        message: "Moderate ad density. Ensure ads are lazy-loaded and do not block rendering.",
      })
    );
  } else {
    findings.push(
      makeFinding({
        key: "adSpace",
        label: "Ad slots (skyscrapers)",
        value: adTotal,
        severity: "good",
        points: 0,
        threshold: { warnAtOrAbove: 3, badAtOrAbove: 5 },
        message: "Ad slot usage looks controlled.",
      })
    );
  }

  score = clamp(score, 0, 100);

  const overall = {
    score,
    severity: severityFromScore(score),
    label: score >= 85 ? "Good" : score >= 65 ? "Needs attention" : "Heavy",
  };

  const recommendations = findings
    .filter((f) => f.severity !== "good")
    .sort((a, b) => a.points - b.points) 
    .map((f) => {
      switch (f.key) {
        case "sections":
          return {
            key: f.key,
            title: "Reduce overall page complexity",
            action:
              "Combine or remove low-value sections, especially below the fold. Consider collapsing repeated blocks into tabs/accordions.",
          };
        case "carousels":
        case "carouselSlides":
          return {
            key: f.key,
            title: "Keep carousels lean",
            action:
              "Limit to 1 carousel per page where possible. Reduce slide count, lazy-load images, and avoid heavy slides above the fold.",
          };
        case "testimonials":
          return {
            key: f.key,
            title: "Trim testimonial payload",
            action:
              "Reduce the number of testimonial items shown initially. Defer additional items or paginate.",
          };
        case "libraries":
          return {
            key: f.key,
            title: "Review library modules",
            action:
              "Avoid rendering multiple library lists at once. Consider loading library content on-demand.",
          };
        case "images":
          return {
            key: f.key,
            title: "Optimise images",
            action:
              "Use responsive images (srcset/sizes), modern formats, compression, and lazy-loading. Ensure LCP image is prioritised.",
          };
        case "videos":
          return {
            key: f.key,
            title: "Defer and optimise videos",
            action:
              "Use poster images, avoid autoplay, and defer loading until interaction or near viewport.",
          };
        case "iframes":
          return {
            key: f.key,
            title: "Minimise third-party embeds",
            action:
              "Lazy-load iframes, remove non-essential embeds, and audit third-party scripts for impact.",
          };
        case "adSpace":
          return {
            key: f.key,
            title: "Reduce ad density",
            action:
              "Limit the number of ad slots on a single page. Ensure ads do not block rendering and are lazy-loaded below the fold.",
          };
        default:
          return {
            key: f.key,
            title: f.label,
            action: f.message,
          };
      }
    });

  return { overall, findings, recommendations };
}

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.url}` });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Audit server listening on ${PORT}`);
});
