# Person A: platform, channels and the front half (site message to RFQ sent)

You are Builder 1 in `PLAN.md` section 13. You sign in as the contracts engineer and own the "Vinayak contracts" mailbox. This file replaces the split table in PLAN.md section 13. Everything else in PLAN.md still applies.

Person B has a matching file, `docs/WORK_PERSON_B.md`. Read its "What B owns" section once so you know which folders are off limits.

## 1. The idea in one paragraph

You own everything from "a message arrives" to "RFQs are sent and being chased", plus the platform every workflow stands on (login, permissions, the approve-and-execute machinery). B owns everything from "a quote file arrives" to "the HOD decides", plus search, memory and the audit, vendor and approvals screens. The two halves meet at a short list of events and function signatures (section 5). Neither of you edits the other's folders, so there is nothing to merge-conflict on.

## 2. Ground rules (identical in B's file)

1. **Own folders, own tables.** You may edit only the paths in section 3. To change anything of B's, open an issue labelled `for-B`. Don't "just fix it".
2. **Frozen contract.** After Day 0 the files in `src/contracts/` and `prisma/schema/base.prisma` and the first two migrations in `prisma/migrations/` change only by a PR the other person approves. This covers event names, payload shapes, the `actions` row, table columns used by both sides, and the `getContext` signature.
3. **Talk through events, not imports.** If your code needs something the other person builds, it waits for an event or calls a function whose signature is in `src/contracts/`. Never import from the other person's folder.
4. **Own database, own machine.** Each of you runs a local Supabase (`supabase start`) and a local Inngest dev server. The shared cloud Supabase project is for integration runs and the demo only. Reset your local database whenever you like.
5. **Migrations don't collide (Prisma Migrate).** The schema is split into `prisma/schema/base.prisma` (shared, frozen), `a.prisma` (A) and `b.prisma` (B). Only the owner edits their file. B's models refer to A's tables by plain uuid columns with **no Prisma relation and no foreign key**, so A's file never needs a back-relation from B; A's models never refer to B's. To change your tables: edit your `.prisma` file, run `npm run db:migrate -- --name <what>` (this is `prisma migrate dev --create-only`), read the generated SQL, delete any line that drops an hnsw, trigram or partial index or a CHECK (Prisma cannot see them), then `npm run db:deploy`. **Rebase on `main` before generating, and merge the migration PR the same day**, because migration folders are ordered by timestamp. Policies, triggers and functions go in a hand-written migration of your own, never into someone else's.
6. **One ingester.** `RUN_INGEST=true` only on A's machine. B's is always `false`. Otherwise every Gmail message is processed twice.
7. **Shared files are append-only and tiny:** `package.json` (add your own dependencies; whoever merges second re-runs `npm install`), `.env.example` (each person has a marked section) and `CODEOWNERS`. Merge those PRs the same day.
8. **Branches.** `a/<topic>` and `b/<topic>`. Small PRs into `main`, rebase on `main` at least twice a day, the other person only skims. `CODEOWNERS` makes GitHub enforce the folder rule.
9. **Each stage ships a way to test it alone**, with fixtures or a `/dev/*` page, so you never wait for the other half.

## 3. What A owns

### Folders (only you edit these)

| Path | Contents |
| --- | --- |
| `prisma/schema/a.prisma` | Your models. Your migrations are generated from it |
| `src/app/` shell: `layout`, `login`, `inbox`, `cases`, `cases/[id]`, `settings`, `api/auth`, `api/actions`, `api/webhooks`, `api/inngest` | App shell, case workspace frame, settings |
| `src/components/case/a/` | Case panels that are yours (below) |
| `src/channels/` | `gmail/`, `whatsapp/`, `ChannelAdapter` and `MailAdapter` |
| `src/executor/` | `proposeAction`, `approveAction`, `rejectAction`, handler registry, receipts |
| `src/workflows/a/`, `src/agents/a/` | W0 to W4 and their prompts |
| `src/llm/` | The existing model interface (`sarvam.ts`, `claude.ts`). B uses it and does not edit it. Ask for changes |
| `src/lib/` | `supabase`, `auth`, `rbac`, `storage`, `steps` (agent step logger), `embeddings` |
| `src/erp/` | `ErpAdapter`, hygiene report, import-sheet writer |
| `scripts/seed/a/`, `docker/` | Seeds for your tables, Evolution compose file |

