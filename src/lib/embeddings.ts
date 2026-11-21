// multilingual-e5-small, run locally (384 dims). One model covers English, Bengali and Hindi.
// E5 needs a "query: " or "passage: " prefix; items stored in the DB are passages.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: Promise<FeatureExtractionPipeline> | null = null;
const load = async () => {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("feature-extraction", "Xenova/multilingual-e5-small") as Promise<FeatureExtractionPipeline>;
};

export async function embed(texts: string[], kind: "passage" | "query" = "passage"): Promise<number[][]> {
  extractor ??= load();
  const ex = await extractor;
  const out: number[][] = [];
  for (const t of texts) {
    const r = await ex(`${kind}: ${t}`, { pooling: "mean", normalize: true });
    out.push(Array.from(r.data as Float32Array));
  }
  return out;
}
export const toPgVector = (v: number[]) => `[${v.map(x => x.toFixed(6)).join(",")}]`;
