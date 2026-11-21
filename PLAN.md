# Vinayak procurement agent: build plan

One workspace where a Vinayak contracts engineer runs a work package from site requirement to approved vendor. Agents do the reading, matching, drafting, comparing and chasing. A person approves every message that leaves the building and every decision. Everything that happens is recorded with who, when, why and the proof.

## 1. What the client asked for, in their terms

Their SOP has 12 steps (`vinayak-vch3-data/01_process`). This plan covers them as follows.

| SOP step | What happens today | What we build |
| --- | --- | --- |
| 1–3 BOQ receipt, checking, corrected BOQ | Site emails or WhatsApps a sheet; HO checks by hand and mails back | Intake from any channel, automatic BOQ checks, a drafted clarification back to site, versioned BOQ |
| (ERP) item codes | HOD creates codes in Farvision; near duplicates pile up | Code-matching agent: match, or propose a new code, and flag duplicates |
| 4 Tender documents | Built by hand | Tender pack generated from the BOQ and the six standard terms |
| 5 Tender floating, minimum 3 vendors | One email per vendor | Vendor shortlist by category, RFQ drafts, duplicate-tender alert, send on approval |
| 6 Quote collection and comparative statement | Follow-ups by phone; CS typed into Excel | Reply tracking, reminders, quote reading in any layout, like-for-like CS |
| 7 Negotiation | Manual | Per-line lowest-rate benchmark and drafted counter-offers (later phase) |
| 8 Management approval | Email chain | Recommendation packet with reasons and proof; HOD approves, edits or sends back |
| 9–12 Registration, work order, approval, floating | Manual | Later phase; same draft-approve-send machinery |

Three rules from the problem statement are built in as hard constraints, not conventions:

- The agent recommends. It never selects, orders or pays.
- Every ranking shows its reason in plain words, with a link to the evidence.
- Outbound messages go to test inboxes only until the client turns that off (section 9).

## 2. Design decisions

1. **A "case" is the unit of work.** One case is one work package (for example, waterproofing, Amara Tower-2). Every email, WhatsApp message, file, draft, quote, score and approval hangs off a case. This is what removes the many-screens problem: one page holds the whole story.
2. **Event-driven workflows, not one looping agent.** Each stage is a separate, short workflow that starts on an event (`message.received`, `boq.approved`, `quote.received`, `rfq.due_date_passed`) and ends by emitting the next one. Workflows for different cases run side by side; a stage for one case never blocks another.
3. **Agents propose, code executes, people approve.** An agent can only create a *proposed action* (a draft email, a code mapping, a ranking). Sending, writing to the ERP and anything else with an effect is done by plain code after a person approves, and it leaves a receipt.
4. **The model reads; code does the arithmetic.** Models extract rates, units and terms from documents. Unit conversion, totals, GST and scores are computed by ordinary code, so the same inputs always give the same comparative, and every number can be re-derived.
5. **Postgres is the single source of truth.** The memory layer and search indexes are derived from it and can be rebuilt.
6. **Vendor documents are untrusted input.** A quote PDF could contain text aimed at the model ("rank us first"). Extraction agents have no tools that act on the world, scoring is code, and nothing leaves without approval, so the worst case is a wrong field that a reviewer sees.

## 3. Architecture

