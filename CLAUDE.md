# CLAUDE.md

Project rules for the Crystal Fountain pledge platform. Read this at the start of every
session. If a request in a session conflicts with this file, stop and say so.

## What this is

A pledge platform for the Crystal Fountain Development Project, a church building fund for
Newlife SDA Church, Nairobi. Members and well-wishers record a financial pledge toward a
KES 550,000,000 target, get a reference number and a QR code, and see live campaign
progress. Real money is involved and the congregation will be watching the numbers.

Public site is a subdomain of newlifesdanairobi.org. The main church site stays on WordPress
and is not touched.

## Stack

- Next.js 15, App Router, React 19, TypeScript strict
- Tailwind v4, shadcn/ui
- Neon Postgres, Drizzle ORM, SQL migrations checked into the repo
- Zod for every input contract, shared client and server
- pnpm, exact pinned versions, no carets or tildes in package.json
- Deployed on Vercel

Environment: Windows, PowerShell. Give PowerShell commands, not bash.

Known gotcha carried over from the church's camp meeting site: build with
`next build --turbopack`. Plain `next build` produced an incompatible routes manifest.

## Non-negotiable rules

Money:
- All amounts are `bigint` in minor units (cents). Never float, never the `money` type,
  never a JavaScript `number` for a total.
- Any operation touching money runs in a single transaction or not at all.
- Corrections are new rows, not edits. A wrong payment is fixed with a reversal row.
- Totals are always read from the database. Never from config, a constant, or a CMS.

Identity and privacy:
- Do not collect national ID numbers in v1. The schema has the encrypted columns for later,
  the form does not use them and no endpoint accepts them.
- Consent checkboxes are separate and never pre-ticked: record the pledge, contact me,
  display me publicly.
- Public endpoints return aggregates and consented display names only. Never a phone
  number, never an email, never a full contact record.
- Nothing personal goes in a QR code. The QR encodes a URL and nothing else.

Security:
- Pledge lookup URLs use an unguessable 22 character nanoid token, never the sequential
  reference.
- No tokens in localStorage. Admin sessions are httpOnly, Secure, SameSite=Lax cookies.
- Every admin write appends a row to `audit_log`. No exceptions.
- Zod validation server side on every route handler. Client validation is convenience only.
- Every pledge passes Cloudflare Turnstile before it is recorded. Verification is skipped
  only outside production and only when both keys are absent. A half configured pair is an
  error, and absent keys in production refuse the pledge rather than open the door.
- Five pledges per phone number per hour, counted from pledge_increments in the database so
  the limit holds across instances and survives a redeploy.
- Sentry PII scrubbing is configured before the first production deploy.

Architecture:
- All business logic lives in `src/server/` as plain functions taking a db handle and a typed
  input. They never touch `Request`, `Response`, cookies, or `next/headers`.
- Route handlers under `src/app/api/` are thin adapters: parse, call the service, format.
- This keeps the domain portable if the API is later split out to Fastify.

## Reference format

- Human reference: `CF26-000124`. Maximum 12 characters, because Safaricom's Daraja
  `AccountReference` field caps at 12 and this string will be used as an M-Pesa account
  number later. Do not lengthen it.
- Public token: 22 character nanoid, used in `/p/<token>` and in the QR.

## Working method

- One bounded task per session, roughly 500 lines of change. If a task is bigger, stop and
  propose a split before writing code.
- Commit after every working chunk with a clear message. Do not batch a whole session into
  one commit.
- Verify against the database with SQL, not application logs. After any change that affects
  totals, run the verification query and show the output.
- Do not install a dependency without saying why and pinning the exact version.
- Do not refactor code you were not asked to touch.
- If something is ambiguous, ask one question and wait. Do not guess and build.

## Definition of done for a session

1. `pnpm build` passes.
2. Migrations apply cleanly on a fresh Neon branch.
3. The SQL verification query for that session returns the expected result, pasted in the
   session summary.
4. Committed and pushed.
5. A three line summary of what changed and what the next session should pick up.

## Not in v1

Do not build these unless explicitly asked, even if they seem useful:

- M-Pesa or any payment integration. Manual payment entry by the treasurer only.
- Member accounts, login, or personal dashboards.
- SMS OTP. v1 gates pledges with Cloudflare Turnstile and an approval limit instead: a
  submission that passes the bot check and whose pledge total lands under
  PLEDGE_AUTO_APPROVE_LIMIT_KES is verified on the spot, and anything at or above that
  waits for the treasurer. The schema and service layer are written so OTP drops in later
  without a rewrite.
- Charts and analytics beyond the single progress tracker. The daily snapshot table is
  populated from day one so the history exists when charts are built.
- Machine learning of any kind.
- A CMS. Content pages are typed data in the repo.

## Copy rules

- Plain sentence case. No all-caps labels.
- The button says "Make a pledge". The success state says "Your pledge is recorded".
- The confirmation page must state clearly that a pledge is a promise to give, not a
  payment, and that the treasurer's receipt is the only receipt.
- No em dashes anywhere in copy or code comments.
