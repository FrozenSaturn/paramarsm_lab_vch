/** Strict parsing for sender checks. Pure functions, so every bypass case can be tested. */

/** One address, strict: a single "@", no quotes, spaces or angle brackets. Returns null when it is not clean. */
export function parseAddr(raw: string): { local: string; domain: string } | null {
  const a = raw.trim().toLowerCase();
  if (/[\s"'<>(),;\\]/.test(a)) return null;
  const at = a.lastIndexOf("@");
  if (at < 1 || at !== a.indexOf("@") || at === a.length - 1) return null; // exactly one "@"
  return { local: a.slice(0, at), domain: a.slice(at + 1) };
}

// Only these domains ignore "+tag". For any other domain, "a+b@x" and "a@x" are different mailboxes.
const PLUS_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Mailbox identity for comparing a sender with an RFQ recipient. Null when an address is not clean. */
export function mailboxKey(raw: string): string | null {
  const p = parseAddr(raw);
  if (!p) return null;
  const local = PLUS_DOMAINS.has(p.domain) ? p.local.split("+")[0] : p.local;
  return `${local}@${p.domain}`;
}

/** Remove "(...)" comments, including nested ones, as RFC 8601 allows. */
function stripComments(s: string): string {
  let out = "", depth = 0;
  for (const ch of s) { if (ch === "(") depth++; else if (ch === ")") { if (depth) depth--; } else if (!depth) out += ch; }
  return out;
}

/** From one Authentication-Results value written by our own receiving server, return the domain that passed
 *  DMARC (the `header.from` value), or null. A pass inside a comment or in another method does not count. */
export function dmarcPassDomain(value: string): string | null {
  const parts = stripComments(value).split(";").map(x => x.trim());
  if (!parts.length || parts[0].toLowerCase() !== "mx.google.com") return null; // authserv-id of Gmail's servers
  for (const res of parts.slice(1)) {
    const m = res.match(/^dmarc\s*=\s*pass\b(.*)$/i);
    if (!m) continue;
    const hf = m[1].match(/\bheader\.from\s*=\s*([^\s;]+)/i);
    if (hf) return hf[1].toLowerCase();
  }
  return null;
}
