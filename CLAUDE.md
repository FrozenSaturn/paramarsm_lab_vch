# Vinayak procurement agent

This repository holds a workspace for a contracts engineer. It takes a work package from site requirement to approved vendor. Agents read, match, draft and compare. A person approves each message and each decision.

Read `PLAN.md` for the full design. Read `docs/WORK_PERSON_A.md` and `docs/WORK_PERSON_B.md` for the work split.

## Writing style

Write all docs and explanations in Simplified Technical English (ASD-STE100). Follow it for about 80% of the text.

- Use short sentences. Keep procedure steps to 20 words or fewer.
- Use the active voice and the simple present tense.
- Give one instruction in each sentence.
- Use one word for one meaning. Do not change a term in the middle of a document.
- Use simple words. Do not use idioms or slang.
- Put a command or a code name in backticks.

## Who owns what

- **Person A** owns the platform, the channels and the front half: site message to RFQ sent.
- **Person B** owns the back half: quote file to HOD decision. B also owns memory, search and `getContext`.
- Edit only your own folders. The list is in the two work docs.
- Do not import code from the other person's folders. Use events and the function signatures in `src/contracts/`.
- Change `src/contracts/` only through a PR that both people approve.

## Commands

| Command | Use |
| --- | --- |
| `npm run dev` | Start the web app |
| `npm run typecheck` | Check the types |
| `supabase start` | Start local auth, storage and Postgres. Needs Docker |
| `npm run db:reset` | Reset the local database and apply all migrations |
| `npm run db:migrate -- --name <name>` | Create a migration without applying it |
| `npm run db:deploy` | Apply migrations |
| `npm run seed` | Load the demo data. It is safe to run again |
| `npm run inngest` | Start the Inngest dev server |

## Database

- Prisma Migrate manages the schema. The schema files are in `prisma/schema/`: `base.prisma` (shared), `a.prisma` and `b.prisma`.
- Prisma cannot describe some objects. These are in the hand-written migration `prisma/migrations/20261121000100_rls_triggers_indexes/`. They are CHECK constraints, HNSW and trigram indexes, the `app_role()` function, the `auth.users` trigger, the foreign keys into `auth.users`, row-level security and the Realtime publication.
- Always create a migration with `--create-only`. Read the SQL. Delete each line that drops one of the objects above. Then apply it.
- Tables of B refer to tables of A with a plain `uuid` column. Do not add a Prisma relation or a foreign key for these.
- Rebase on `main` before you create a migration. Merge the migration PR on the same day.
- Row-level security is on for every table. The app writes with the service key from the server only.

## What Person A built

This list is the state of `main`.

- **Scaffold.** Next.js 15, React 19, TypeScript, Inngest, Supabase clients. The `tsconfig` excludes `src/llm/`.
- **Contracts.** `src/contracts/` holds the event payloads, the action row, the `ActionKind` union, and the `getContext` and `MemoryStore` signatures. `src/context/index.ts` is a stub that returns empty results. B replaces its body.
- **Executor.** `src/executor/index.ts` has `proposeAction`, `editAction`, `rejectAction`, `approveAction` and `registerHandler`.
  - Each function checks the role of the user in the database. The check does not trust the UI.
  - `approveAction` claims the action in one atomic update. A double click cannot run it twice.
  - `approveAction` writes a receipt with a hash of the payload.
  - The routes are `POST /api/actions/:id/approve`, `reject` and `edit`.
  - Handlers are in `src/executor/handlers/a/` and `src/executor/handlers/b/`. Add each handler to `src/executor/register.ts`.
- **App shell.** `src/app/` has the layout, login, Google callback, Inbox, Cases, the case page, Settings and `/dev/actions`.
  - The nav comes from `nav.a.ts` and `nav.b.ts`.
  - The case tabs come from `src/components/case/a/tabs.ts` and `src/components/case/b/tabs.ts`.
  - Each page calls `requirePageUser()`. The page `/dev/actions` needs the `admin` role and returns 404 in production.