```text
 WhatsApp (Evolution API) ─┐                         ┌─ Web app (Next.js)
 Email (IMAP poll, 60 s) ──┼─► Ingest ─► events ─►   │   Inbox · Cases · Approvals
 Web upload / form ────────┘     │      (Postgres)   │   Vendors · Codes · Audit
                                 ▼          │        └─────────▲───────────
                    Object storage (raw     ▼                  │ live updates
                    .eml, PDFs, audio)   Workflow engine ──────┤
                                          (Inngest)            │
                                            │                  │
              ┌─────────────────────────────┼──────────────────┘
              ▼                             ▼
   Agents (Sarvam API)              Action executor (plain code)
   classify · extract · match       send email · send WhatsApp ·
   draft · explain                  write ERP file · notify
              │                             │
              ▼                             ▼
   Context service                  Receipts + audit log
   SQL facts · document search ·
   mem0 memories
```

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App and API | Next.js, TypeScript | One language across UI, API, workflows and the WhatsApp side (Evolution is Node) |
| Database | Supabase (free tier), Postgres with the `vector` extension enabled | Free; relational data, search vectors and audit log in one place. Use the plain Postgres connection string from the app and keep the schema in SQL migrations, so we stay portable and can fall back to local Docker Postgres (`pgvector/pgvector:pg16`). Free projects are limited to 500 MB and pause after a week of inactivity |
| File storage | Local disk behind a `FileStore` interface (`put`, `get`) | Free; raw emails, PDFs, images, audio. Swap to an S3-compatible store only if the client hosts it. Never store files only in the model's context |
| Workflows | Inngest (self-hosted, free; local dev server) | Event triggers, per-case concurrency, timers for reminders, and `waitForEvent` for approvals map directly onto what was asked. Alternative if a Postgres-only, MIT-licensed engine is preferred: DBOS |
| Models | **Sarvam AI** (we hold the API key): its largest chat model for extraction, reasoning and drafting; its smaller model for classification and routing | The only paid dependency. Strong on Hindi, Bengali and code-mixed text. All calls go through one `LLM` interface so the provider can change |
| Document reading | Sarvam document OCR/parsing for scans and Indian-language pages; `unpdf` and `exceljs` for text PDFs and spreadsheets | Sarvam covers scans; the libraries are free and exact. **Verify on the SK scan that handwritten rates are read** (section 7.2) |
| Embeddings | Local multilingual model through `@huggingface/transformers` (already in `package.json`), e.g. `multilingual-e5-small` | Free and offline; Sarvam has no embeddings endpoint we can rely on |
| Speech to text | Sarvam speech-to-text (Indian languages, voice notes); local Whisper (`Xenova/whisper-small`) as the free fallback | Same key as the models; Whisper keeps working if credit runs out or the API is down |
| WhatsApp | Evolution API in Docker, unmodified | See 4.1 |
| Email | IMAP polling with `imapflow`, SMTP send | See 4.2 |
| Memory | mem0 open source on the same pgvector, using Sarvam for distillation and the local embedder | See section 6 |
| Exports | `exceljs` for Excel, `pdfkit` or headless Chromium for PDF | Free libraries |
| Hosting | Docker Compose on a laptop or one small VM | Nothing here needs a paid cloud service |

## 4. Ingestion

Every inbound item, whatever the channel, becomes one row in `messages` plus rows in `documents` for each attachment, then one `message.received` event. From there on nothing downstream cares which channel it came from.

### 4.1 WhatsApp

- Run the stock Evolution API container and use only four things: QR pairing, the `MESSAGES_UPSERT` webhook, media download, and send text/media. Do not fork and strip it today; a fork is more work than either using it as is or, later, replacing it with a ~300-line gateway written directly on Baileys (the library Evolution wraps). It needs its own Postgres database and Redis.
- It uses the unofficial WhatsApp Web protocol. Numbers can be banned and sessions drop. Use a dedicated SIM, keep volume low, never send bulk RFQs over WhatsApp (RFQs go by email), and watch `CONNECTION_UPDATE` so the app shows "WhatsApp disconnected" instead of failing silently.
- Process only allow-listed chats and groups. A number that sits in site groups will see personal chatter; that must not be stored.
- Hide it behind a `ChannelAdapter` interface (`receive`, `sendText`, `sendMedia`) so the official Cloud API can replace it without touching workflows.

### 4.2 Email

- Poll each mailbox every 60 seconds. Track the last seen UID and UIDVALIDITY per folder; de-duplicate on `Message-ID`.
- Store the raw `.eml` first, then parse. Quoted reply chains are split so the newest part is read as the message and the rest as context (both sample site emails are three levels deep).
- Outbound RFQs carry a token in the subject, e.g. `[VIN-RFQ-0042]`, and we record the `Message-ID`. A reply is matched to its RFQ by `In-Reply-To`/`References`, then the token, then sender address, then the attachment's content.
- Send through the engineer's own mailbox (SMTP, then append to Sent) so vendors see a normal email from a person they know.

### 4.3 Reading content

| Input | How it is read |
| --- | --- |
| Excel / CSV | Parsed cell by cell with a library. Numbers come from cells, never from a model's reading of them |
| Text PDF | Text and layout extracted, plus page images to the model for tables |
| Scanned PDF, photo | Sarvam document OCR, then the model structures the result. Handwritten numbers are read twice independently; any disagreement goes to a person |
| Voice note | Sarvam speech-to-text (Whisper fallback), original audio kept, transcript shown for confirmation |
| Plain text, chat | As is |

Every extracted field is stored with its source document, page, the text snippet it came from and a confidence. That record is the "proof" shown later.

## 5. Workflows

Each is a separate Inngest function. Concurrency is keyed on case id, so one case runs one stage at a time while other cases proceed. Each step writes to `agent_steps`, which is what the UI shows as live progress.

