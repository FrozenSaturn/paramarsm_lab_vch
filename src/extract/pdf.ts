import { extractText, getDocumentProxy } from "unpdf";

/** Returns embedded text, or "" if the PDF is a scan (caller falls back to vision). */
export async function pdfText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  const t = (text as string).trim();
  return t.replace(/\s/g, "").length < 80 ? "" : t; // scanned PDFs have ~no text layer
}
