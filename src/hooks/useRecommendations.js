// hooks/useRecommendations.js
import { useState } from "react";
import { API_BASE } from "../config.js"; // wherever you define this

function parseSuggestedKeywords(aiText) {
  if (!aiText) return [];

  // Look for a line like:
  // "Suggested keywords: a, b, c"
  // or "suggested keywords - a, b, c"
  const m = aiText.match(/suggested keywords\s*[:\-]\s*(.+)/i);
  if (!m?.[1]) return [];

  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function useRecommendations() {
  const [openAiKey, setOpenAiKey] = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const [aiText, setAiText] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [suggestedKeywords, setSuggestedKeywords] = useState([]);
  const [error, setError] = useState("");

  function clearRecommendations() {
    setAiText("");
    setExtracted(null);
    setSuggestedKeywords([]);
    setError("");
  }

  async function getRecommendations(audit) {
    setError("");
    setAiRunning(true);

    try {
      const r = await fetch(`${API_BASE}/api/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: openAiKey, audit }),
      });

      const json = await r.json().catch(() => null);

      if (!r.ok) {
        setError(json?.error || `Request failed (${r.status})`);
        return false;
      }

      const text = json?.recommendations || "";
      setAiText(text);

      const ex = json?.extracted || null;
      setExtracted(ex);

      // Prefer structured return if you add it later, otherwise parse from text
      const kw =
        Array.isArray(json?.suggestedKeywords) && json.suggestedKeywords.length
          ? json.suggestedKeywords
          : parseSuggestedKeywords(text);

      setSuggestedKeywords(kw);

      return true;
    } catch (e) {
      setError(String(e?.message || e));
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
    error,
    clearRecommendations,
    getRecommendations,
  };
}
