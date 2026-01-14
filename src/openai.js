export async function summariseWithOpenAI({ apiKey, siteUrl, psiResults, axeResults }) {
  if (!apiKey) throw new Error("Missing OpenAI API key");

  // keep the payload compact
  const compact = {
    siteUrl,
    pages: psiResults.map((r) => ({
      url: r.url,
      strategy: r.strategy,
      scores: r.scores,
      metrics: r.metrics,
      opportunities: r.opportunities,
    })),
    axe: axeResults || null,
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "You write practical web audit summaries with British spellings." },
        {
          role: "user",
          content:
            "Summarise these site-health results.\n\nReturn:\n1) Exec summary\n2) Top 10 actions by impact\n3) Quick wins (<1 day)\n4) Bigger projects\n5) Worst pages and why\n\nUse headings and bullets.",
        },
        { role: "user", content: JSON.stringify(compact) },
      ],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error (${res.status}): ${await res.text()}`);
  const json = await res.json();

  const text = (json.output || [])
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n");

  return text || "No summary returned.";
}
