import { w0Triage } from "./w0-triage";
import { gmailPoll } from "./gmail-poll";
import { w2CodeMapping } from "./w2-code-mapping";
import { w3Tender } from "./w3-tender";
import { w4Chase } from "./w4-chase";

export const functionsA: any[] = [w0Triage, gmailPoll, w2CodeMapping, w3Tender, w4Chase]; // W1 runs from triage and from /dev/boq
