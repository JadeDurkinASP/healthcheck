import express from "express";
import { load } from "cheerio";
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
const TARGET_URL =
  "https://www.icegaming.com/";

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

    const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    url.searchParams.set("url", TARGET_URL);
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
      targetUrl: TARGET_URL,
      requestedUrl: lhr?.requestedUrl,
      finalUrl: lhr?.finalUrl,
      fetchTime: lhr?.fetchTime,
      scores: pickScores(lhr),
      metrics: pickLabMetrics(lhr),
      fieldData: pickFieldData(data),
      opportunities: pickOpportunities(lhr, 8),
      diagnostics: pickDiagnostics(lhr),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }

});

app.post("/api/recommendations", async (req, res) => {
  try {
    const { apiKey, audit } = req.body || {};
    if (!apiKey) return res.status(400).json({ error: "Missing apiKey" });
    if (!audit?.scores) return res.status(400).json({ error: "Missing audit data" });

    const compact = {
      targetUrl: audit.targetUrl,
      finalUrl: audit.finalUrl,
      fetchTime: audit.fetchTime,
      scores: audit.scores,
      metrics: audit.metrics,
    };

    const prompt = `
You are an expert web performance & accessibility auditor.

Given this Lighthouse-style audit summary for ONE page:
- Provide an executive summary (3-5 bullets)
- Provide top 10 recommended actions ranked by impact (each with a why + what to do)
- Split into: Quick wins (same day), Medium (1-3 days), Bigger projects (multi-day)
- Call out likely root causes based on metrics (LCP/CLS/TBT/FCP/Speed Index)
- Suggest how to re-test and what to monitor
Use British spellings. Be specific and practical.
Return as Markdown.
`;

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: "You write concise, high-signal audit recommendations." },
          { role: "user", content: prompt },
          { role: "user", content: JSON.stringify(compact) },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      return res.status(openaiRes.status).json({ error: text });
    }

    const json = await openaiRes.json();

    const text = (json.output || [])
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("\n");

    res.json({ recommendations: text || "No recommendations returned." });
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

  const icatcher = $(".w-icatcher-slider");
  const icatcherSlidesPerCarousel = icatcher
    .map((_, el) => {
      const $el = $(el);
      const track = $el.find(".slick-track").first();
      if (track.length) return track.find(".slick-slide").length;
      // fallback: count slides anywhere inside slider
      return $el.find(".slick-slide").length;
    })
    .get();

  const carousels = {
    count: icatcher.length,
    slidesTotal: icatcherSlidesPerCarousel.reduce((a, b) => a + b, 0),
    slidesPerCarousel: icatcherSlidesPerCarousel,
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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function makeFinding({ key, label, value, severity, points, message, threshold }) {
  return { key, label, value, severity, points, message, threshold };
}

/**
 * Scoring philosophy:
 * - Start at 100
 * - Deduct points for excessive usage
 * - Return score (0-100), plus findings & recs
 *
 * Adjust thresholds anytime.
 */
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

    const r = await fetch(target, {
      redirect: "follow",
      headers: {
        "User-Agent": "ASP-Healthcheck/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!r.ok) {
      return res.status(r.status).json({ error: `Fetch failed: ${r.status}` });
    }

    const html = await r.text();
    const counts = buildAspPerfCounts(html);
    const asp = scoreAspCounts(counts);

    res.json({
      targetUrl: target,
      finalUrl: r.url,
      counts,
      asp,
    });

  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.url}` });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Audit server listening on ${PORT}`);
});

