import { z } from "zod";
import { TERM_KEYS } from "./terms";

/**
 * What the model returns when it reads a quote. It records what is printed and where;
 * it never computes. Every value carries a page, a verbatim snippet and a confidence,
 * which become rows in extracted_fields (the "proof" shown later).
 */
const page = z.number().int().nullable().describe("1-based PDF page where the value is printed, or null if not printed");
const snippet = z.string().nullable().describe("Short verbatim text from that page (under 120 characters) so a person can find it, or null");
const confidence = z.number().describe("0 to 1: how sure you are the value is read correctly. At most 0.6 for handwriting or an unclear scan");

const Field = z.object({
  value: z.string().nullable().describe("The value as printed (dates as YYYY-MM-DD), or null if the quote does not state it"),
  page,
  snippet,
  confidence,
});

export const HEADER_FIELDS = [
  "vendor_name", "gstin", "quote_date", "reference", "validity", "gst_treatment", "freight",
  "payment_terms", "advance", "security_deposit", "pf_esi", "completion_time", "mobilisation", "warranty", "exclusions",
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

export const Header = z.object({
  vendor_name: Field.describe("Vendor's name from the letterhead, stamp or signature block"),
  gstin: Field.describe("Vendor's GSTIN (15 characters)"),
  quote_date: Field.describe("Date of the quotation, as YYYY-MM-DD. Indian documents print dd.mm.yyyy"),
  reference: Field.describe("Vendor's quotation or reference number"),
  validity: Field.describe("How long the offer is valid, as printed (e.g. '45 days from the date of quotation')"),
  gst_treatment: Field.describe("What the quote says about GST: extra, included, rate"),
  freight: Field.describe("Freight or transport terms"),
  payment_terms: Field.describe("Payment terms, RA bill and final bill timing"),
  advance: Field.describe("Advance or mobilisation advance asked for"),
  security_deposit: Field.describe("What the quote says about security deposit or retention"),
  pf_esi: Field.describe("What the quote says about PF and ESI registration"),
  completion_time: Field.describe("Completion period offered"),
  mobilisation: Field.describe("When work can start after the order"),
  warranty: Field.describe("Warranty or guarantee offered"),
  exclusions: Field.describe("What the vendor excludes or expects the client to supply free, summarised"),
});

export const Line = z.object({
  serial: z.string().describe("Serial number as printed"),
  item: z.string().describe("Item heading as printed, e.g. 'WATERPROOFING AT TOILET FLOOR'. Not the long specification"),
  boq_serial: z.string().nullable().describe("Serial of the BOQ line (from the list in the request) that this line answers, matched by description; null if none"),
  unit: z.string().describe("Unit exactly as printed, e.g. 'SQFT', 'SQM.', 'RMT'"),
  quantity: z.number().nullable().describe("Quantity as printed, as a plain number"),
  rate: z.number().nullable().describe("Rate per unit as printed, as a plain number; null if blank"),
  amount: z.number().nullable().describe("Amount as printed for this line; null if the quote prints no amount. Do not compute it"),
  make: z.string().nullable().describe("Brand or make named for this line, if any"),
  rate_handwritten: z.boolean().describe("True if the rate is written by hand rather than printed"),
  page: z.number().int().describe("1-based PDF page where the line's rate is"),
  snippet: z.string().describe("Short verbatim text of the line (heading, unit, quantity, rate)"),
  confidence,
});

export const Term = z.object({
  term: z.enum(TERM_KEYS),
  status: z.enum(["met", "not_met", "not_stated"]).describe(
    "met: the quote accepts it or says the same; not_met: the quote contradicts it or asks for more than it allows; not_stated: the quote is silent",
  ),
  detail: z.string().describe("One sentence on what the quote says about this term, or 'Not mentioned'"),
  page,
  snippet,
});

export const StatedTotal = z.object({
  label: z.string().describe("Label as printed, e.g. 'Total', 'Grand Total', 'Sub Total'"),
  amount: z.number(),
  is_grand_total: z.boolean().describe("True only for the total of the whole quote (before GST unless the label says otherwise)"),
  page: z.number().int(),
  snippet: z.string(),
});

export const ExtractedQuote = z.object({
  header: Header,
  lines: z.array(Line),
  stated_totals: z.array(StatedTotal),
  terms: z.array(Term).describe("Exactly one entry for each of the six RFQ terms"),
  vendor_conditions: z.array(z.object({ text: z.string().describe("The condition in a few words"), page })).describe(
    "The vendor's own conditions that matter commercially (what the client must supply free, price escalation, interest on late payment)",
  ),
  is_scanned: z.boolean().describe("True if the document is a scan or photo rather than a digital document"),
  reader_notes: z.string().describe("Anything a reviewer should know about how this was read (unclear digits, missing pages); empty if none"),
});
export type ExtractedQuote = z.infer<typeof ExtractedQuote>;
export type ExtractedLine = z.infer<typeof Line>;

/** Second, independent read of handwritten rates only. Compared with the first read in code. */
export const HandwrittenRates = z.object({
  rates: z.array(
    z.object({
      serial: z.string().describe("Serial number of the line as printed"),
      rate: z.number().nullable().describe("The handwritten rate as a plain number, null if you cannot read it"),
      legible: z.boolean(),
      page: z.number().int(),
    }),
  ),
});
export type HandwrittenRates = z.infer<typeof HandwrittenRates>;