| # | Workflow | Starts on | Does | Stops for a person at |
| --- | --- | --- | --- | --- |
| W0 | Triage | `message.received` | Classifies (requirement, quote, vendor question, approval reply, noise); links to an existing case or proposes a new one | New-case confirmation when unsure |
| W1 | Requirement and BOQ check | new requirement | Structures the requirement; checks totals, unit consistency, unmeasured lines, missing dates and scope; drafts a clarification to site | Send clarification; accept BOQ |
| W2 | Item-code mapping | `boq.accepted` | Section 7.1 | Confirm each non-obvious mapping; approve new codes |
| W3 | Tender preparation | `codes.confirmed` | Duplicate-tender check; vendor shortlist; tender pack; one RFQ draft per vendor with HO in CC | Edit and approve drafts (one click for the batch, or per vendor) |
| W4 | Dispatch and chase | `rfq.approved` | Sends; records receipts; sleeps until reminders are due; drafts follow-ups | Reminder policy (section 8) |
| W5 | Quote intake | quote classified by W0 | Section 7.2 | Review low-confidence fields |
| W6 | Comparative and recommendation | all invited vendors replied, or due date passed with 3 or more quotes, or the "Compare now" button, or a revised quote arrives | Sections 7.3 and 7.4. Every run is a new version; old versions are kept | Nothing; it only produces a packet |
| W7 | Approval | `recommendation.ready` | Sends the packet to the HOD in the app, by email and as a WhatsApp link; records the decision | The decision itself |
| W8 | Negotiation, registration, work order | later phase | Counter-offer drafts, registration form, WO draft | Each send |
| W9 | Performance capture | WO milestones and closure | Asks the site engineer four questions on WhatsApp | — |

On the question of whether the comparison starts by itself or by a button: both. It starts automatically when the conditions above are met and can be run by hand at any time. Fewer than three quotes at the due date raises an alert instead of a ranking, because the SOP requires three.

Triggers from WhatsApp or email ("status of Amara waterproofing", "compare RFQ 42 now") are just messages from a known, allow-listed person that W0 turns into the same events the buttons emit. Approvals are different: they happen in the app through an authenticated link, so an approval is tied to a login and not to whoever holds a phone.

## 6. Context for agents

Agents call one function, `getContext(caseId, purpose)`, which returns a bounded pack from three sources:

1. **Structured facts by SQL.** Case timeline, BOQ, confirmed code mappings, the vendor's past quotes, response times and performance records. This is what decisions are based on, because it can be cited row by row.
2. **Document search.** Chunks of past emails, quotes and specifications in pgvector with keyword search alongside.
3. **mem0 memories.** Short distilled facts scoped to an entity (`vendor:bajrang`, `project:amara`, `user:soham`), such as "management prefers Fosroc make for wet areas" or "site nominated Purvyakruti for the mock-up floor". Each memory stores the ids of the messages it came from.

mem0 over Supermemory: its core is Apache-2.0 and it can use the pgvector we already run, so it adds no infrastructure. What I found on Supermemory's licence and self-hosting was contradictory between sources; check its repository before considering it.

The memory layer supplies colour, not evidence. A vendor's score is never changed by a memory alone. A memory that matters ("Bajrang was late at 21 Acres") is turned into a proposed performance record that a person confirms, and from then on it is a structured fact.

## 7. The four agents that matter

### 7.1 Item-code mapping

The sample master (`04_item_codes`) already shows the problems to solve:

- The same code listed twice (`WP.11.B` at serial 32 and 38; `W.P.01`–`W.P.05` at serials 9–13 and 40–44).
- One code with two meanings: `WP.EXP.01` is "Polysulphide" at serial 34 and "Hypalon" at serial 69.
- One meaning under two codes: "Kitchen floor-B" is `WP.04.B` at serial 24 and `WP.03.B` at serial 64.
- The site sheet calls nozzle grouting `WP.08`; in the master `WP.08` is pressure grouting and nozzle grouting is `WP.11.B`.

Steps:

1. **Clean the mirror once.** Normalise codes, then report exact duplicates, code conflicts and near-duplicate descriptions. This hygiene report is a deliverable in its own right.
2. **Retrieve candidates** for each BOQ line by keyword and embedding similarity.
3. **Judge** with a model that must output: matched code or "new", confidence, and which attributes agree or differ (location, floor or wall, height, variant A/B, unit).
4. **Decide by threshold.** High confidence is pre-filled for one-click confirmation. Anything else is shown with the top three candidates. "New" produces a proposed code that follows the existing naming pattern, with the nearest existing codes shown beside it.
5. **Learn.** Each confirmation is saved as an alias, so the same site wording maps instantly next time.

