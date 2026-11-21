import { type Incoming, downloadMedia } from "./evolution.js";
import { transcribe } from "./extract/audio.js";
import { pdfText } from "./extract/pdf.js";
import { normalise, type Source } from "./normalise.js";
import { save } from "./store.js";

/** Turn one WhatsApp message into sources for the LLM, then a stored, normalised quote. */
export async function handle(m: Incoming, media?: Buffer) {
  const sources: Source[] = [];
  let raw = "";
  if (m.kind === "text") { raw = m.text!; sources.push({ type: "text", text: raw }); }
  else if (m.kind === "audio") {
    raw = await transcribe(media ?? await downloadMedia(m.id));
    sources.push({ type: "text", text: `[Voice note transcript]\n${raw}` });
  } else if (m.kind === "image") {
    const buf = media ?? await downloadMedia(m.id);
    if (m.text) sources.push({ type: "text", text: `[Caption] ${m.text}` });
    sources.push({ type: "image", data: buf, mime: m.mimetype ?? "image/jpeg" });
  } else if (m.kind === "document" && m.mimetype === "application/pdf") {
    const buf = media ?? await downloadMedia(m.id);
    const t = await pdfText(buf);
    sources.push(t ? { type: "text", text: `[PDF text: ${m.fileName}]\n${t}` } : { type: "pdf", data: buf });
  } else return null; // unsupported (xlsx, etc.) - TODO

  const quote = await normalise(sources, `${m.name} (+${m.from})`);
  await save({ message_id: m.id, from: m.from, name: m.name, kind: m.kind, received_at: new Date().toISOString(), raw, quote });
  return quote;
}
