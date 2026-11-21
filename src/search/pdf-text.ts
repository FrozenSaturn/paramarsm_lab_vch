/**
 * Reads the text layer of a PDF, one entry for each page. A scan has no text layer,
 * so its pages come back with empty text. The caller decides what to do with them.
 */
import { extractText, getDocumentProxy } from "unpdf";

export interface PageText {
  /** 1-based page number. */
  page: number;
  text: string;
}

export async function pdfPages(bytes: Uint8Array | Buffer): Promise<PageText[]> {
  // pdf.js takes ownership of the buffer, so give it a copy.
  const data = new Uint8Array(bytes);
  const pdf = await getDocumentProxy(data);
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((t, i) => ({ page: i + 1, text: tidyPageText(t) }));
  } finally {
    await Promise.resolve(pdf.cleanup?.()).catch(() => undefined);
  }
}

/** Collapse runs of spaces, keep line breaks, and drop blank lines at the ends. */
export function tidyPageText(t: string): string {
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