### 7.2 Quote reading and normalisation

Target record per quote: vendor, GSTIN, date, reference, validity, GST treatment, freight, payment terms, advance, security deposit, PF/ESI, completion time, warranty, exclusions; and per line: BOQ line it answers, unit, quantity quoted, rate, amount, make.

What the four sample quotes already require:

- **Unit conversion.** The BOQ is in square metres; vendors quote per square foot.
- **Quantity mismatch.** Purvyakruti prices 13,429.53 sq ft of toilet floor, close to the BOQ's 13,424.54. Bajrang, Shyama and SK price 30,420. Comparison must therefore use each vendor's *rate* against *Vinayak's* quantity, and flag that the vendor priced a different scope.
- **Stale quotes.** Bajrang's is dated 21.05.2026; the RFQ went out 16.11.2026.
- **Unit disagreement.** Toilet depression is per running metre in the BOQ; Bajrang quotes it per square metre.
- **A scan with handwriting.** SK's quote is a scanned printout with the rates written in by pen ("34/-", "50/-"). They are not in the text layer, so they are read from the image and always confirmed by a person. Open check: test Sarvam's OCR on this page first. If it misses the pen rates, fall back to a free local OCR for the first pass, with the human check unchanged.
- **Vendor arithmetic.** Recompute every amount and total; show differences.
- **Deviation from the six RFQ terms.** Each is checked and shown as met, not met or not stated.

Fields below the confidence threshold go to a review screen with the PDF page on one side and the extracted values on the other.

### 7.3 Comparative statement

Rows are BOQ lines, columns are vendors. Each cell shows the normalised rate and the amount on Vinayak's quantity; the lowest per line is marked. Below: totals before GST, GST, landed total, then a terms grid and the flags from 7.2. Exports to Excel and PDF. Ask the client for their current CS layout and match it, so the output is something they can file without rework.

### 7.4 Scoring and recommendation

Scores are computed by code from the extracted facts. Default weights, editable per category by the HOD:

| Parameter | Weight | Measured from |
| --- | --- | --- |
| Price | 40 | Landed total on Vinayak's quantities, relative to the lowest |
| Past performance | 20 | Quality, timeliness, disputes and safety from past work orders |
| Delivery fit | 15 | Stated completion and mobilisation against the required dates |
| Compliance | 10 | The six RFQ terms, specified make, lines left unquoted |
| Responsiveness | 10 | Hours from RFQ to quote, reminders needed, completeness of first reply |
| Commercial terms | 5 | Payment terms, advance asked, validity, warranty |

Rules that keep it honest:

- A vendor with no history gets a neutral score and a visible "no history" label. It is not silently penalised or favoured.
- Risk flags sit beside the score and do not hide inside it: stale quote, different scope priced, bid far below the median, unread handwriting.
- The model writes the plain-language explanation, but only from the computed facts, and each sentence links to its proof: the PDF page, the email, the past work order.
- A "what if" control shows how the ranking changes if the weights change.
- If the HOD picks someone other than the top-ranked vendor, a reason is required. That reason is the most valuable training data the system will get.

**Past performance** is not recorded anywhere today, so it is captured three ways: imported from whatever history Farvision can export; a four-question WhatsApp check-in to the site engineer at milestones and closure (quality, timeliness, disputes, safety, plus an optional voice note); and proposals mined from messages, confirmed by a person.

### Duplicate alerts

- **Tender:** before drafts are created, look for open or recent cases with the same project, overlapping item codes and similar quantities, and show them ("looks like RFQ-0031, sent 16 Nov, 4 quotes in").
- **Message:** the same email arriving by forward and CC, or the same file by email and WhatsApp, is matched by `Message-ID` and file hash.
- **Quote:** a second quote from the same vendor is treated as a revision, versioned, and triggers a re-run of W6.

## 8. Human in the loop, receipts and audit

Every effect is a row in `actions`: `proposed → edited → approved → executed` (or `rejected`, `failed`). The draft is editable before approval, and the edit is kept as a diff.

| Action | Default policy |
| --- | --- |
| RFQ to vendors, clarification to site, counter-offer | Always ask |
| Reminder to a vendor | Ask the first time per case; then automatic with notification, if the client wants |
| New item code, write to ERP | Always ask |
| Recommendation to HOD | Automatic (it is internal and is itself a request for approval) |
| Vendor selection, work order | Human only; the agent has no action type for these |

