import type { Quote } from "../schema.js";

export type Source =
  | { type: "text"; text: string }
  | { type: "image"; data: Buffer; mime: string }
  | { type: "pdf"; data: Buffer };

/** A provider turns mixed sources into a validated Quote. */
export interface QuoteExtractor {
  readonly name: string;
  extract(system: string, sources: Source[], context: string): Promise<Quote>;
}
