# Vinayak procurement agent: build plan

One workspace where a Vinayak contracts engineer runs a work package from site requirement to approved vendor. Agents do the reading, matching, drafting, comparing and chasing. A person approves every message that leaves the building and every decision. Everything that happens is recorded with who, when, why and the proof.

## 0. MVP scope and settled decisions

The MVP shows one work package (waterproofing, Amara Tower-2) travelling the whole chain on real channels, with two people playing every part. Depth goes into the comparison; everything else is as thin as it can be while still being real.

| Topic | Decision |
| --- | --- |
| Team | Two builders, split in section 13 |
| Backend | Supabase for everything it offers: Postgres, Google sign-in, Storage, Realtime, row-level security |
| Email | Google. Gmail API with the same Google sign-in; polled, not pushed |
| WhatsApp | Evolution API linked to one number we control |
| Languages | English, Bengali, Hindi |
| Models | Sarvam for speech, translation and short conversational text; Anthropic for document reading and reasoning |
| ERP | Farvision is only a mirror of item codes plus an import sheet we generate (section 11) |
| Comparison | Our own mechanism, built in full (sections 7.2 to 7.4) |
| Data | A seeded demo database built from the sample pack (section 12) |
| Users | Role-based access with demo users; the contracts engineer's screens are built in full, the HOD gets the approval screen, other roles are read-only for now (section 9) |
| Memory | mem0's hosted platform, as the agents' context provider (section 6) |
| Search | Vector search in Supabase with pgvector, across item codes, documents and messages (section 6) |
| Cost | Free tiers and local containers only, apart from the two model keys |

### Who plays whom in the demo

| Part | Played by |
| --- | --- |
| Contracts engineer (main user) and admin | Builder 1, signed in with their Google account. This mailbox is "Vinayak contracts" |
| HOD | Builder 2, signed in with their Google account |
| Every vendor | Builder 2's Gmail using plus-addresses (`name+bajrang@gmail.com`, `name+shyama@gmail.com`). All vendor mail lands in one inbox we own, which is also how the "never email a real vendor" rule is kept |
| Site engineer | Either builder's phone, allow-listed, messaging the linked WhatsApp number |

### Left out of the MVP

Negotiation, vendor registration, work orders, writing to Farvision, more than one mailbox, approvals by WhatsApp reply. The data model leaves room for each.

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
 WhatsApp (Evolution API) ─┐                          ┌─ Web app (Next.js)
 Gmail (API poll, 60 s) ───┼─► Ingest ─► events ─►    │   Google sign-in via Supabase Auth
 Web upload ───────────────┘     │     (Supabase      │   Inbox · Case · Approvals
                                 ▼      Postgres)     │   Vendors · Codes · Audit
                    Supabase Storage        │         └─────────▲───────────
                    (.eml, PDFs, audio)     ▼                   │ Supabase Realtime
                                     Workflow engine ───────────┤
                                        (Inngest)               │
              ┌─────────────────────────────┼───────────────────┘
              ▼                             ▼
   Models                           Action executor (plain code)
   Sarvam: speech, translation,     send Gmail · send WhatsApp ·
     triage, short replies          build ERP sheet · notify
   Claude: read documents,                  │
     match codes, explain                   ▼
              │                     Receipts + audit log
              ▼
   Context service
   SQL facts · pgvector search · mem0 memories
