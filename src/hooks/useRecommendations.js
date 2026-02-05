import { useState } from "react";
import { API_BASE } from "../config.js";

export function useRecommendations() {
  const [openAiKey, setOpenAiKey] = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const [aiText, setAiText] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [suggestedKeywords, setSuggestedKeywords] = useState([]);
  const [aiVisibility, setAiVisibility] = useState(null);
  const [error, setError] = useState("");

  function clearRecommendations() {
    setError("");
    setAiText("");
    setExtracted(null);
    setSuggestedKeywords([]);
    setAiVisibility(null);
  }

  // Returns true on success so callers can decide whether to switch tabs.
  async function getRecommendations(psiAudit) {
    setError("");
    setAiText("");
    setExtracted(null);
    setSuggestedKeywords([]);
    setAiVisibility(null);
    setAiRunning(true);

    try {
      if (!psiAudit) throw new Error("Run an audit first.");
      if (!openAiKey.trim()) throw new Error("Enter your OpenAI API key.");

      const res = await fetch(`${API_BASE}/api/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: openAiKey.trim(), audit: psiAudit }),
      });

      const raw = await res.text();
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }

      if (!res.ok) throw new Error(json?.error || raw || "OpenAI request failed");

      setAiText(json?.recommendations || "No recommendations returned.");

      setExtracted(json?.extracted ?? null);
      setSuggestedKeywords(Array.isArray(json?.suggestedKeywords) ? json.suggestedKeywords : []);
      setAiVisibility(json?.aiVisibility ?? null);

      return true;
    } catch (e) {
      setError(e?.message || String(e));
      return false;
    } finally {
      setAiRunning(false);
    }
  }

  return {
    openAiKey,
    setOpenAiKey,
    aiRunning,
    aiText,

    extracted,
    suggestedKeywords,
    aiVisibility,

    error,
    clearRecommendations,
    getRecommendations,
  };
}
