import { cfg } from "../config.js";
import { claude } from "./claude.js";
import { sarvam } from "./sarvam.js";
import type { QuoteExtractor } from "./types.js";

export type { Source, QuoteExtractor } from "./types.js";
export const extractor = (): QuoteExtractor => (cfg.llmProvider === "sarvam" ? sarvam : claude);
