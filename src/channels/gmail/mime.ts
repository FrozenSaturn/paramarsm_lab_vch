export interface MailInput {
  to: string[]; cc?: string[]; subject: string; body: string;
  attachments?: { filename: string; mime: string; data: Buffer }[];
  inReplyTo?: string; // RFC Message-ID of the mail we reply to
}

// Header values must not contain line breaks (header injection).
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
// RFC 2047 encoded word for non-ASCII subjects (Bengali and Hindi names).
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const b64lines = (buf: Buffer) => buf.toString("base64").replace(/(.{76})/g, "$1\r\n");

export function buildMime(m: MailInput): string {
  if (!m.to.length) throw new Error("A mail needs at least one recipient.");
  const head = [`To: ${m.to.map(clean).join(", ")}`];
  if (m.cc?.length) head.push(`Cc: ${m.cc.map(clean).join(", ")}`);
  head.push(`Subject: ${encodeHeader(clean(m.subject))}`, "MIME-Version: 1.0");
  if (m.inReplyTo) head.push(`In-Reply-To: ${clean(m.inReplyTo)}`, `References: ${clean(m.inReplyTo)}`);
  const text = [`Content-Type: text/plain; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", b64lines(Buffer.from(m.body, "utf8"))];
  if (!m.attachments?.length) return [...head, ...text].join("\r\n");
  const boundary = `vin_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const parts = [`--${boundary}`, ...text];
  for (const a of m.attachments) {
    const name = clean(a.filename).replace(/"/g, "");
    parts.push(`--${boundary}`, `Content-Type: ${clean(a.mime)}; name="${name}"`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`, "", b64lines(a.data));
  }
  parts.push(`--${boundary}--`, "");
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}
export const toRaw = (mime: string) => Buffer.from(mime, "utf8").toString("base64url");
