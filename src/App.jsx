import React, { useState } from "react";
import { TARGET_URL } from "./config.js";
import { useAudit } from "./hooks/useAudit.js";
import { useRecommendations } from "./hooks/useRecommendations.js";
import { formatCls, formatKb, formatMs } from "./utils/format.js";

// Tab labels and IDs used across nav and header.
const TAB_LABELS = {
  crux: "Real user data (CrUX)",
  opps: "Top opportunities",
  diag: "Diagnostics",
  ai: "AI recommendations",
  asp: "ASP recommendations",
};

// Left-side tab list.
function TabsNav({ activeTab, onSelect }) {
  return (
    <div className="tabsNav" role="tablist" aria-label="Audit detail tabs">
      <div className="tabsNavTitle">Categories</div>

      {Object.entries(TAB_LABELS).map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`tabsNavBtn ${activeTab === key ? "isActive" : ""}`}
          role="tab"
          aria-selected={activeTab === key}
          onClick={() => onSelect(key)}
        >
          {label}
          <span className="tabsNavChevron" aria-hidden="true">
            ›
          </span>
        </button>
      ))}
    </div>
  );
}

// Right-side tab header title.
function TabsContentHeader({ activeTab }) {
  return (
    <div className="tabsContentHeader">
      <h2 className="tabsContentTitle">{TAB_LABELS[activeTab]}</h2>
    </div>
  );
}