- **Auth.** Google sign-in asks for the Gmail scopes with offline access. The callback saves the refresh token in `mail_tokens`. A trigger creates a profile only for an email in `allowed_users`.
- **Seed.** `npm run seed` loads these items:
  - users from `SEED_USERS`, 3 projects and 7 people;
  - 4 vendors that quoted and 65 vendors from the Aquina list;
  - 76 ERP item codes, with the duplicates kept on purpose;
  - the Amara Tower-2 case with 8 BOQ lines (`WP.03` and `WP.08` are not measured);
  - 2 past cases with RFQs, which are made-up data.
- **Gmail send.** `src/channels/gmail/` has the Gmail client, the MIME builder and the draft functions.
  - The client reads the refresh token from `mail_tokens`. The library gets a new access token when it needs one.
  - `createDraft`, `updateDraft`, `sendDraft` and `sendMail` call the Gmail API.
  - The MIME builder encodes non-ASCII subjects and removes line breaks from header values.
  - The `send_email` handler is in `src/executor/handlers/a/send-email.ts`. It sends the approved payload from the mailbox of the approver. It saves the sent mail in `messages`. For an RFQ it updates `rfq_recipients` and emits `rfq.sent`.
  - The page `/dev/mail` tests the path: create a draft, propose the action, approve it.
- **Gmail poll.** `src/channels/gmail/poller.ts` reads new mail from the inbox.
  - The first poll sets a starting point and imports nothing. Old mail is not imported.
  - It stores the raw `.eml` file in Storage first. Then it parses the mail with `mailparser`.
  - `quoted.ts` cuts the quoted chain. The newest part is the message body.
  - A reply links to its RFQ by Gmail thread. If that fails, it uses the `[VIN-RFQ-####]` token in the subject.
  - A `From` header is not proof of the sender. The poller links a mail to a case, an RFQ or a vendor only when these checks pass (code in `src/channels/gmail/auth-results.ts`): the mail has exactly one From address; the first `Authentication-Results` entry names `mx.google.com`; its `dmarc` result is `pass` (comments are removed first); its `header.from` equals the domain of the From address; and the sender is a recipient of that RFQ. Otherwise the mail stays unmatched. A subject token with no passed check gets the classification `unverified_reply`. A person must review it.
  - The sender check ignores case. It ignores a `+tag` only for `gmail.com` and `googlemail.com`. An address with more than one `@`, or with quotes or spaces, never matches. If several vendors share one mailbox and no thread names the vendor, the vendor stays empty and no `quote.received` is sent.
  - A failed attachment removes the message row, so the next poll starts again. Events go out only after everything is stored. If one message keeps failing, the poller logs a failed step in `agent_steps` and continues with the other mail.
  - The unique index on `(case_id, sha256)` ignores a file that is already stored in the same case. Such a file sends no new events.
  - **Allowed senders only.** The poller stores a mail only when the sender is a site person or vendor contact in the database, or is in `GMAIL_ALLOW_SENDERS` (`src/channels/gmail/allow.ts`). Other mail is not stored, because a mailbox can hold personal mail and stored text goes to triage (Claude) and search. If `GMAIL_ALLOW_SENDERS` is not set at all, every sender is allowed: always set it.
  - It saves attachments to Storage and `documents`. It skips a mail that is already stored.
  - It emits `message.stored`, `document.stored` and `quote.received`. The `quote.received` event needs a known RFQ and vendor.
  - The classification `vendor_reply` is a rule for now. Triage (W0) will replace it.
  - The Inngest function `gmail-poll` runs every minute. It runs only when `RUN_INGEST=true`.
  - `emit()` starts Inngest workflows when `EMIT_DISPATCHES_TO_INNGEST=true`. Set this on every machine.
