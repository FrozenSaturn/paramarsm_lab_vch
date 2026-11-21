/** Client for B's WhatsApp bridge (services/whatsapp). The app never talks to Evolution directly.
 *  Behind this small interface, the official Cloud API can replace the bridge later. */

const base = () => (process.env.WHATSAPP_BRIDGE_URL || "http://127.0.0.1:8091").replace(/\/$/, "");
export const instanceName = () => process.env.WHATSAPP_INSTANCE || "vch-main";

async function call(path: string, init: RequestInit = {}) {
  const token = process.env.WHATSAPP_BRIDGE_TOKEN;
  if (!token) throw new Error("WHATSAPP_BRIDGE_TOKEN is not set.");
  const res = await fetch(`${base()}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`WhatsApp bridge ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res;
}

export async function health(): Promise<{ ok: boolean; evolution?: boolean; error?: string }> {
  try { const r = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(5000) }); return { ok: r.ok, ...(await r.json().catch(() => ({}))) }; }
  catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

export async function status(): Promise<{ state?: string; owner?: string | null; error?: string }> {
  try { return await (await call(`/instances/${instanceName()}/status`)).json(); } catch (e: any) { return { error: String(e?.message ?? e) }; }
}

export async function sendText(to: string, text: string, quotedId?: string): Promise<{ id: string | null }> {
  return (await call(`/instances/${instanceName()}/send/text`, { method: "POST", body: JSON.stringify({ to, text, quotedId }) })).json();
}

export async function sendMedia(to: string, m: { mediatype: "image" | "document" | "video" | "audio"; data: Buffer; mimetype: string; fileName: string; caption?: string }): Promise<{ id: string | null }> {
  return (await call(`/instances/${instanceName()}/send/media`, { method: "POST", body: JSON.stringify({ to, mediatype: m.mediatype, media: m.data.toString("base64"), mimetype: m.mimetype, fileName: m.fileName, caption: m.caption }) })).json();
}

/** The file of a media message. The bridge saves it on first request. */
export async function downloadMedia(messageId: string): Promise<{ data: Buffer; mimetype: string; fileName: string | null }> {
  const res = await call(`/instances/${instanceName()}/messages/${encodeURIComponent(messageId)}/media`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 25 * 1024 * 1024) throw new Error("Media file is larger than 25 MB.");
  const cd = res.headers.get("content-disposition") ?? "";
  return { data: Buffer.from(await res.arrayBuffer()), mimetype: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0], fileName: /filename="([^"]+)"/.exec(cd)?.[1] ?? null };
}
