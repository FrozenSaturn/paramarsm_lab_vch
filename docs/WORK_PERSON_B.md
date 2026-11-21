# Person B: quotes, comparison, decision, memory and search (quote file to HOD decision)

You are Builder 2 in `PLAN.md` section 13. You sign in as the HOD, and your Gmail plays every vendor through plus-addresses (`you+bajrang@gmail.com`, `you+shyama@gmail.com`, and so on). This file replaces the split table in PLAN.md section 13. Everything else in PLAN.md still applies.

Person A has a matching file, `docs/WORK_PERSON_A.md`. Read its "What A owns" section once so you know which folders are off limits.

## 1. The idea in one paragraph

You own everything from "a quote file arrives" to "the HOD decides", plus the cross-cutting intelligence: memory, search, `getContext`, and the audit, vendor and approvals screens. A owns the platform and everything before the RFQ goes out. The two halves meet at a short list of events and function signatures (section 5). Neither of you edits the other's folders, so there is nothing to merge-conflict on. You never wait for a channel to work: the four real quote PDFs are your input from the first hour.

## 2. Ground rules (identical in A's file)

1. **Own folders, own tables.** You may edit only the paths in section 3. To change anything of A's, open an issue labelled `for-A`. Don't "just fix it".
2. **Frozen contract.** After Day 0 the files in `src/contracts/` and `prisma/schema/base.prisma` and the first two migrations in `prisma/migrations/` change only by a PR the other person approves. This covers event names, payload shapes, the `actions` row, table columns used by both sides, and the `getContext` signature.
3. **Talk through events, not imports.** If your code needs something the other person builds, it waits for an event or calls a function whose signature is in `src/contracts/`. Never import from the other person's folder.
4. **Own database, own machine.** Each of you runs a local Supabase (`supabase start`) and a local Inngest dev server. The shared cloud Supabase project is for integration runs and the demo only. Reset your local database whenever you like.
5. **Migrations don't collide (Prisma Migrate).** The schema is split into `prisma/schema/base.prisma` (shared, frozen), `a.prisma` (A) and `b.prisma` (B). Only the owner edits their file. B's models refer to A's tables by plain uuid columns with **no Prisma relation and no foreign key**, so A's file never needs a back-relation from B; A's models never refer to B's. To change your tables: edit your `.prisma` file, run `npm run db:migrate -- --name <what>` (this is `prisma migrate dev --create-only`), read the generated SQL, delete any line that drops an hnsw, trigram or partial index or a CHECK (Prisma cannot see them), then `npm run db:deploy`. **Rebase on `main` before generating, and merge the migration PR the same day**, because migration folders are ordered by timestamp. Policies, triggers and functions go in a hand-written migration of your own, never into someone else's.
6. **One ingester.** `RUN_INGEST=true` only on A's machine. Yours is always `false`. Otherwise every Gmail message is processed twice.
7. **Shared files are append-only and tiny:** `package.json` (add your own dependencies; whoever merges second re-runs `npm install`), `.env.example` (each person has a marked section) and `CODEOWNERS`. Merge those PRs the same day.
8. **Branches.** `a/<topic>` and `b/<topic>`. Small PRs into `main`, rebase on `main` at least twice a day, the other person only skims. `CODEOWNERS` makes GitHub enforce the folder rule.
9. **Each stage ships a way to test it alone**, with fixtures or a `/dev/*` page, so you never wait for the other half.

## 3. What B owns

### Folders (only you edit these)

| Path | Contents |
| --- | --- |
| `prisma/schema/b.prisma` | Your models. Your migrations are generated from it |
| `src/app/`: `approvals`, `vendors`, `audit`, `search`, `dev/quotes` | Your screens |
| `src/components/case/b/` | Case panels that are yours (below) |
| `src/workflows/b/`, `src/agents/b/` | W5 to W7, indexing and memory functions, and their prompts |
| `src/quotes/` | Reading, evidence, unit conversion, normalisation, vendor arithmetic |
| `src/compare/` | Comparative matrix, Excel and PDF export |
| `src/scoring/` | Weights, scores, risk flags, "what if" |
| `src/context/` | `getContext` (A ships a stub on Day 0; you replace the body) |
| `src/memory/` | `MemoryStore` interface and the mem0 client |
| `src/search/` | Chunking, hybrid search |
| `src/executor/handlers/b/` | Handlers for your action kinds. A owns the rest of `src/executor/` |
| `scripts/seed/b/`, `fixtures/` | Seeds for your tables, test quotes, voice notes |

### Tables you own

