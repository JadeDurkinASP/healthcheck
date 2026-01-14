import React, { useEffect, useMemo, useState } from "react";

const TARGET_URL = "https://composer.showoff.asp.events/";
const PARENT_ORIGIN = "*";

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

  useEffect(() => {
    const onMsg = (event) => {
      if (!event.data) return;

      const { type, payload } = event.data;

      if (type === "PARENT_AUDIT_STATUS") {
        setStatus(payload?.message || "Working…");
      }

      if (type === "PARENT_AUDIT_RESULT") {
        setAudit(payload);
        setStatus("Done");
        setError("");
        setIsRunning(false);
      }

      if (type === "PARENT_AUDIT_ERROR") {
        setError(payload?.message || "Parent reported an error.");
        setStatus("Error");
        setIsRunning(false);
      }
    };

    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const scores = useMemo(() => audit?.scores || {}, [audit]);
  const metrics = useMemo(() => audit?.metrics || {}, [audit]);

  function runAudit() {
    setError("");
    setStatus("Requesting audit…");
    setIsRunning(true);
    setAiText("");
    window.parent?.postMessage({ type: "PARENT_AUDIT_REQUEST" }, "*");
  }

  async function getRecommendations() {
    setError("");
    setAiText("");
    setAiRunning(true);

    try {
      if (!audit) throw new Error("Run an audit first.");
      if (!openAiKey.trim()) throw new Error("Enter your OpenAI API key.");

      const res = await fetch("http://localhost:8787/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: openAiKey.trim(),
          audit,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "OpenAI request failed");

      setAiText(json.recommendations);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setAiRunning(false);
    }
  }


  return (
    <div className="container">
      <h1 className="h1">Site Health Dashboard (Local Demo)</h1>
      <p className="subtle">
        Locked to audit: <span className="badge">{TARGET_URL}</span>
      </p>

      <div className="panel">
        <div className="grid2">
          <div>
            <label className="label">Target URL (fixed)</label>
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