- **BOQ check (W1).** Code is in `src/boq/`.
  - `parse.ts` reads a BOQ sheet cell by cell. It finds the header row, the unit column, the quantity column and the part columns. It works on the Amara and the Aquina sheets.
  - `check.ts` runs these checks: not measured, quantity not more than zero, no unit, unknown unit, parts do not add up to the total, sqm and sqft disagree, duplicate serial, duplicate description, grand total, and (with the site message) no dates and no scope.
  - `clarificationDraft` writes a plain message to site from the findings.
  - A file that is not a BOQ does not crash. `runBoqCheck` records a failed step with the reason and returns `{ failed: true }`. The case page shows it in Agent activity.
  - `pipeline.ts` (`runBoqCheck`) saves a new `boq_versions` row and the lines, saves each finding in `extracted_fields` (entity `boq_version`), and proposes a `send_clarification` action. The `send_clarification` action uses the same handler as `send_email`.
  - Pages: `/dev/boq` (upload a sheet), `/cases/[id]/boq` (checks, lines, editable clarification, Accept BOQ). Accept BOQ emits `boq.accepted`.
- **Item-code mapping (W2).** Code is in `src/codes/` and `src/erp/`.
  - `src/erp/hygiene.ts` builds the hygiene report. The page is `/item-codes`.
  - `candidates.ts` finds the 10 nearest codes by embedding and the 10 nearest by trigram. Two SQL functions do this (migration `20261121100000_item_code_search_fns`).
  - `attributes.ts` reads place, surface, grouting type, height and variant from a description.
  - `judge.ts` is the rule-based judge. It gives each code a score from description match, embedding, attributes and site code. A conflict in place, surface, grouting or height cuts the score. Thresholds: auto at 0.78 with a margin of 0.06, new below 0.45. The result is `auto`, `review` or `new`, with reasons.
  - `pipeline.ts` saves the suggestion as a `code_suggestion` flag on each `boq_lines` row. `confirmCode` checks the role, sets the code and saves an alias in `code_aliases`. The next BOQ with the same wording maps at once. It emits `codes.confirmed` when every line has a code.
  - A new code is proposed in `code_proposals` and follows the pattern of the nearest code. Nothing goes to the ERP.
  - Page: `/cases/[id]/codes`. The Inngest function `w2-code-mapping` starts on `boq.accepted`.
  - `model-judge.ts` is the model judge. Claude (`CODE_JUDGE_MODEL`, default `claude-sonnet-5-5`) picks one of the numbered candidates or none. It has no tools and a fixed output schema. It can only choose from candidates that the search found. The prompt version is `code-judge-v1`.
  - `combine()` in `judge.ts` joins the two answers. A line is auto-matched only when the rules say `auto`, Claude picks the same code with a confidence of 0.8 or more, and Claude does not say that the site code means something else. In all other cases the line goes to review, with both reasons and the Claude choice shown first. If the model call fails, the rule answer stays and a warning is added.
  - Set `CODE_JUDGE=rules` to run the rules only. The model judge also needs `ANTHROPIC_API_KEY`.
  - Each model call writes an `agent_steps` row with the model, the prompt version and the token counts.
- **Tender preparation (W3).** Code is in `src/tender/`.
  - `shortlist.ts` reads the work category from the item codes. It lists vendors in that category. A stated category ranks above a guessed one. Past replies add weight. It warns when fewer than 3 vendors have a contact email.
  - `similar.ts` is the duplicate-tender alert. It compares shared item codes, quantities within 20%, line wording and project with other cases that have an RFQ. It warns and never blocks.
  - `pack.ts` builds the tender pack: an Excel sheet with Vinayak's lines and quantities, the rate column empty, and the six terms. It also builds the RFQ mail. The subject has `[VIN-RFQ-####]`.
  - `prepare.ts` (`prepareTender`) needs an accepted BOQ with a code on every line. It creates the `rfqs` row (next number `RFQ-0032`, due date +7 days unless you set one), the recipients, a real Gmail draft per vendor (with the pack attached), and one `send_email` action per vendor. It sends nothing. A second call returns the open RFQ.
  - `batch.ts` approves all drafts of one RFQ in one call. It needs the `contracts_engineer` or `admin` role. Each mail is still its own action with its own receipt. It emits `rfq.approved` only when the RFQ changes from draft to sent.
  - Page: `/cases/[id]/tender`. The Inngest function `w3-tender-prep` starts on `codes.confirmed`.