`vendor_performance`, `doc_chunks`, `extracted_fields`, `memory_refs`, `quotes`, `quote_lines`, `quote_terms`, `comparatives`, `scores`, `recommendations`, `decisions`.

`extracted_fields` is also written by A for BOQ evidence. Its columns are frozen on Day 0 and the rows never overlap, because each row has an `entity_type`.

### Workflows

- **W5 Quote intake**: read, normalise, flag, send low-confidence fields to review.
- **W6 Comparative and recommendation**: matrix, scoring, explanation, packet. New version on every run.
- **W7 Approval**: sends the packet to the HOD, records the decision, and requires a reason on an override.
- **Index document**: on `document.stored`, chunk and embed.
- **Remember message**: on `message.stored`, send to mem0 and write `memory_refs`.
- Later (only if time): W9 performance capture.

### Screens

Approvals (queue of everything pending, with a renderer per action kind), Vendors (profile, scorecard, history, "What we remember" panel with delete), Audit (filterable timeline), Search box (also embedded on case and vendor pages), `/dev/quotes` (upload a quote PDF and emit `quote.received` without any channel). Case panels: *Quotes* with the review screen, *Comparative*, *Recommendation* (reasons with proof links, "what if" weights), and the evidence viewer in the right rail.

### Action kinds you register

`notify_hod` (recommendation packet by email and WhatsApp link) and `performance_record` (a proposed rating that a person confirms). Vendor selection is not an action: the HOD's decision is written to `decisions` directly from an authenticated screen, and no agent code path can create one.

## 4. Build order

Each stage ends with something you can show on your own.

**Stage 1: read the four quotes (no dependency on A beyond Day 0)**
- Put the four PDFs and the tender PDF in `fixtures/` and Storage.
- `/dev/quotes`: pick a vendor and a PDF, emit `quote.received`.
- W5: Claude reads each PDF into `quotes`, `quote_lines`, `quote_terms` with source page, snippet and confidence in `extracted_fields`. Use the stronger model.
- For SK's scan, read the handwritten rates twice independently and flag any disagreement. Handwriting always goes to review.
- **Test alone:** all four quotes appear as structured rows with evidence. You can click a field and see the PDF page.

Until A's master seed lands (about the end of A's stage 1), use a small `fixtures/vendors.json` so your foreign keys resolve. Delete it once the real seed is there.

**Stage 2: normalise and review**
- Unit conversion (sq ft to sq m, running metre against square metre), quantity-mismatch flag, stale-quote flag, vendor arithmetic recomputed, the six RFQ terms marked met, not met or not stated. All plain code, no model arithmetic.
- Review screen: PDF page on one side, extracted values on the other, confirm or correct.
- **Test alone:** Purvyakruti's 13,429.53 sq ft is flagged as close to the BOQ, and the other three as a different scope (30,420). Bajrang is flagged stale.

**Stage 3: comparative and scoring**
- Matrix of BOQ lines against vendors on Vinayak's quantities; lowest per line marked; totals before GST, GST and landed total; terms grid; flags.
- Scores from computed facts using the weights in PLAN.md section 7.4. "No history" is a neutral score with a label.
- Excel export with `exceljs`.
- **Test alone:** run W6 from a button over the four read quotes. Same inputs give the same numbers every run. Every number can be re-derived.

**Stage 4: recommendation, approvals and decision**
- Claude writes the explanation only from computed facts. Every sentence links to its proof (PDF page, email, work order).
- W7: packet to HOD, approve, send back, or pick another vendor with a mandatory reason, written to `decisions`.
- Approvals page and the Recommendation panel. "What if" weights re-rank without a new model call.
- Register `notify_hod` with A's executor. Until A's executor is ready, test the handler with a small local stub that implements the frozen `registerHandler` signature.
- **Test alone:** HOD login approves the top vendor, and separately overrides with a reason. Both appear in `decisions` and in the audit page.