export default function App() {
  // Tabs: "crux" | "opps" | "diag" | "ai" | "asp"
  const [activeTab, setActiveTab] = useState("crux");
  const [targetUrl, setTargetUrl] = useState(TARGET_URL);

  // Audit state + derived data from PSI/DOM runs.
  const {
    status,
    error: auditError,
    psiAudit,
    domAudit,
    isRunning,
    scores,
    metrics,
    fieldData,
    opportunities,
    diagnostics,
    hasCrux,
    hasOpportunities,
    hasDiagnostics,
    hasAnyAudit,
    runAudit,
  } = useAudit({
    onSuccess: () => setActiveTab("asp"),
    targetUrl,
  });

  // AI recommendation state and actions.
  const {
    openAiKey,
    setOpenAiKey,
    aiRunning,
    aiText,
    extracted,
    aiVisibility,
    suggestedKeywords,
    error: aiError,
    clearRecommendations,
    getRecommendations,
  } = useRecommendations();

  const error = auditError || aiError;

  // Keep AI output in sync with the most recent audit run.
  async function handleRunAudit() {
    clearRecommendations();
    await runAudit();
  }

  // Only switch to AI tab after a successful response.
  async function handleRecommendations() {
    const ok = await getRecommendations(psiAudit);
    if (ok) setActiveTab("ai");
  }

  return (
    <div className="container">
      <h1 className="h1">Site Health Dashboard</h1>

      <p className="subtle">
        Auditing: <span className="badge">{targetUrl}</span>
      </p>

      <div className="panel">
        <div className="grid2">
          <div>
            <label className="label">Target URL</label>
            <input
              className="input"
              value={targetUrl}
              onChange={e => setTargetUrl(e.target.value)}
              placeholder="https://example.com"
              type="url"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="label">Actions</label>
            <div className="row">
              <button className="btn" onClick={handleRunAudit} disabled={isRunning}>
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
              <TabsNav activeTab={activeTab} onSelect={setActiveTab} />

              {/* RIGHT: Content */}
              <div className="tabsContent" role="region" aria-label="Tab content">
                <TabsContentHeader activeTab={activeTab} />

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
                            <button className="btn" onClick={handleRecommendations} disabled={aiRunning}>
                              {aiRunning ? "Generating…" : "Generate recommendations"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* AI visibility score */}
                      {aiVisibility ? (
                        <div className="panel" style={{ marginTop: 12 }}>
                          <h3 style={{ margin: "0 0 8px" }}>AI visibility</h3>

                          <div className="row" style={{ alignItems: "center", flexWrap: "wrap" }}>
                            <span className="badge">
                              Score: {typeof aiVisibility.score === "number"
                                ? `${aiVisibility.score}/100`
                                : "–"}
                            </span>

                            {aiVisibility.grade && (
                              <span className="badge badge--soft">
                                Grade: {aiVisibility.grade}
                              </span>
                            )}
                          </div>

                          {Array.isArray(aiVisibility.reasons) && aiVisibility.reasons.length > 0 ? (
                            <ul style={{ marginTop: 10 }}>
                              {aiVisibility.reasons.slice(0, 5).map((r, i) => (
                                <li key={i} className="subtle">{r}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="subtle" style={{ marginTop: 10 }}>
                              No major AI visibility issues detected. ✅
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="subtle" style={{ marginTop: 12 }}>
                          
                        </div>
                      )}

                      {/* Keywords area */}
                      {extracted || suggestedKeywords.length ? (
                        <div className="panel" style={{ marginTop: 12 }}>
                          <h3 style={{ margin: "0 0 8px" }}>Keyword suggestions</h3>

                          <div style={{ display: "grid", gap: 14 }}>
                            {/* CURRENT */}
                            <div>
                              <div className="subtle" style={{ marginBottom: 6 }}>Current page metadata</div>

                              <div style={{ display: "grid", gap: 8 }}>
                                <div>
                                  <span className="subtle">Title:</span>{" "}
                                  {extracted?.title ? (
                                    <span className="badge">{extracted.title}</span>
                                  ) : (
                                    <span className="subtle">–</span>
                                  )}
                                </div>

                                <div>
                                  <span className="subtle">Meta description:</span>{" "}
                                  {extracted?.metaDescription ? (
                                    <span className="badge">{extracted.metaDescription}</span>
                                  ) : (
                                    <span className="subtle">–</span>
                                  )}
                                </div>

                                <div>
                                  <div className="subtle" style={{ marginBottom: 6 }}>Meta keywords</div>
                                  {Array.isArray(extracted?.metaKeywords) && extracted.metaKeywords.length ? (
                                    <div className="row" style={{ flexWrap: "wrap" }}>
                                      {extracted.metaKeywords.map((k) => (
                                        <span key={k} className="badge">{k}</span>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="subtle">
                                      None found on the page. (That’s normal, most sites don’t use meta keywords now.)
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* NEW */}
                            <div>
                              <div className="subtle" style={{ marginBottom: 6 }}>New keyword ideas</div>

                              {suggestedKeywords.length ? (
                                <div className="row" style={{ flexWrap: "wrap" }}>
                                  {suggestedKeywords.map((k) => (
                                    <span key={k} className="badge">{k}</span>
                                  ))}
                                </div>
                              ) : (
                                <div className="subtle">
                                  Not generated yet. Make sure your API returns <span className="badge">suggestedKeywords</span> or that the AI
                                  output contains a line like <span className="badge">Suggested keywords: a, b, c</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {aiText ? (
                        <div className="panel" style={{ marginTop: 10 }}>
                          <h3 style={{ margin: "0 0 8px" }}>AI recommendations</h3>
                          <pre>{aiText}</pre>
                        </div>
                      ) : (
                        <div className="subtle" style={{ marginTop: 10 }}>
                          
                        </div>
                      )}
                    </>
                  ) : null}

                  {activeTab === "asp" ? (
                    <>
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
                      {domAudit?.counts?.sections?.breakdown?.length ? (
                        <div className="panel" style={{ marginTop: 12 }}>
                          <h2 style={{ margin: "0 0 8px" }}>Per-Section breakdown</h2>

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
                                      {s.images > 0 && <span className="badge">Images {s.images}</span>}
                                      {s.videos > 0 && <span className="badge">Videos {s.videos}</span>}
                                      {s.iframes > 0 && <span className="badge">Iframes {s.iframes}</span>}
                                      {(s.articles ?? 0) > 0 && <span className="badge">Articles {s.articles}</span>}
                                      {s.carousels > 0 && <span className="badge">Carousels {s.carousels}</span>}
                                    </div>

                                    <span className="asp-section__chevron" aria-hidden="true" />
                                  </div>
                                </summary>

                                <div style={{ padding: 12, display: "grid", gap: 10 }}>
                                  <div className="grid2">

                                    {(s.articles ?? 0) > 0 && (
                                      <div className="kpi" style={{ textAlign: "left" }}>
                                        <h3 className="t">Articles</h3>

                                        <div className="asp-carousel-total" style={{ marginBottom: 10 }}>
                                          <span className="subtle">Total</span>
                                          <span className="badge">
                                            {s.articles} article{s.articles !== 1 ? "s" : ""}
                                          </span>
                                        </div>

                                        <div className="row" style={{ flexWrap: "wrap" }}>
                                          {(s.articleTags ?? 0) > 0 && (
                                            <span className="badge badge--muted">&lt;article&gt; {s.articleTags}</span>
                                          )}
                                          {(s.pArticles ?? 0) > 0 && (
                                            <span className="badge badge--muted">.p-article {s.pArticles}</span>
                                          )}
                                        </div>

                                        <div className="subtle" style={{ marginTop: 8 }}>
                                          Total is de-duped to avoid counting <span className="badge badge--soft">&lt;article class="p-article"&gt;</span> twice.
                                        </div>
                                      </div>
                                    )}

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
