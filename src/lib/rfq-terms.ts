// Vinayak's six standard RFQ terms, verbatim from 03_tender/Sample_RFQ_email_to_a_vendor.txt.
export const RFQ_TERMS = [
  { id: "pf_esi", text: "PF & ESI registration required." },
  { id: "tds", text: "TDS will be deducted as per Govt. norms." },
  { id: "security_deposit", text: "5% Security deposit will be released after 12months of total completion of work" },
  { id: "gst_extra", text: "GST will be paid extra." },
  { id: "site_facilities", text: "Water & Electricity at a point and Labour hutment will be provided." },
  { id: "safety_ppe", text: "Safety PPE cost will be under Contractor's scope." },
] as const;
