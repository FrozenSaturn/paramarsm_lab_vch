/**
 * A short part of a chunk for the results list, centred on the first query word found. Pure code.
 */
export function snippetAround(text: string, terms: string[], maxLen = 320): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  const lower = t.toLowerCase();
  let at = -1;
  for (const term of terms) {
    if (!term) continue;
    const i = lower.indexOf(term.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return `${t.slice(0, maxLen).replace(/\s+\S*$/, "")} …`;
  let start = Math.max(0, at - Math.floor(maxLen / 3));
  if (start > 0) {
    const space = t.indexOf(" ", start);
    start = space > 0 && space < at ? space + 1 : start;
  }
  const end = Math.min(t.length, start + maxLen);
  const body = t.slice(start, end).replace(end < t.length ? /\s+\S*$/ : /$^/, "");
  return `${start > 0 ? "… " : ""}${body}${end < t.length ? " …" : ""}`;
}