Three append-only records:

- **`events`**: what happened in the world (message arrived, deadline passed, user clicked).
- **`agent_steps`**: what an agent did: inputs, output, model and prompt version, evidence used, a reasoning summary, cost.
- **`receipts`**: what was executed: the exact payload and its hash, who approved it and when, the provider's message id, the result.

Together these answer "what was done, when, by whom, where and why" for any case, and are shown as one timeline. The reasoning summary is for reading along; the proof is the evidence links and the recomputable numbers.

## 9. Safety switches

- `OUTBOUND_MODE=sandbox` is enforced inside the executor, not the UI: every recipient is rewritten to a test inbox and a banner shows on every page. This is how the "never email a real vendor" rule is kept.
- Roles: site engineer, contracts engineer, HOD, management, admin. Approval rights follow role and, later, value limits.
- Secrets for mailboxes and WhatsApp sessions are encrypted at rest. The client's documents are confidential; nothing is used outside this build.

## 10. Screens

1. **Inbox.** Everything inbound across channels, already classified and linked.
2. **Cases.** A board with one column per SOP stage.
3. **Case workspace.** The one screen: the conversation across all channels on the left; the current stage's work in the centre (BOQ, mappings, drafts, comparative, recommendation); live agent activity, pending approvals and the evidence viewer on the right.
4. **Approvals.** Everything waiting for me.
5. **Vendors.** Profile, scorecard, every past RFQ, quote and response time.
6. **Item codes.** The ERP mirror and the hygiene report.
7. **Audit.** The full log, filterable by case, person, agent and action type.
8. **Settings.** Mailboxes, WhatsApp pairing, weights, approval policies, sandbox switch.

## 11. Farvision

FARVISION_SECTION_PENDING

## 12. Core tables

`users`, `projects`, `vendors`, `vendor_contacts`, `vendor_categories`, `vendor_performance`
`messages`, `documents`, `extracted_fields`
`cases`, `boq_versions`, `boq_lines`
`item_codes`, `code_aliases`, `code_proposals`
`rfqs`, `rfq_recipients`
`quotes`, `quote_lines`, `quote_terms`
`comparatives`, `scores`, `recommendations`, `decisions`
`actions`, `receipts`, `events`, `workflow_runs`, `agent_steps`

## 13. Build order

The full system is weeks of work. Build in this order; each step ends with something that can be shown, so stop wherever the clock stops. Everything runs on the Amara waterproofing data first.

1. **Spine.** Schema for cases, documents, actions, receipts, events and agent steps; Inngest wired up; the case page with a live timeline; upload a file to a case.
2. **Quotes to recommendation.** Read the four quotes, normalise, build the comparative, score, explain with evidence links. This is the part the client cares most about and the pack calls the hard part.
3. **RFQ out, with approval.** Tender pack, drafts, edit, approve, send to test inboxes, receipts, duplicate-tender alert.
4. **Item-code mapping** with the hygiene report.
5. **Requirement intake and BOQ check** from the two sample emails and sheets.
6. **Email polling live**, including reply matching back to the RFQ.
7. **WhatsApp live** through Evolution, with one text and one voice-note requirement.
8. **Vendor history and memory:** scorecards, mem0, the performance check-in.
9. **Later:** negotiation, registration, work orders, Farvision write-back, official WhatsApp API.

## 14. Risks

| Risk | Handling |
| --- | --- |
| WhatsApp number banned or session lost | Dedicated number, low volume, email as the primary vendor channel, adapter ready for the official API |
| A wrong number read from a scan | Double read, mandatory human check on handwriting, vendor arithmetic recomputed |
| Thin vendor history at the start | Neutral scoring with a label; capture begins on day one |
| Farvision cannot be written to | File-based hand-off keeps a person in the loop anyway (section 11) |
| People keep working in email | The system reads the same mailboxes, so it stays current even when they do |

## 15. Questions for the client

1. Which email system do you use (Google Workspace, Microsoft 365, other), and is IMAP or API access allowed on the contracts mailbox?
2. Which Farvision version, hosted where, and who is your contact at Gamut?
3. Can you share a comparative statement you prepared recently, so ours matches it?
4. Who approves what, and up to what value?
5. Is there a vendor list with categories and contacts, and any export of past work orders per vendor?
6. Which WhatsApp number may we use, and which groups should it read?
7. Which languages do site voice notes come in?
8. Are the default scoring weights in 7.4 close to how you judge vendors today?
