import { useMemo, useState } from "react";
import { API_BASE, TARGET_URL } from "../config.js";

export function useAudit({ onSuccess, targetUrl: propTargetUrl } = {}) {
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [psiAudit, setPsiAudit] = useState(null);
  const [domAudit, setDomAudit] = useState(null);
  const [isRunning, setIsRunning] = useState(false);

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

  // Runs PSI + rendered DOM audits in parallel and normalizes errors.
  async function runAudit() {
    setError("");
    setStatus("Running audit…");
    setIsRunning(true);

    setPsiAudit(null);
    setDomAudit(null);

    try {
      const url = propTargetUrl || TARGET_URL;
      const [psiRes, domRes] = await Promise.all([
        fetch(`${API_BASE}/api/audit?url=${encodeURIComponent(url)}`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/asp-recommendations?url=${encodeURIComponent(url)}`, { cache: "no-store" }),
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

      if (onSuccess) onSuccess();
    } catch (e) {
      setError(e?.message || String(e));
      setStatus("Failed");
    } finally {
      setIsRunning(false);
    }
  }

  const hasAnyAudit = Boolean(psiAudit || domAudit);

  return {
    status,
    error,
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
  };
}