### Tables you own

`allowed_users`, `profiles`, `projects`, `people`, `vendors`, `vendor_contacts`, `vendor_categories`, `messages`, `documents`, `cases`, `boq_versions`, `boq_lines`, `item_codes`, `code_aliases`, `code_proposals`, `rfqs`, `rfq_recipients`, `actions`, `receipts`, `events`, `agent_steps`.

### Workflows

- **W0 Triage** and **W1 Requirement and BOQ check**
- **W2 Item-code mapping**, including the hygiene report and the alias learning
- **W3 Tender preparation** (duplicate-tender alert, shortlist, tender pack, RFQ drafts)
- **W4 Dispatch and chase**, with one timed reminder

### Screens

Inbox, Cases board, the Case workspace frame (three columns, tab registry, live activity panel), Settings (mailbox, WhatsApp pairing, "view as"), Item codes page, and the case panels *Conversation*, *BOQ*, *Codes*, *RFQ drafts* (the editor for RFQs and clarifications).

### Action kinds you register

`send_email`, `send_whatsapp`, `send_clarification`, `send_rfq_batch`, `send_reminder`, `new_item_codes`, `erp_import_sheet`.

## 4. Build order

Each stage ends with something you can show on your own.

**Stage 1: foundation (do first, B is waiting on some of it)**
- Day 0 tasks (section 7).
- Local Supabase with pgvector, RLS and `app_role()`, Google sign-in, `allowed_users` seed.
- `proposeAction`, `approveAction`, `rejectAction`, `emit(event)` and `logStep()`. These can be 20-line versions first. B needs them in the first half day.
- Master seed: projects, people, vendors (four quoting vendors plus 66 Aquina names), vendor categories, item codes with embeddings, the six RFQ terms. B needs vendors early for quote matching, so ship this before anything else in the seed.
- Inngest wired in, with `src/workflows/a/index.ts` exporting your functions.
- **Test alone:** sign in, see an empty case page, approve a dummy action from a `/dev/actions` page, see the receipt.

**Stage 2: sending mail**
- Gmail OAuth with offline access, refresh-token storage, `drafts.create`, `drafts.send`.
- Executor handlers for `send_email`.
- **Test alone:** create a draft in the app, edit it, approve it and see it in your Gmail Sent folder and as a receipt. 

**Stage 3: receiving mail**
- Gmail poller (60 s, `historyId`, de-dupe on message id), quoted-chain splitting, thread and `[VIN-RFQ-####]` token matching.
- W0 Triage: classify and link to a case. Emits `message.stored`, `document.stored`, then either `message.received` or `quote.received` (section 5).
- **Test alone:** send yourself an email with a PDF. A message row, a document row and the events appear. Use any PDF; the quote itself is B's job.

**Stage 4: WhatsApp, voice and BOQ**
- Evolution API in Docker, webhook (reuse commit `3401fe1`), allow-list, media download, ffmpeg decode, Sarvam speech-to-text and translation. Voice note becomes message plus transcript plus English text.
- W1: parse the BOQ with `exceljs`, run the checks, draft the clarification to site.
- W2: candidates (embeddings plus trigram), judge, thresholds, aliases, proposal of new codes, hygiene report page.
- **Test alone:** upload the Amara quantity sheet at `/dev/upload`. Eight BOQ lines appear with two flagged. `WP.08` stops for a human choice. The hygiene report lists the duplicates.

**Stage 5: tender**
- W3: duplicate-tender alert, shortlist from categories, tender pack, one RFQ draft per vendor with HO in CC, batch approve.
- W4: send, record receipts, set due date, one reminder on a short timer, and emit `rfq.due_date_passed`.
- **Test alone:** from an accepted BOQ, four RFQs go out to B's plus-addresses and receipts show. Replies are B's inbox, so also check one by eye.

