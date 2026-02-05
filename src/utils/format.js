export function formatMs(ms) {
  if (typeof ms !== "number") return "–";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatCls(value) {
  return typeof value === "number" ? value.toFixed(3) : "–";
}

export function formatKb(bytes) {
  if (typeof bytes !== "number") return "-";
  const kb = bytes / 1024;
  if (kb > 1024) return `${(kb / 1024).toFixed(2)} MB`;
  return `${kb.toFixed(0)} KB`;
}