**Stage 5: memory, search and context**
- `MemoryStore` over mem0 (`add`, `search`, `remove`) with entity scopes. Seed the vendor anecdotes (made up by us, not the client's emails) beforehand.
- `getContext(caseId, purpose)` over SQL facts, `doc_chunks` and mem0. Memories are optional: if mem0 is down it returns the rest.
- Index-document and remember-message functions, search box with Bengali queries, Vendors page with the memory panel.
- A memory about a late vendor becomes a proposed `performance_record` that a person confirms.
- **Test alone:** a Bengali question finds the passage in an English quote. Delete a memory from the panel. Confirm a rating and see it change the next comparison.

**Stage 6: finish**
- Audit page, demo badges on seeded records, `vendor_performance` seed with a visible "demo data" label, tidy the Comparative and Recommendation panels.
- Together: the end-to-end rehearsals (section 6).

If time runs short, cut in this order: PDF export (keep Excel), mem0 (keep search), W9. Do not cut the review screen or the comparative.

## 5. Seams with A

### You consume, A emits

| Event | When | Payload (ids only) | You do |
| --- | --- | --- | --- |
| `quote.received` | W0 classified a vendor reply as a quote | `case_id`, `rfq_id`, `vendor_id`, `document_id` | W5 |
| `document.stored` | Any file saved to Storage | `document_id`, `message_id?` | Chunk and embed |
| `message.stored` | Any inbound message saved | `message_id`, `case_id?` | Send to mem0 |
| `rfq.sent` | W4 sent an RFQ | `rfq_id`, `vendor_id`, `sent_at` | Responsiveness score input |
| `rfq.due_date_passed` | Due date reached | `case_id`, `rfq_id` | W6: compare if 3 or more quotes, otherwise raise an alert |

### You emit, A may react

| Event | When | Payload |
| --- | --- | --- |
| `quote.extracted` | W5 finished, review may be pending | `quote_id`, `case_id`, `needs_review` |
| `comparative.ready` | W6 produced a new version | `comparative_id`, `case_id`, `version` |
| `recommendation.ready` | Packet ready for the HOD | `recommendation_id`, `case_id` |
| `decision.made` | HOD decided | `decision_id`, `case_id`, `vendor_id`, `overridden` |
| `performance.proposed` | A memory became a proposed rating | `action_id`, `vendor_id` |

W6 also starts automatically when all invited vendors have a quote, or the due date passes with 3 or more, or on the "Compare now" button, or when a revised quote arrives.

### You use from A (signatures frozen in `src/contracts/`)

`proposeAction(...)`, `emit(...)`, `logStep(...)`, `signedUrl(documentId)`, `getUser()` and `requireRole(role)`, the approve/reject/edit routes, and `registerHandler(kind, fn)`. You do not need A's code to run to start: Day 0 stubs are enough.

### You provide to A

`getContext(caseId, purpose)` with the frozen return shape: `{ facts, passages, memories }`, each item carrying a source id. A's agents call it from the first day with your stub.

### You never do

Touch `messages`, `documents` or `cases` rows except to read them, send mail or WhatsApp directly, call the Gmail or Evolution APIs, change `src/llm/`, or create an action kind that selects a vendor or places an order.

## 6. Done means

- Demo script steps 4 (the read), 5, 6, 7, 8 and 9 run. Step 4's channel half is A's.
- Numbers are code-computed and repeatable. Every recommendation sentence has a clickable proof.
- A non-top choice by the HOD cannot be saved without a reason.
- A site-engineer or contracts-engineer login cannot record a decision. The HOD can.
- Two joint rehearsals of the full script (PLAN.md section 13) are done with A.

## 7. Day 0 (30 to 60 minutes, together, before splitting)

**You do:**
1. Write `src/contracts/events.ts` (every event name and its payload type from section 5), `actions.ts` (the `actions` row, statuses, `ActionKind` union that each owner extends in its own file), `context.ts` (the `getContext` and `MemoryStore` signatures).
2. Put the sample PDFs and sheets in `fixtures/`, plus `fixtures/vendors.json`.
3. Write `.env.example` with a section each, and the Inngest serve route that merges `workflows/a/index.ts` and `workflows/b/index.ts`.
4. Add the stub `src/context/index.ts` returning empty results.

**A does** (you review): the repo skeleton, `prisma/schema/*.prisma` (check every column you will read or write), `CODEOWNERS`, the case-page frame and nav that import `case/a/tabs.ts`, `case/b/tabs.ts`, `nav.a.ts` and `nav.b.ts`.

**Agree together, then freeze:** event names and payloads, the `actions` row, the `getContext` signature, and which of you hosts the shared Supabase project.

## 8. Sync points (10 minutes each)

| When | Check |
| --- | --- |
| End of stage 1 | A's master seed is in. Switch off `fixtures/vendors.json` |
| End of stage 2 | A's executor runs your `notify_hod` handler through the real route |
| End of stage 3 | A's `quote.received` from a real mailed PDF makes your W5 run |
| End of stage 5 | Full chain on the shared project: RFQ out, reply back, comparison starts by itself |
| Before the demo | Both rehearsals, one person at the keyboard each |

## 9. Keys and accounts you hold

mem0 key, the vendor mailbox (your Gmail and its plus-addresses, which you give to A for the vendor seed), your own copies of the Sarvam and Anthropic keys. Put them in your own `.env`. You do not need the Google OAuth client, Evolution key or WhatsApp number.
