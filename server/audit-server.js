import express from "express";
import cors from "cors";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { chromium } from "playwright";

const app = express();
const ALLOWED_ORIGINS = [
  "https://jadedurkinasp.github.io",
  "http://localhost:5173",
];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
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

const PORT = process.env.PORT || 8787;
const TARGET_URL = "https://preview.showoff.asp.events/76D31108-FB34-3E33-C1D9567C544FD7D8/";

function to100(v) {
  return typeof v === "number" ? Math.round(v * 100) : null;
}

function pickScores(lhr) {
  const c = lhr.categories || {};
  return {
    performance: to100(c.performance?.score),
    accessibility: to100(c.accessibility?.score),
    bestPractices: to100(c["best-practices"]?.score),
    seo: to100(c.seo?.score),
  };
}

function pickLabMetrics(lhr) {
  const a = lhr.audits || {};
  const n = (id) => (typeof a[id]?.numericValue === "number" ? a[id].numericValue : null);

  return {
    fcpMs: n("first-contentful-paint"),
    lcpMs: n("largest-contentful-paint"),
    cls: n("cumulative-layout-shift"),
    tbtMs: n("total-blocking-time"),
    siMs: n("speed-index"),
    ttfbMs: n("server-response-time"),
  };
}

app.get("/api/audit", async (req, res) => {
  let chrome;

  try {
    chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    });

    const result = await lighthouse(TARGET_URL, {
      port: chrome.port,
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      logLevel: "error",
    });

    const lhr = result.lhr;

    res.json({
      targetUrl: TARGET_URL,
      requestedUrl: lhr.requestedUrl,
      finalUrl: lhr.finalUrl,
      fetchTime: lhr.fetchTime,
      scores: pickScores(lhr),
      metrics: pickLabMetrics(lhr),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  } finally {
    if (chrome) await chrome.kill();
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

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.url}` });
});

app.listen(PORT, () => {
  //console.log(`Audit server running on http://localhost:${PORT}`);
});