- **Dispatch and chase (W4).** `chase.ts` plans one reminder per silent vendor and the due-date event. The Inngest function `w4-dispatch-chase` starts on `rfq.approved`. It waits `REMINDER_AFTER_MINUTES` (default 72 hours), proposes reminders (`send_reminder`, a person approves each), waits for the due date, then emits `rfq.due_date_passed`. It needs the Inngest dev server to run the waits.
- **Mail handler.** `send_email`, `send_clarification` and `send_reminder` use one handler. Record ids and attachments come from the proposed payload only. Attachments are Storage paths. `MAIL_DRY_RUN=true` runs everything except the Gmail call. Use it for tests and demos.
- **Triage (W0).** Code is in `src/triage/`. Claude (`TRIAGE_MODEL`, default `claude-haiku-5-5`) labels each message: requirement, quote, vendor question, approval reply or noise. The poller emits `message.received` for mail that no RFQ rule claimed.
  - A case opens on its own only when the sender is verified (`messages.sender_verified`), is a known person in `people`, and the label is a requirement with a confidence of 0.8 or more. A BOQ sheet on that mail is read at once.
  - A reply in a known thread joins the case only from a verified sender who is a known participant. It never starts a BOQ check by itself.
  - A label from a rule (`vendor_reply`, `unverified_reply`) is never overwritten.
  - In all other cases the mail waits in the Inbox. The buttons "Sort it" and "Open case from this mail" are for people.
- **ERP import sheet.** `src/erp/import-sheet.ts` builds the sheet. The action `erp_import_sheet` writes it to Storage. It never writes to Farvision. The column layout is a placeholder until the client gives the Farvision template. The codes page has the request and the download link.
- **Settings and "view as".** `src/components/settings/SettingsPanels.tsx` shows the Gmail status, a poll button, the users, the approval policy and the model settings. An admin can use "view as" to show another role's screens. It changes what pages and server actions allow in the app. It adds no rights, and the executor checks the stored role.
- **Case workspace.** `src/components/case/a/CasePanels.tsx` shows the conversation, the pending actions (approve or reject) and the agent activity. `LiveRefresh.tsx` refreshes the page when the case gets a new step, action or message (Supabase Realtime).
- **WhatsApp (app side).** B built the bridge in `services/whatsapp` (Evolution API, a webhook, a store, a send API). The app side is in `src/channels/whatsapp/`.
  - `bridge.ts` is the client for the bridge: health, status, send text, send media, download media. The bridge token stays on the server.
  - The bridge posts each new message to `POST /api/webhooks/whatsapp` (its `FORWARD_URL`). The route needs `Authorization: Bearer <WHATSAPP_FORWARD_TOKEN>`. It compares the token in constant time.
  - `ingest.ts` stores a message only when the sender number is on the allow-list: `people.phone`, `vendor_contacts.phone` or `WHATSAPP_ALLOW_NUMBERS`. Other numbers are dropped and not stored. A number must be a full international number (country code included, 11 to 15 digits). Every digit must match. There is no suffix matching, because a number from another country could end in the same digits. An entry without a country code is ignored and a warning is logged. The seed refuses it. Own messages and status updates are skipped.
  - A stored message has `channel = whatsapp`, `thread_id = chat JID` and `sender_verified = true`. Files go to Storage and `documents`. If a file fails, the message row is removed, so the bridge can send it again.
  - A vendor file links to an RFQ only when the vendor has exactly one open RFQ, or the message names it (for example `RFQ-0032`). Otherwise a person decides.
  - A voice note is stored and marked `voice_note`. It is not transcribed and not triaged yet.
  - Triage finds a known person by phone for WhatsApp, by email for mail (`personFor` in `src/triage/triage.ts`). A BOQ sheet from a known person opens a case. The clarification then goes back over WhatsApp (`send_whatsapp`).
  - The `send_whatsapp` handler (`src/executor/handlers/a/send-whatsapp.ts`) sends only to an allow-listed number. It limits sends to `WHATSAPP_MAX_PER_HOUR` (default 20). Attachments come from the proposed payload only. `MAIL_DRY_RUN=true` also skips the bridge call. RFQs go by email, not WhatsApp.
  - The Settings page shows the bridge state, the phone link and the allow-list size.
  - To start: in `services/whatsapp` run `npm install`, `npm run up`, then `npm run wa -- link` and scan the QR code. Put numbers in `people.phone` with `SEED_PEOPLE_PHONES` and `SEED_VENDOR_PHONES` in `.env`, then run `npm run seed`. On Linux, the bridge needs `extra_hosts: host.docker.internal:host-gateway` to reach the app.
