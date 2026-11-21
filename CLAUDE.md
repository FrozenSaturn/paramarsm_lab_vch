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
- **Embeddings.** `src/lib/embeddings.ts` runs `multilingual-e5-small` on this machine. It gives 384 dimensions.
- **RFQ terms.** `src/lib/rfq-terms.ts` holds the six standard terms.

## Not built yet (Person A)

- The Gmail OAuth flow, drafts, the poller and the `send_email` handler.
- Triage (W0), the BOQ check (W1), item-code mapping (W2), tender preparation (W3), dispatch and chase (W4).
- WhatsApp through Evolution API, and Sarvam speech and translation.
- The ERP import sheet, the hygiene report and the "view as" switch.
- `emit()` only writes to the `events` table. It does not send events to Inngest yet.

## Decisions

- There is no outbound sandbox. Mail goes where the user sends it. Test the send path locally. The plus-address plan (`name+bajrang@gmail.com`) still keeps vendor mail in one inbox for the demo.
- The seed does not call a model. Vendor categories for the Aquina list come from name rules and have `inferred = true`.

## Known issues

- `src/llm/` is old code from an earlier project. It imports files that do not exist. Rewrite it to the interface in `PLAN.md` section 3.
- The migrations passed on Postgres 14 with a stand-in `auth` schema. They did not run on Supabase with pgvector. The first `supabase start` and `npm run db:reset` is the real test.
- Writing embeddings to `item_codes` is not tested.
- GSTIN and address are empty for Purvyakruti and Shyama. They are not in the text of the PDFs. SK has an address and no GSTIN.
- One probe showed weak Bengali-to-English similarity with the embedding model. Test it with `query:` prefixes before you use it for search.
- Prisma does not see the hand-written objects. `prisma migrate dev` can try to drop them. Use `--create-only`.

## Git

- Name branches `a/<topic>` and `b/<topic>`.
- Open a small PR into `main`. Use merge commits.
- End each commit message with the attribution lines that Claude Code gives.