**Stage 6: finish**
- ERP import sheet export, "view as" switch, polish the case frame, Settings page.
- Together: the end-to-end rehearsals (section 6).

If time runs short, cut in this order: WhatsApp voice (use `/dev/upload`), W4 reminder, ERP sheet. Do not cut the executor or Gmail send.

## 5. Seams with B

### You emit, B consumes

| Event | When | Payload (ids only) | B does |
| --- | --- | --- | --- |
| `message.stored` | Any inbound message saved | `message_id`, `case_id?` | Sends text to mem0 and records `memory_refs` |
| `document.stored` | Any file saved to Storage | `document_id`, `message_id?` | Chunks and embeds into `doc_chunks` |
| `quote.received` | W0 classified a vendor reply as a quote | `case_id`, `rfq_id`, `vendor_id`, `document_id` | W5 reads the quote |
| `rfq.sent` | W4 sent an RFQ | `rfq_id`, `vendor_id`, `sent_at` | Uses it for the responsiveness score |
| `rfq.due_date_passed` | Due date reached | `case_id`, `rfq_id` | W6 decides whether to compare or alert |

### You consume, B emits

| Event or function | What you do |
| --- | --- |
| `performance.proposed` | Nothing. B shows it. You only have to keep `vendors` ids stable |
| `getContext(caseId, purpose)` in `src/context/` | Call it from your agents. A stub returning SQL facts only exists from Day 0. B replaces the body, so your calls never change |

### You provide to B (signatures frozen in `src/contracts/`)

`proposeAction(kind, caseId, payload, opts)`, `approveAction(id, userId, edits?)`, `rejectAction(id, userId, reason)`, `emit(name, payload)`, `logStep(...)`, `signedUrl(documentId)`, and the HTTP routes `POST /api/actions/:id/approve|reject|edit`. B's handlers plug into your registry with `registerHandler(kind, fn)`.

### You never do

Read quote PDFs, compute a comparative, score, write `quotes*`, `scores`, `recommendations`, `decisions`, touch mem0 or `doc_chunks`.

## 6. Done means

- The demo script steps 1, 2 and 3 run on real channels, and step 4's mail reaches B's inbox and is classified correctly.
- Every send has a receipt with payload hash, approver and provider id.
- Anyone not on `allowed_users` sees nothing. A site-engineer login cannot approve.
- Two joint rehearsals of the full script (PLAN.md section 13) are done with B.

## 7. Day 0 (30 to 60 minutes, together, before splitting)

**You do:**
1. Create the repo structure above, `create-next-app`, `supabase init`, `CODEOWNERS`.
2. Write the Prisma schema and first two migrations (`prisma/`): every table from PLAN.md section 12 with agreed columns, plus the `app_role()` helper. B reviews the columns it will use.
3. Write the stub bodies of `proposeAction`, `emit`, `logStep`.
4. Create the Case page frame that imports `case/a/tabs.ts` and `case/b/tabs.ts` (both empty to begin with) and the nav that imports `nav.a.ts` and `nav.b.ts`.

**B does** (you review): `src/contracts/events.ts`, `actions.ts` and `context.ts`; fixtures; `.env.example`; the Inngest route that merges `workflows/a` and `workflows/b`.

**Agree together, then freeze:** event names and payloads (section 5), the `actions` row, the `getContext` signature, and which of you hosts the shared Supabase project.

## 8. Sync points (10 minutes each)

| When | Check |
| --- | --- |
| End of stage 2 | You: approve a dummy action. B: runs its stub handler through your route |
| End of stage 3 | Your `quote.received` makes B's W5 run on a PDF you mailed |
| End of stage 5 | Full chain on the shared project: RFQ out, reply back, comparison starts |
| Before the demo | Both rehearsals, one person at the keyboard each |

## 9. Keys and accounts you hold

Google OAuth client (both of you added as test users), Evolution API key and the WhatsApp number, Sarvam key, Anthropic key. Put them in your own `.env`. B has its own copies of the model keys, the mem0 key and the vendor mailbox address.
