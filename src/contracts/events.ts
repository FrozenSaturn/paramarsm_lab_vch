// FROZEN CONTRACT (Day 0). Change only by PR approved by both builders.
export type EventMap = {
  "message.received": { message_id: string; case_id?: string };
  "message.stored": { message_id: string; case_id?: string };
  "document.stored": { document_id: string; message_id?: string };
  "quote.received": { case_id: string; rfq_id: string; vendor_id: string; document_id: string };
  "boq.accepted": { case_id: string; boq_version_id: string };
  "codes.confirmed": { case_id: string };
  "rfq.approved": { case_id: string; rfq_id: string };
  "rfq.sent": { rfq_id: string; vendor_id: string; sent_at: string };
  "rfq.due_date_passed": { case_id: string; rfq_id: string };
  "quote.extracted": { quote_id: string; case_id: string; needs_review: boolean };
  "comparative.ready": { comparative_id: string; case_id: string; version: number };
  "recommendation.ready": { recommendation_id: string; case_id: string };
  "decision.made": { decision_id: string; case_id: string; vendor_id: string; overridden: boolean };
  "performance.proposed": { action_id: string; vendor_id: string };
};
export type EventName = keyof EventMap;
