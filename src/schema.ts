import { z } from "zod";

export const QuoteItem = z.object({
  description: z.string(),
  unit: z.string().nullable(),
  quantity: z.number().nullable(),
  rate: z.number().nullable().describe("Per-unit rate in INR, excluding GST"),
  amount: z.number().nullable(),
  remarks: z.string().nullable(),
});

export const Quote = z.object({
  vendor_name: z.string().nullable(),
  quote_date: z.string().nullable().describe("ISO date YYYY-MM-DD"),
  validity: z.string().nullable(),
  items: z.array(QuoteItem),
  gst_percent: z.number().nullable(),
  gst_included: z.boolean().nullable(),
  payment_terms: z.string().nullable(),
  other_terms: z.array(z.string()),
  total_excl_gst: z.number().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  needs_review: z.array(z.string()).describe("Anything ambiguous, missing or contradictory a human must confirm"),
});
export type Quote = z.infer<typeof Quote>;