- **Embeddings.** `src/lib/embeddings.ts` runs `multilingual-e5-small` on this machine. It gives 384 dimensions.
- **RFQ terms.** `src/lib/rfq-terms.ts` holds the six standard terms.

## Not built yet (Person A)

- Sarvam speech to text and translation. Voice notes from WhatsApp are stored but not transcribed.
- A real phone has not been linked yet. WhatsApp was tested against a stand-in bridge.

## Decisions

- There is no outbound sandbox. Mail goes where the user sends it. Test the send path locally. The plus-address plan (`name+bajrang@gmail.com`) still keeps vendor mail in one inbox for the demo.
- The seed does not call a model. Vendor categories for the Aquina list come from name rules and have `inferred = true`.

## Known issues

- On the Amara BOQ, Claude is stricter than the rules. It sends lines 4, 5 and 6 to review because the site wording is wider than the master (for example "kitchen & wash part" against "kitchen"). Decide with the client if that wording should auto-match when the site code is the same. If yes, change the prompt, and check it on more BOQs first.
- The master has a block of B codes that is shifted by one against the first block. For example, `WP.04.B` is kitchen floor at serial 24 and kitchen wall at serial 65. The hygiene report shows this. A person must decide which meaning is right before the ERP is changed.
- Use TypeScript 5. Next.js 15 does not support TypeScript 7. With TypeScript 7 the build ignores the `@/` paths.
- Do not use the `googleapis` package. Its types use too much memory in the Next.js build. Use `@googleapis/gmail` and `google-auth-library`.
- Add `http://localhost:3000/auth/callback` to the redirect URLs in the Supabase dashboard (Authentication, URL Configuration).
- Real RFQs have not been sent. Tests used `MAIL_DRY_RUN`. A Gmail draft with the attachment was created and deleted in a real mailbox. The batch send, the reminder and the due-date event have not run with Inngest.
- `src/llm/` is old code from an earlier project. It imports files that do not exist. Rewrite it to the interface in `PLAN.md` section 3.
- The migrations passed on Postgres 14 with a stand-in `auth` schema. They did not run on Supabase with pgvector. The first `supabase start` and `npm run db:reset` is the real test.
- Writing embeddings to `item_codes` is not tested.
- GSTIN and address are empty for Purvyakruti and Shyama. They are not in the text of the PDFs. SK has an address and no GSTIN.
- One probe showed weak Bengali-to-English similarity with the embedding model. Test it with `query:` prefixes before you use it for search.
- Prisma does not see the hand-written objects. `prisma migrate dev` can try to drop them. Use `--create-only`.

## Git

- Stage only your own files with `git add <file>`. Do not use `git add -A` or `git add .`. The working tree can hold uncommitted work of other people, for example the design files (`globals.css`, `src/components/shell/`, `src/components/ui.tsx`). If a file holds your change and their change, stage only your part.
- A committed page must not import an uncommitted file. Check the staged state alone before you push.
- Name branches `a/<topic>` and `b/<topic>`.
- Open a small PR into `main`. Use merge commits.
- End each commit message with the attribution lines that Claude Code gives.
