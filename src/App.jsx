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

  // Two audit outputs:
  // - psiAudit: PageSpeed Insights / Lighthouse
  // - domAudit: Rendered DOM counts + ASP scoring
  const [psiAudit, setPsiAudit] = useState(null);
  const [domAudit, setDomAudit] = useState(null);

  const [isRunning, setIsRunning] = useState(false);

  // AI
  const [openAiKey, setOpenAiKey] = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const [aiText, setAiText] = useState("");

  // Tabs: "crux" | "opps" | "diag" | "ai" | "asp"
  const [activeTab, setActiveTab] = useState("crux");

  // PSI derived
  const scores = useMemo(() => psiAudit?.scores || {}, [psiAudit]);
  const metrics = useMemo(() => psiAudit?.metrics || {}, [psiAudit]);
  const fieldData = useMemo(() => psiAudit?.fieldData || null, [psiAudit]);
  const opportunities = useMemo(() => psiAudit?.opportunities || [], [psiAudit]);
  const diagnostics = useMemo(() => psiAudit?.diagnostics || null, [psiAudit]);

  const hasCrux =
    typeof fieldData?.lcp?.percentile === "number" ||
    typeof fieldData?.inp?.percentile === "number" ||
    typeof fieldData?.cls?.percentile === "number";

  const hasOpportunities = opportunities?.length > 0;
  const hasDiagnostics = Boolean(diagnostics);

  async function runAudit() {
    setError("");
    setAiText("");
    setStatus("Running audit…");
    setIsRunning(true);

    // clear previous results
    setPsiAudit(null);
    setDomAudit(null);

    try {
      const [psiRes, domRes] = await Promise.all([
        fetch(`${API_BASE}/api/audit`, { cache: "no-store" }),
        fetch(
          `${API_BASE}/api/asp-recommendations?url=${encodeURIComponent(TARGET_URL)}`,
          { cache: "no-store" }
        ),
      ]);

      const [psiText, domText] = await Promise.all([psiRes.text(), domRes.text()]);

      let psiJson = null;
      let domJson = null;

      try {
        psiJson = JSON.parse(psiText);
      } catch {
        psiJson = null;
      }
      try {
        domJson = JSON.parse(domText);
      } catch {
        domJson = null;
      }

      if (!psiRes.ok) {
        throw new Error(`PSI failed: ${psiJson?.error || psiText || psiRes.status}`);
      }
      if (!domRes.ok) {
        throw new Error(`DOM audit failed: ${domJson?.error || domText || domRes.status}`);
      }

      setPsiAudit(psiJson);
      setDomAudit(domJson);

      setStatus("Done");

      // Default to your rendered DOM audit view
      setActiveTab("asp");
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
      if (!psiAudit) throw new Error("Run an audit first.");
      if (!openAiKey.trim()) throw new Error("Enter your OpenAI API key.");

      const res = await fetch(`${API_BASE}/api/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: openAiKey.trim(), audit: psiAudit }),
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

  const hasAnyAudit = Boolean(psiAudit || domAudit);

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
                {isRunning ? "Running audit…" : "Run audit"}
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

      {hasAnyAudit ? (
        <>
          {/* PSI headline blocks only if PSI exists */}
          {psiAudit ? (
            <>
              <div style={{ marginTop: 10 }} className="subtle">
                Final URL: <span className="badge">{psiAudit?.finalUrl || "-"}</span>
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
            </>
          ) : (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="subtle">PageSpeed Insights results not available for this run.</div>
            </div>
          )}

          {/* Tabbed detail panels */}
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
                  <span className="tabsNavChevron" aria-hidden="true">
                    ›
                  </span>
                </button>

                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "opps" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "opps"}
                  onClick={() => setActiveTab("opps")}
                >
                  Top opportunities
                  <span className="tabsNavChevron" aria-hidden="true">
                    ›
                  </span>
                </button>

                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "diag" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "diag"}
                  onClick={() => setActiveTab("diag")}
                >
                  Diagnostics
                  <span className="tabsNavChevron" aria-hidden="true">
                    ›
                  </span>
                </button>

                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "ai" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "ai"}
                  onClick={() => setActiveTab("ai")}
                >
                  AI recommendations
                  <span className="tabsNavChevron" aria-hidden="true">
                    ›
                  </span>
                </button>

                <button
                  type="button"
                  className={`tabsNavBtn ${activeTab === "asp" ? "isActive" : ""}`}
                  role="tab"
                  aria-selected={activeTab === "asp"}
                  onClick={() => setActiveTab("asp")}
                >
                  ASP recommendations
                  <span className="tabsNavChevron" aria-hidden="true">
                    ›
                  </span>
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
                      {psiAudit ? (
                        hasCrux ? (
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
                        )
                      ) : (
                        <div className="subtle">Run the audit to load PageSpeed Insights data.</div>
                      )}
                    </>
                  ) : null}

                  {activeTab === "opps" ? (
                    <>
                      {psiAudit ? (
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
                      ) : (
                        <div className="subtle">Run the audit to load opportunities.</div>
                      )}
                    </>
                  ) : null}

                  {activeTab === "diag" ? (
                    <>
                      {psiAudit ? (
                        hasDiagnostics ? (
                          <>
                            <div className="row">
                              <span className="badge">
                                Total byte weight: {formatKb(diagnostics?.totalByteWeight)}
                              </span>
                            </div>

                            <div className="subtle" style={{ marginTop: 8 }}>
                              Tip: DOM size, third-party impact, and main-thread work are great signals for “too much stuff
                              on one page”.
                            </div>
                          </>
                        ) : (
                          <div className="subtle">No diagnostics returned for this run.</div>
                        )
                      ) : (
                        <div className="subtle">Run the audit to load diagnostics.</div>
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
                      {domAudit?.counts?.sections?.breakdown?.length ? (
                        <div className="panel" style={{ marginTop: 12 }}>
                          <h2 style={{ margin: "0 0 8px" }}>Per-section breakdown</h2>

                          <div className="subtle" style={{ marginBottom: 10 }}>
                            Sections found: <span className="badge">{domAudit.counts.sections.total}</span>
                          </div>

                          <div style={{ display: "grid", gap: 10 }}>
                            {domAudit.counts.sections.breakdown.map((s) => (
                             <details key={s.index} className="panel asp-section">
                                <summary className="asp-section__summary">
                                  <div className="asp-section__left">
                                    <span className="asp-section__dot" aria-hidden="true" />
                                    <span className="asp-section__title">
                                      Section - 
                                      {/* {s.index} */}
                                      {s.classes ? (
                                        <span className="asp-section__class">
                                          {" "}
                                          {s.classes.split(" ").filter(Boolean)[1] || ""}
                                        </span>
                                      ) : null}
                                    </span>
                                  </div>

                                  <div className="asp-section__right">
                                    <div className="asp-section__meta">
                                      <span className="badge">Images {s.images}</span>
                                      <span className="badge">Videos {s.videos}</span>
                                      <span className="badge">Iframes {s.iframes}</span>
                                      <span className="badge">Carousels {s.carousels}</span>
                                    </div>

                                    <span className="asp-section__chevron" aria-hidden="true" />
                                  </div>
                                </summary>

                                <div style={{ padding: 12, display: "grid", gap: 10 }}>
                                  <div className="grid2">

                                    {s.images > 0 && (
                                      <div className="kpi" style={{ textAlign: "left" }}>
                                        <h3 className="t">Images</h3>
                                         <div className="asp-carousel-total" style={{ marginBottom: 10 }}>
                                              <span className="subtle">Total</span>
                                              <span className="badge">
                                                {s.images} image{s.images !== 1 ? "s" : ""}
                                              </span>
                                          </div>
                                          <span className="subtle" style={{ marginBottom: 5 }}>Largest 3 images in the section: </span>
                                          {Array.isArray(s.topImages) && s.topImages.length > 0 && (
                                            <ul style={{ marginTop: 0 }}>
                                              {s.topImages.map((img) => (
                                                <li key={img.url}>
                                                  {img.name} – {img.mb} MB ({img.kb} KB)
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                      </div>
                                    )}

                                    {s.videos > 0 && (
                                      <div className="kpi" style={{ textAlign: "left" }}>
                                        <h3 className="t">Videos</h3>
                                        <div className="v">{s.videos}</div>
                                      </div>
                                    )}

                                    {s.iframes > 0 && (
                                      <div className="kpi" style={{ textAlign: "left" }}>
                                        <h3 className="t">Iframes</h3>
                                        <div className="v">{s.iframes}</div>
                                      </div>
                                    )}

                                    {s.carousels > 0 && (
                                      <div className="kpi" style={{ textAlign: "left" }}>
                                        <h3 className="t">Carousels</h3>

                                        {Array.isArray(s.carouselBreakdown) && s.carouselBreakdown.length > 0 ? (
                                          <div className="asp-carousel-list">
                                            {s.carouselBreakdown.map((c) => (
                                              <div key={c.index} className="asp-carousel-item">
                                                <div className="asp-carousel-header">
                                                  <span className="badge badge--muted">Carousel {c.index}</span>
                                                  {c.type && (
                                                    <span className="badge badge--soft">{c.type}</span>
                                                  )}
                                                </div>

                                                <div className="asp-carousel-stats">
                                                  <div className="kpi kpi--inline">
                                                    <span className="kpi__label">Slides</span>
                                                    <span className="kpi__value">{c.slides}</span>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}

                                            <div className="asp-carousel-total">
                                              <span className="subtle">Total</span>
                                              <span className="badge">
                                                {s.carousels} carousel{s.carousels !== 1 ? "s" : ""}
                                              </span>
                                              <span className="badge">{s.carouselSlides} slides</span>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="subtle" style={{ marginTop: 6 }}>
                                            No carousels found in this section.
                                          </div>
                                        )}
                                      </div>
                                    )}

                                  </div>

                                </div>
                              </details>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="subtle">Run the audit to see per-section counts.</div>
                      )}

                      {domAudit?.asp ? (
                        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">ASP score</div>
                            <div className="row">
                              <span className="badge">
                                {domAudit.asp.overall.label} ({domAudit.asp.overall.score}/100)
                              </span>
                              <span className="badge">Severity: {domAudit.asp.overall.severity}</span>
                            </div>
                          </div>

                          <div className="kpi" style={{ textAlign: "left" }}>
                            <div className="t">Findings</div>
                            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                              {domAudit.asp.findings.map((f) => (
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
                            {domAudit.asp.recommendations?.length ? (
                              <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                                {domAudit.asp.recommendations.map((r) => (
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