```

### Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| App and API | Next.js, TypeScript | One language across UI, API, workflows and the WhatsApp webhook |
| Database | Supabase Postgres (free tier) | Schema kept as SQL migrations in the repo and applied with the Supabase CLI, so both builders share one project. Free projects are limited to 500 MB and pause after a week without activity |
| Sign-in | Supabase Auth, Google provider | One Google Cloud OAuth client in testing mode with both builders added as test users |
| Access control | Row-level security driven by a `profiles.role` column | Section 9 |
| Files | Supabase Storage, one private bucket, signed URLs | Chosen over MinIO: one less container, and the same access rules as the database. Free tier is 1 GB |
| Live updates | Supabase Realtime on `agent_steps`, `actions`, `messages` | This is what makes the "see what it is doing" panel move |
| Workflows | Inngest dev server (`npx inngest-cli dev`), free | Event triggers, per-case concurrency, timers, and `waitForEvent` for approvals |
| Speech to text | Sarvam Saaras | Bengali, Hindi and English voice notes. Keep the original-language transcript and an English translation |
| Translation | Sarvam translation | Incoming Bengali or Hindi text to English for storage and search; outgoing replies back into the sender's language |
| Short text | Sarvam chat model | Message triage, language detection, WhatsApp replies. Optional: spoken replies with Sarvam text-to-speech |
| Heavy reasoning | Claude | Reading quote PDFs and scans, BOQ checks, item-code judging, RFQ drafting, the recommendation write-up. Use the most capable model for quote reading and the recommendation, where there are few calls and accuracy matters most |
| Embeddings | `multilingual-e5-small`, run locally through `@huggingface/transformers` (384 dimensions) | For our own vector search. Free, and one model covers English, Bengali and Hindi, so a Bengali question finds an English document. mem0 does its own embedding on its side |
| Vector search | pgvector in Supabase, HNSW indexes | Item codes, document chunks, past cases |
| Memory | mem0 platform (cloud), free plan, through the `mem0ai` Node client | Nothing to host. One API key. Section 6 |
| Spreadsheets | `exceljs` | Reading BOQ sheets exactly, and writing the comparative and the ERP sheet |
| WhatsApp | Evolution API in Docker with its own Postgres and Redis | Section 4.1 |
| Email | Gmail API through `googleapis` | Section 4.2 |

Both model providers sit behind one small interface (`transcribe`, `translate`, `chat`, `readDocument`), so a task can be moved from one to the other by changing one line.

Sarvam's model names have changed this year (the docs list `sarvam-m` as retired and Saarika as legacy). Take the current names from Sarvam's models page when wiring this, not from memory.

## 4. Ingestion

Every inbound item, whatever the channel, becomes one row in `messages` plus rows in `documents` for each attachment, then one `message.received` event. From there on nothing downstream cares which channel it came from.

### 4.1 WhatsApp

- Run the stock Evolution API container and use only four things: QR pairing, the `MESSAGES_UPSERT` webhook, media download, and send text/media. The compose file and webhook handler from commit `3401fe1` (shared-secret header, sender allow-list, ffmpeg decode of voice notes) can be reused as they are. It needs its own Postgres database and Redis, separate from Supabase.
- It uses the unofficial WhatsApp Web protocol. Numbers can be banned and sessions drop. Use a dedicated SIM, keep volume low, never send bulk RFQs over WhatsApp (RFQs go by email), and watch `CONNECTION_UPDATE` so the app shows "WhatsApp disconnected" instead of failing silently.
- Process only allow-listed chats and groups. A number that sits in site groups will see personal chatter; that must not be stored.
- Hide it behind a `ChannelAdapter` interface (`receive`, `sendText`, `sendMedia`) so the official Cloud API can replace it without touching workflows.

### 4.2 Email (Gmail)

- **One consent, two jobs.** The Google sign-in asks for the Gmail scopes (`gmail.modify`, `gmail.send`) with offline access. The refresh token that comes back on the callback is stored server-side and used by the poller. Supabase does not refresh Google's token for us; the poller does that itself.
- **Polling.** Every 60 seconds, ask Gmail for history since the last stored `historyId`. De-duplicate on the Gmail message id.
- **Drafts are real Gmail drafts.** Each RFQ the agent writes is created with `drafts.create`, so the engineer can edit it in our app or in Gmail itself. On approval we call `drafts.send`. It leaves from their own address and sits in their Sent folder.
- **Matching replies.** Gmail's `threadId` ties a vendor's reply to the RFQ we sent. A token in the subject, e.g. `[VIN-RFQ-0042]`, is the fallback for replies that start a new thread.
- Store the raw message first, then parse. Quoted reply chains are split so the newest part is read as the message and the rest as context (both sample site emails are three levels deep).
- **Fallback if Google OAuth setup stalls for more than half an hour:** IMAP and SMTP with a Gmail app password (`imapflow`, `nodemailer`). Same `MailAdapter` interface, no real drafts.

In testing mode Google shows an "unverified app" warning and refresh tokens last seven days. Both are fine for a demo and both go away when the client's Google Workspace admin approves the app.

### 4.3 Reading content

| Input | How it is read |
| --- | --- |
| Excel / CSV | Parsed cell by cell with a library. Numbers come from cells, never from a model's reading of them |
| Text PDF | The PDF goes to Claude, which reads text and tables together |
| Scanned PDF, photo | Page images to Claude. Handwritten numbers are read twice independently; any disagreement goes to a person |
| Voice note | Sarvam speech-to-text, original audio kept, transcript and English translation shown for confirmation |
| Plain text, chat | As is; Bengali and Hindi are also translated to English by Sarvam |

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

In the MVP, W0 to W7 are built; W4 sends one reminder on a short timer to show the mechanism; W8 and W9 are left out.

Only one machine runs the Gmail poller and the Evolution webhook (`RUN_INGEST=true`). Both builders share one database, and two pollers would process every message twice.

## 6. Context for agents

Agents call one function, `getContext(caseId, purpose)`, which returns a bounded pack from three sources:

1. **Structured facts by SQL.** Case timeline, BOQ, confirmed code mappings, the vendor's past quotes, response times and performance records. Decisions rest on these because each can be cited row by row.
2. **Vector search.** Chunks of every email, quote, specification and transcript, embedded into `doc_chunks`, searched by meaning and by keyword together.
3. **mem0 memories.** Short distilled facts scoped to an entity (`vendor:bajrang`, `project:amara`, `user:soham`), such as "site nominated Purvyakruti for the mock-up floor". Each memory keeps the ids of the messages it came from, so it can be opened back to its source.

### Where vector search is used

| Place | What it does |
| --- | --- |
| Item-code mapping | Pulls the ten closest codes for each BOQ line before Claude judges; finds near-duplicate descriptions in the master |
| Duplicate-tender alert | Compares the new scope with past cases by meaning, not just by matching codes |
| Vendor shortlist | Matches the work description to vendor categories and to work they quoted before |
| Search box on every case and vendor | "Who quoted Brushbond below 40?" or the same question in Bengali, answered with links to the source pages |
| Recommendation | Fetches the passages each reason cites |

### How mem0 is used

- The hosted platform, called from the app with the `mem0ai` client and one API key. There is no container to run and no embedder to configure.
- After every inbound message, the ingest workflow sends the text to mem0 with the entity scopes and our message id as metadata. mem0 extracts and stores the memories.
- `getContext` searches mem0 filtered to the entities on the case. Only these two places call it, behind a `MemoryStore` interface (`add`, `search`, `remove`), so the self-hosted version can replace the cloud one later.
- **Free plan.** mem0's pricing changed in October 2026 and third-party pages still show the old limits. What I found says the free plan now expects you to bring your own model key for the higher limits. Read mem0.ai/pricing when creating the account. Demo volume is a few hundred calls either way.
- **Confidentiality.** This sends message text about Vinayak's vendors and projects to a third party. The data pack says not to share it outside the team. For the demo, feed mem0 the made-up anecdotes and the messages we write ourselves, not the client's raw emails, and tell Vinayak this is the one component that would move in-house (self-hosted mem0 on their database) before real use.

### What the user sees

- A "What we remember" panel on each vendor and case page, each line linked to the message it came from, with a delete button.
- Memories appear in the recommendation as context notes beside the score.

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
2. **Find candidates** for each BOQ line: the ten closest codes by embedding similarity and by trigram similarity, merged.
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
- **A scan with handwriting.** SK's quote is a scanned printout with the rates written in by pen ("34/-", "50/-"). They are not in the text layer, so they are read from the image and always confirmed by a person.
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

## 9. Access control and safety switches

### Roles

| Role | Can do | MVP |
| --- | --- | --- |
| Contracts engineer | Everything on a case: confirm mappings, edit and approve outbound drafts, run comparisons, send the recommendation | Built in full |
| HOD | See everything; approve, send back or override a recommendation; change scoring weights | Approval screen and read access |
| Site engineer | See own project's cases; submit requirements; answer clarifications | Read-only; they interact through WhatsApp |
| Management | Read everything; final approval above a value limit | Read-only |
| Admin | Users and roles, mailbox and WhatsApp connection, sandbox switch | Settings page |

### How it is enforced

- `allowed_users(email, role)` is seeded with the demo users. A Google account that is not on the list gets no profile and sees nothing.
- On first sign-in a trigger creates `profiles(id, email, role)` from that list. Roles live in this table, never in data the user can edit.
- Row-level security is on for every table. Policies call one helper, `app_role()`, so the rules are in one place. Workflows write with the service key from the server only.
- The executor checks the approver's role again before it runs an action. Hiding a button is not a permission check.
- An admin-only "view as" switch lets one person show every role's screen during the demo.

### Safety switches

- `OUTBOUND_MODE=sandbox` is enforced inside the executor: mail can only go to addresses on the demo list (the plus-addresses), and a banner shows on every page.
- WhatsApp processes allow-listed senders only.
- Google refresh tokens and the Evolution key are stored server-side and never sent to the browser. The client's documents are confidential; nothing is used outside this build.

## 10. Screens

1. **Inbox.** Everything inbound across channels, already classified and linked.
2. **Cases.** A board with one column per SOP stage.
3. **Case workspace.** The one screen: the conversation across all channels on the left; the current stage's work in the centre (BOQ, mappings, drafts, comparative, recommendation); live agent activity, pending approvals and the evidence viewer on the right.
4. **Approvals.** Everything waiting for me.
5. **Vendors.** Profile, scorecard, every past RFQ, quote and response time, and the "What we remember" panel.
6. **Item codes.** The ERP mirror and the hygiene report.
7. **Audit.** The full log, filterable by case, person, agent and action type.
8. **Settings.** Mailboxes, WhatsApp pairing, weights, approval policies, sandbox switch.

## 11. Farvision (minimal)

Farvision stays the system of record for item codes and work orders. We do not connect to it in the MVP.

- **In:** the `item_codes` table is a mirror, seeded from the sample sheet. Later it is refreshed from an Excel export.
- **Out:** when new codes are approved, a button produces an Excel sheet in Farvision's item import layout. A person uploads it. The receipt says "import sheet generated, downloaded by Soham at 14:05", never "written to Farvision".
- All of this is behind one `ErpAdapter` interface (`listCodes`, `proposeCodes`).

What was found when researching it, from Gamut's public help site and not from Vinayak's installation:

- An API token feature exists in the admin menu, but no endpoint documentation is public. Real integration means asking Gamut.
- Excel import is documented for item master and indents, which is why the sheet route works without anyone's permission.
- Farvision has its own tendering and price-comparison screens. Vinayak does this by email and Excel instead, so ask them why before positioning this product next to it.

## 12. Tables and the seeded demo database

### Tables

`allowed_users`, `profiles`, `projects`, `people`
`vendors`, `vendor_contacts`, `vendor_categories`, `vendor_performance`
`messages`, `documents`, `doc_chunks`, `extracted_fields`
Memories are held by mem0's platform, not in our database; `memory_refs` keeps each memory id with the entity and message it belongs to
`cases`, `boq_versions`, `boq_lines`
`item_codes`, `code_aliases`, `code_proposals`
`rfqs`, `rfq_recipients`
`quotes`, `quote_lines`, `quote_terms`
`comparatives`, `scores`, `recommendations`, `decisions`
`actions`, `receipts`, `events`, `agent_steps`

Every seeded row carries `is_demo = true` and a `source` saying which sample file it came from or that it was made up.

### Seed script (`npm run seed`, safe to re-run)

| Data | From the pack | Made up for the demo |
| --- | --- | --- |
| Projects | Amara, Aquina, 21 Acres (named in the emails) | — |
| People | Names and job titles in the two site emails | Mapped to the demo logins |
| Item codes | All rows of the ERP sheet, duplicates kept on purpose | — |
| BOQ | The eight waterproofing lines and quantities for Tower-2 | — |
| Vendors | The four that quoted, with GSTIN and address as printed on their quotes; the 66 Aquina contractor names | Category for each (suggested by a model, marked "inferred"); contact email set to a plus-address |
| RFQ terms | The six standard terms from the sample RFQ email | — |
| Past cases | — | Two or three closed waterproofing cases, so the duplicate-tender alert and response-time history have something to find |
| Performance records | — | A few ratings per vendor |
| Memories | — (the client's emails are not sent to mem0's cloud, see section 6) | A handful of vendor anecdotes written by us, fed through mem0 as messages so they carry sources like any other |
| Embeddings | Computed by the seed for every item code and document chunk | — |
| Storage | The four quote PDFs, the tender PDF, the site sheets | A Bengali and a Hindi voice note recorded by us |

Made-up performance ratings sit against real vendor names. Show them with a visible "demo data" badge and say so aloud, so nobody at Vinayak reads an invented dispute as real. During the demo, add one real rating live through the form to show how history is captured.

## 13. Who builds what

The first half hour is spent together agreeing three things, because everything else can then proceed in parallel: the table definitions in section 12, the event names in section 5, and the shape of an `actions` row.

Builder 2 does not wait for any channel to work. The sample files are in Storage from the seed, so quote reading and comparison start immediately.

| Stage | Builder 1: plumbing and channels | Builder 2: reading, comparison and screens |
| --- | --- | --- |
| 1. Foundation | Supabase project, migrations with pgvector, row-level security, Google sign-in, seed script with embeddings, Inngest wired to the app | Next.js shell, case page with a live timeline reading `agent_steps` and `actions` |
| 2. Core | `actions` and `receipts` with the executor; approve, edit and reject endpoints; Gmail send and draft | Read the four quotes into `quotes`, `quote_lines`, `quote_terms` with evidence; review screen for low-confidence fields and the handwritten scan |
| 3. Core | Gmail poller and reply matching; triage workflow | Normalisation, comparative matrix, scoring, recommendation with reasons and proof links; Excel export |
| 4. Intake | Evolution linked, webhook, media download, Sarvam speech-to-text and translation; mem0 client wired in and fed from ingest | Requirement and BOQ check; item-code mapping with vector candidates, and the hygiene report |
| 5. Tender | Tender preparation workflow: duplicate alert, shortlist, RFQ drafts, dispatch, one timed reminder | RFQ draft editor; approvals screen; HOD decision with override reason |
| 6. Finish | Vendor page with history and the memory panel; `getContext` wired to all three sources; ERP sheet export; audit page | Search box; polish the case workspace; "what if" weight control; demo badges |
| Together | Run the demo script below end to end twice, fix what breaks | |

If time runs short, stages 1 to 3 plus stage 5 already show RFQ out, quotes in, comparison, recommendation and approval. Stage 4 can be shown with a file upload in place of WhatsApp.

### Demo script

1. **Site asks.** A Bengali voice note and the quantity sheet arrive on WhatsApp. A case appears with the transcript, its translation and the parsed BOQ. Two lines are flagged as not measured.
2. **Codes.** Most lines map on their own. The agent stops on `WP.08`, where site wording and the master disagree, and the engineer picks. The hygiene report shows the duplicates in the master.
3. **Tender.** The agent warns that a similar tender exists. It proposes vendors and writes one RFQ per vendor with the six terms and the blank-rate BOQ attached. The engineer edits one line and approves. The mails are sent from their Gmail; receipts appear.
4. **Quotes arrive.** Builder 2 replies from the vendor addresses with the four real PDFs, one of them over WhatsApp. Each is matched to the RFQ and read. The handwritten rates on the SK scan wait for confirmation.
5. **Comparison.** It starts by itself when the fourth quote lands. The panel shows each step. The matrix puts every vendor on Vinayak's quantities in square metres, with flags for the stale quote and the three that priced a different scope.
6. **Recommendation.** Top three with reasons in plain words; clicking a reason opens the page of the PDF it came from. Changing a weight re-ranks.
7. **Approval.** The HOD signs in, reads the packet, and either approves or picks another vendor and gives a reason.
8. **Memory.** A site engineer messages in Hindi that one vendor finished late on another project. It shows up on that vendor's memory panel with a link to the message, then as a proposed performance record for the engineer to confirm. Re-running the comparison shows the effect.
9. **Search.** A question typed in Bengali finds the matching passage in an English quote.
10. **Proof.** The audit page shows the whole story: who, what, when, why, and every message sent.

## 14. Risks

| Risk | Handling |
| --- | --- |
| WhatsApp number banned or session lost | Dedicated number, low volume, email as the primary vendor channel, adapter ready for the official API |
| A wrong number read from a scan | Double read, mandatory human check on handwriting, vendor arithmetic recomputed |
| Thin vendor history at the start | Neutral scoring with a label; capture begins on day one |
| Google OAuth setup eats the afternoon | Time-box it; fall back to an app password (section 4.2) |
| Two laptops both ingest the same message | One machine runs ingestion (section 5) |
| Made-up ratings read as real | Demo badge on every seeded record (section 12) |
| mem0 cloud is unreachable or over its free limit during the demo | `getContext` treats memories as optional and still returns SQL facts and search results. Seed the memories beforehand so the panel is not empty |
| Client text sent to mem0's cloud | Only demo-written content goes there (section 6) |
| First embedding call is slow while the model downloads | Run the seed once on the demo machine beforehand |
| People keep working in email | The system reads the same mailboxes, so it stays current even when they do |

## 15. Still to ask the client

1. Can you share a comparative statement you prepared recently, so ours matches its layout?
2. Who approves what, and up to what value?
3. Is there a vendor list with categories and contacts, and any export of past work orders per vendor?
4. Are the default scoring weights in 7.4 close to how you judge vendors today?
5. Do you use Farvision's own tendering and price-comparison screens, and if not, why not?
