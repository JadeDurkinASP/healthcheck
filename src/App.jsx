import React, { useMemo, useState } from "react";

const API_BASE = "https://healthcheck-vdll.onrender.com";
const TARGET_URL = "https://composer.showoff.asp.events/";

function formatMs(ms) {
  if (typeof ms !== "number") return "–";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}
function formatCls(v) {
  return typeof v === "number" ? v.toFixed(3) : "–";
}

export default function App() {
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [audit, setAudit] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [openAiKey, setOpenAiKey] = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const [aiText, setAiText] = useState("");

  const scores = useMemo(() => audit?.scores || {}, [audit]);
  const metrics = useMemo(() => audit?.metrics || {}, [audit]);

  async function runAudit() {
    setError("");
    setAiText("");
    setStatus("Running audit…");
    setIsRunning(true);

    try {
      const res = await fetch(`${API_BASE}/api/audit`, { cache: "no-store" });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }

      if (!res.ok) throw new Error(json?.error || text || "Audit failed");
      setAudit(json);
      setStatus("Done");
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
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setAiRunning(false);
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

      {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}

      {audit ? (
        <>
          <div style={{ marginTop: 10 }} className="subtle">
            Final URL: <span className="badge">{audit.finalUrl || "–"}</span>
          </div>
          <div className="grid4" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="t">Performance</div><div className="v">{scores.performance ?? "–"}</div></div>
            <div className="kpi"><div className="t">Accessibility</div><div className="v">{scores.accessibility ?? "–"}</div></div>
            <div className="kpi"><div className="t">Best Practices</div><div className="v">{scores.bestPractices ?? "–"}</div></div>
            <div className="kpi"><div className="t">SEO</div><div className="v">{scores.seo ?? "–"}</div></div>
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
      ) : null}

      {audit ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <h2 style={{ margin: "0 0 8px" }}>AI recommendations</h2>

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
              <div className="subtle" style={{ marginTop: 6 }}>
                For production, don&apos;t expose keys in the browser. Route via a backend.
              </div>
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
        </div>
      ) : null}


    </div>
  );
}
