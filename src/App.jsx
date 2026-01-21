import React, { useMemo, useState } from "react";

// const API_BASE = "https://healthcheck-vdll.onrender.com";
const API_BASE = "http://localhost:8787";
const TARGET_URL = "https://www.icegaming.com/";

function formatMs(ms) {
  if (typeof ms !== "number") return "–";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}
function formatCls(v) {
  return typeof v === "number" ? v.toFixed(3) : "–";
}
function formatKb(bytes) {
  if (typeof bytes !== "number") return "-";
  const kb = bytes / 1024;
  if (kb > 1024) return `${(kb / 1024).toFixed(2)} MB`;
  return `${kb.toFixed(0)} KB`;
}

export default function App() {
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [audit, setAudit] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [openAiKey, setOpenAiKey] = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aspRunning, setAspRunning] = useState(false);
  const [aspError, setAspError] = useState("");
  const [aspData, setAspData] = useState(null);

  // Tabs: "crux" | "opps" | "diag" | "ai"
  const [activeTab, setActiveTab] = useState("crux");

  const scores = useMemo(() => audit?.scores || {}, [audit]);
  const metrics = useMemo(() => audit?.metrics || {}, [audit]);
  const fieldData = useMemo(() => audit?.fieldData || null, [audit]);
  const opportunities = useMemo(() => audit?.opportunities || [], [audit]);
  const diagnostics = useMemo(() => audit?.diagnostics || null, [audit]);

  const hasCrux =
    typeof fieldData?.lcp?.percentile === "number" ||
    typeof fieldData?.inp?.percentile === "number" ||
    typeof fieldData?.cls?.percentile === "number";

  const hasOpportunities = opportunities?.length > 0;
  const hasDiagnostics = Boolean(diagnostics);
  const hasAiText = Boolean(aiText && aiText.trim());

  async function runAudit() {
    setError("");
    setAiText("");
    setStatus("Running audit…");
    setIsRunning(true);

    try {
      const res = await fetch(`${API_BASE}/api/audit`, { cache: "no-store" });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!res.ok) throw new Error(json?.error || text || "Audit failed");

      setAudit(json);
      setStatus("Done");

      // Pick a sensible default tab for the result
      if (
        typeof json?.fieldData?.lcp?.percentile === "number" ||
        typeof json?.fieldData?.inp?.percentile === "number" ||
        typeof json?.fieldData?.cls?.percentile === "number"
      ) {
        setActiveTab("crux");
      } else if (json?.opportunities?.length) {
        setActiveTab("opps");
      } else if (json?.diagnostics) {
        setActiveTab("diag");
      } else {
        setActiveTab("crux");
      }
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("Failed");
    } finally {
      setIsRunning(false);
    }
  }

  async function getRecommendations() {
    setError("");
    setAiText("");
    setAiRunning(true);

    try {
      if (!audit) throw new Error("Run an audit first.");
      if (!openAiKey.trim()) throw new Error("Enter your OpenAI API key.");

      const res = await fetch(`${API_BASE}/api/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: openAiKey.trim(), audit }),
      });

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      if (!res.ok) throw new Error(json?.error || text || "OpenAI request failed");

      setAiText(json?.recommendations || "No recommendations returned.");
      setActiveTab("ai");
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAiRunning(false);
    }
  }

  async function runAspRecommendations() {
    setAspError("");
    setAspRunning(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/asp-recommendations?url=${encodeURIComponent(TARGET_URL)}`,
        { cache: "no-store" }
      );
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }

      if (!res.ok) throw new Error(json?.error || text || "ASP recommendations failed");
      setAspData(json);
    } catch (e) {
      setAspError(e?.message || String(e));
    } finally {
      setAspRunning(false);
    }
  }


  return (
    <div className="container">
      <h1 className="h1">Site Health Dashboard</h1>
      <p className="subtle">
        Locked to audit: <span className="badge">{TARGET_URL}</span>
      </p>

      <div className="panel">
        <div className="grid2">
          <div>
            <label className="label">Target URL</label>
            <input className="input" value={TARGET_URL} readOnly />
          </div>

          <div>
            <label className="label">Actions</label>
            <div className="row">
              <button className="btn" onClick={runAudit} disabled={isRunning}>
                {isRunning ? "Running…" : "Run audit"}
              </button>
              <span className="badge">Status: {status}</span>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="error" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      {audit ? (
        <>
          <div style={{ marginTop: 10 }} className="subtle">
            Final URL: <span className="badge">{audit.finalUrl || "–"}</span>
          </div>

          <div className="grid4" style={{ marginTop: 12 }}>
            <div className="kpi">
              <div className="t">Performance</div>
              <div className="v">{scores.performance ?? "–"}</div>
            </div>
            <div className="kpi">
              <div className="t">Accessibility</div>
              <div className="v">{scores.accessibility ?? "–"}</div>
            </div>
            <div className="kpi">
              <div className="t">Best Practices</div>
              <div className="v">{scores.bestPractices ?? "–"}</div>
            </div>
            <div className="kpi">
              <div className="t">SEO</div>
              <div className="v">{scores.seo ?? "–"}</div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <h2 style={{ margin: "0 0 8px" }}>Key lab metrics</h2>
            <div className="row">
              <span className="badge">FCP: {formatMs(metrics.fcpMs)}</span>
              <span className="badge">LCP: {formatMs(metrics.lcpMs)}</span>
              <span className="badge">CLS: {formatCls(metrics.cls)}</span>
              <span className="badge">TBT: {formatMs(metrics.tbtMs)}</span>
              <span className="badge">Speed Index: {formatMs(metrics.siMs)}</span>
            </div>
          </div>

          {/* Tabbed detail panels (left nav + right content) */}
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="tabsLayout">
              {/* LEFT: Categories */}
              <div className="tabsNav" role="tablist" aria-label="Audit detail tabs">
                <div className="tabsNavTitle">Categories</div>

                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "crux" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "crux"}
                  onClick={() => setActiveTab("crux")}
                >
                  Real user data (CrUX)
                  <span className="tabsNavChevron" aria-hidden="true">›</span>
                </button>

                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "opps" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "opps"}
                  onClick={() => setActiveTab("opps")}
                >
                  Top opportunities
                  <span className="tabsNavChevron" aria-hidden="true">›</span>
                </button>

                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "diag" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "diag"}
                  onClick={() => setActiveTab("diag")}
                >
                  Diagnostics
                  <span className="tabsNavChevron" aria-hidden="true">›</span>
                </button>

                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "ai" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "ai"}
                  onClick={() => setActiveTab("ai")}
                >
                  AI recommendations
                  <span className="tabsNavChevron" aria-hidden="true">›</span>
                </button>
                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "asp" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "asp"}
                  onClick={() => setActiveTab("asp")}
                >
                  ASP recommendations
                  <span className="tabsNavChevron" aria-hidden="true">›</span>
                </button>
              </div>

              {/* RIGHT: Content */}
              <div className="tabsContent" role="region" aria-label="Tab content">
                <div className="tabsContentHeader">
                  <h2 className="tabsContentTitle">
                    {activeTab === "crux" && "Real user data (CrUX)"}
                    {activeTab === "opps" && "Top opportunities"}
                    {activeTab === "diag" && "Diagnostics"}
                    {activeTab === "ai" && "AI recommendations"}
                    {activeTab === "asp" && "ASP recommendations"}
                  </h2>
                </div>
                <div className="tabsContentBody">
                  {activeTab === "crux" ? (
                    <>
                      {hasCrux ? (
                        <>
                          <div className="subtle" style={{ marginBottom: 8 }}>
                            Source: <span className="badge">{fieldData?.id || "–"}</span>
                          </div>

                          <div className="row">
                            <span className="badge">LCP p75: {formatMs(fieldData?.lcp?.percentile)}</span>
                            <span className="badge">INP p75: {formatMs(fieldData?.inp?.percentile)}</span>
                            <span className="badge">CLS p75: {formatCls(fieldData?.cls?.percentile)}</span>
                          </div>

                          <div className="subtle" style={{ marginTop: 8 }}>
                            Field data is a 28-day rolling dataset and may be unavailable for low-traffic pages.
                          </div>
                        </>
                      ) : (
                        <div className="subtle">No CrUX field data available for this URL/origin.</div>
                      )}
                    </>
                  ) : null}

                  {activeTab === "opps" ? (
                    <>
                      <div className="subtle" style={{ marginBottom: 8 }}>
                        Ranked by estimated time saving (lab).
                      </div>

                      {hasOpportunities ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          {opportunities.slice(0, 8).map((o) => (
                            <div key={o.id} className="kpi" style={{ textAlign: "left" }}>
                              <div className="t">
                                {o.title}{" "}
                                <span className="badge" style={{ marginLeft: 8 }}>
                                  Save: {formatMs(o.savingsMs)}
                                </span>
                              </div>
                              {o.description ? <div className="subtle">{o.description}</div> : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="subtle">No opportunities returned for this run.</div>
                      )}
                    </>
                  ) : null}

                  {activeTab === "diag" ? (
                    <>

                      {hasDiagnostics ? (
                        <>
                          <div className="row">
                            <span className="badge">Total byte weight: {formatKb(diagnostics?.totalByteWeight)}</span>
                          </div>

                          <div className="subtle" style={{ marginTop: 8 }}>
                            Tip: DOM size, third-party impact, and main-thread work are great signals for “too much stuff on one page”.
                          </div>
                        </>
                      ) : (
                        <div className="subtle">No diagnostics returned for this run.</div>
                      )}
                    </>
                  ) : null}

                  {activeTab === "ai" ? (
                    <>
                      <div className="grid2">
                        <div>
                          <label className="label">OpenAI API key (local demo only, not saved)</label>
                          <input
                            className="input"
                            type="password"
                            value={openAiKey}
                            onChange={(e) => setOpenAiKey(e.target.value)}
                            placeholder="sk-…"
                          />
                        </div>

                        <div>
                          <label className="label">Actions</label>
                          <div className="row">
                            <button className="btn" onClick={getRecommendations} disabled={aiRunning}>
                              {aiRunning ? "Generating…" : "Generate recommendations"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {aiText ? (
                        <div style={{ marginTop: 10 }}>
                          <pre>{aiText}</pre>
                        </div>
                      ) : (
                        <div className="subtle" style={{ marginTop: 10 }}>
                          Generate recommendations after running the audit.
                        </div>
                      )}
                    </>
                  ) : null}

                  {activeTab === "asp" ? (
                    <>
                      <div className="row" style={{ marginBottom: 12 }}>
                        <button className="btn" onClick={runAspRecommendations} disabled={aspRunning}>
                          {aspRunning ? "Analysing…" : "Run ASP recommendations"}
                        </button>
                        {aspData?.finalUrl ? <span className="badge">Final URL: {aspData.finalUrl}</span> : null}
                      </div>

                      {aspError ? <div className="error">{aspError}</div> : null}

                      {aspData?.counts ? (
                        <div style={{ display: "grid", gap: 10 }}>
                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Sections</div>
                            <div className="v">{aspData.counts.sections}</div>
                          </div>

                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Carousels (.w-icatcher-slider)</div>
                            <div className="subtle">
                              Count: {aspData.counts.carousels.count} · Slides total: {aspData.counts.carousels.slidesTotal}
                            </div>
                          </div>

                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Testimonials (.w-testimonials)</div>
                            <div className="subtle">
                              Blocks: {aspData.counts.testimonials.count} · Items total: {aspData.counts.testimonials.itemsTotal}
                            </div>
                          </div>

                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Libraries</div>
                            <div className="subtle">
                              Containers: {aspData.counts.libraries.containers} · Types total: {aspData.counts.libraries.typesTotal}
                              <br />
                              News: {aspData.counts.libraries.types.news} · Products: {aspData.counts.libraries.types.products} ·
                              Video: {aspData.counts.libraries.types.video} · Sponsor: {aspData.counts.libraries.types.sponsor}
                            </div>
                          </div>

                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Media / embeds</div>
                            <div className="subtle">
                              Images: {aspData.counts.media.images} · Videos: {aspData.counts.media.videos} · Iframes: {aspData.counts.media.iframes}
                            </div>
                          </div>

                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Ad space</div>
                            <div className="subtle">
                              Left: {aspData.counts.adSpace.skyscraperLeft} · Right: {aspData.counts.adSpace.skyscraperRight} ·
                              Top: {aspData.counts.adSpace.skyscraperTop} · Bottom: {aspData.counts.adSpace.skyscraperBottom} ·
                              Total: {aspData.counts.adSpace.total}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="subtle">Run the check to scrape the page source and compute counts.</div>
                      )}

                      {aspData?.asp ? (
                        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">ASP score</div>
                            <div className="row">
                              <span className="badge">
                                {aspData.asp.overall.label} ({aspData.asp.overall.score}/100)
                              </span>
                              <span className="badge">
                                Severity: {aspData.asp.overall.severity}
                              </span>
                            </div>
                          </div>

                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Findings</div>
                            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                              {aspData.asp.findings.map((f) => (
                                <div key={f.key} className="subtle">
                                  <strong>{f.label}:</strong> {String(f.value)}{" "}
                                  {f.severity === "good" ? "✅" : f.severity === "warn" ? "⚠️" : "❌"}
                                  <div style={{ opacity: 0.9 }}>{f.message}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Recommended actions</div>
                            {aspData.asp.recommendations?.length ? (
                              <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                                {aspData.asp.recommendations.map((r) => (
                                  <div key={r.key}>
                                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                                    <div className="subtle">{r.action}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="subtle" style={{ marginTop: 8 }}>
                                No priority actions found. Looks tidy. ✅
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}

                    </>
                  ) : null}

                </div>
              </div>
            </div>
          </div>

        </>
      ) : null}
    </div>
  );
}
