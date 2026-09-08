# Crystal Fountain Development Project
## Pledge platform: architecture and implementation plan

Prepared for Newlife SDA Church Nairobi. Source content analysed from
https://newlifesdanairobi.org/church-development-draft/ (fetched 8 Sept 2026).

Status of this document: proposal. Every figure taken from the existing page is marked as
such. Anything I could not verify is flagged.

---

## 0. What I read on the existing page, and what it tells us

Facts extracted (all from the draft page, so treat them as "what the church has published",
not as independently verified project data):

| Item | Value on the page |
|---|---|
| Project name | Crystal Fountain Development Project, draft proposal 2025 |
| Site | Existing church property, 5th Ngong Avenue, Nairobi |
| Main auditorium | 3,000 to 5,000 seats |
| Parking | up to 700 vehicles, basement, three levels |
| Estimated construction cost | KES 500M to 600M, described as preliminary |
| Targeted construction start | 2026 |
| Fund launch | KES 10M target, 5 July 2025 |
| Design finalised | target October 2025 |
| Other spaces | smaller auditoriums, library, church history museum, offices, classrooms, landscaped grounds |
| Commercial component | mixed-use tower alongside the sanctuary, income generating |
| Funding model | fundraising plus equity mix, member contributions, designated tithes and offerings, grants and partnerships |
| Governance | Building Committee, church board, Kenya-Lake Union Conference |
| Approvals needed | Nairobi City County, National Construction Authority |
| Expected duration | 3 to 5 years, phased to funding |
| Launch video | YouTube k6VRsf3ZH7w |

### Problems with the current page that the rebuild has to fix

1. **All people are placeholders.** Nine leadership cards read "[Leader Name]" and four
   testimonials read "[Member Name]". A fundraising page asking for KES 550M with no named
   accountable humans is the single biggest trust problem on the page. Named treasurer,
   named project coordinator, named building committee chair, with real photos, is not
   optional on a money page.
2. **Every image is the same stock photo,** repeated eight times, plus a leftover
   `bottle-mockup.png` served from a Rackspace CDN that has nothing to do with the project.
3. **The timeline is stale.** "Design finalised, target October 2025" and "construction
   begins 2026" were written in 2025. It is now September 2026. Either the milestone
   happened, in which case say so with a date, or it slipped, in which case say that too.
   A tracker showing a target that has quietly passed reads worse than an honest delay.
4. **Two different numbers for the same thing.** The page says KES 500M to 600M estimated
   construction cost. The brief says a fundraising target above KES 550M. Publish one
   number as the campaign target and explain the relationship to the construction estimate.
   If the target is 550M against a 500 to 600M cost, say where the balance comes from
   (equity, commercial component, conference support).
5. **The "how do I contribute" FAQ tells people to visit the administration office.**
   That answer is exactly what this platform replaces. It has to change on launch day, and
   the WordPress page and the new platform must not contradict each other.
6. **The KES 10M fund launch versus a KES 550M campaign needs a sentence of explanation.**
   Otherwise a member does the arithmetic and concludes the project is 2% funded and
   stalled.
7. **The feedback form is still the primary call to action.** Consultation was the right CTA
   for a draft proposal in 2025. If the church is now raising money, "Make a pledge" is the
   primary action and "Share your feedback" is secondary.

### Content gaps to fill before launch

- Actual amount raised to date, and how it was raised. Without a real starting number the
  tracker launches at zero and looks like a failed campaign on day one.
- Where the money goes. A one-screen breakdown (foundation, structure, sanctuary fit-out,
  parking, commercial floors) turns an abstract 550M into something a member can picture.
- Accountability statement: who holds the funds, which account, who audits, how often
  results are published, what happens to the money if the project does not proceed.
- Real renders. The "1 / 6" gallery on the current page has no real images behind it.
- Payment instructions for people who will never use the portal, printed alongside it.

---

## 1. Recommended information architecture

Two properties, clearly separated:

- **newlifesdanairobi.org** stays on WordPress. The Church Development page becomes a short
  summary that links out.
- **New app on its own subdomain**, e.g. `crystalfountain.newlifesdanairobi.org`. Do not try
  to build this inside WordPress. You need transactions, a real schema, an audit trail and
  webhook endpoints, and a Salient/WPBakery theme is the wrong place for all four.

Site map:

```
/                     Home: story hook, live tracker, one CTA (Make a pledge), what remains
/vision               What is being built, spaces, renders, why it matters
/story                Where we came from, what has been achieved, where we are now, what is next
/pledge               The form. Three fields visible at a time, nothing else on screen
/pledge/confirmed     Reference, QR, share card, payment instructions, live totals
/p/<token>            Public pledge lookup (unguessable link, the QR target)
/progress             Full tracker, timeseries chart, milestones, breakdown of where money goes
/updates              Construction and campaign updates, photos, milestones
/updates/[slug]
/accountability       Who is responsible, how funds are held, reporting cadence, audit
/faq                  Rewritten from the existing FAQ, plus pledge and payment questions
/privacy              Data protection notice. Required, not optional. See section 12
/admin/*              Authenticated admin (phase 6)
```

Changes from the brief's proposed structure:

- Merged "About the project" and "The vision" into `/vision` and `/story`. Four separate
  narrative pages on a one-message site splits attention and nobody reads page four.
- Added `/accountability`. On a religious fundraising site this page does more for
  conversion than any amount of design polish.
- Added `/privacy` because you are collecting phone, email and possibly ID numbers.
- `/p/<token>` is deliberately outside the main nav. It is the QR destination.

---

## 2. Technology stack

Recommendation, matched to what you already run in production:

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15, React 19, TypeScript, App Router | Same stack as the camp meeting site. Server components for the content pages, route handlers for the API. |
| Styling | Tailwind v4, shadcn/ui | Already have the church's Adventist palette resolved from the camp meeting build. Reuse it. |
| DB | Neon Postgres | Serverless, branching for migrations, point in time recovery. |
| ORM | Drizzle | Typed schema, real SQL migrations you can read and review. |
| Validation | Zod, shared between client and server | One contract, no drift. |
| Charts | Recharts, or a hand-rolled SVG for the hero tracker | Do not import a chart library for one progress bar. |
| QR | `qrcode` (SVG output, server side) | No client dependency, no PII in the payload. |
| Share card | `@vercel/og` / Satori | Generates the PNG members forward on WhatsApp. |
| Media | Cloudflare R2 | Renders and update photos. |
| SMS OTP | Africa's Talking or Safaricom bulk SMS | Needed for pledge verification. See section 5. |
| Bot control | Cloudflare Turnstile | Pledge endpoint is public and writes to a public counter. |
| Email | Resend or Postmark | Pledge acknowledgement. |
| Hosting | Vercel | Matches your workflow. See the data residency note in section 12. |
| Errors | Sentry with PII scrubbing on | Redact phone, email, ID before send. |

Package manager pnpm with exact pinned versions, per your standing convention.

### On Fastify

Your usual stack includes Fastify. For this MVP I would not add it. One Next.js app with
route handlers is enough, and a second deployable adds an ops surface for no gain at this
size. The condition: all business logic lives in `src/server/` as plain TypeScript functions
that take a `db` handle and a typed input, and never touch `Request`, `Response`, cookies or
`next/headers`. Route handlers become thin adapters. If you later need Fastify for a mobile
app or a background worker, you move the adapter layer and the domain code comes with you
unchanged.

This is an opinion, not a fact. The tradeoff is real: a separate API is cleaner if a React
Native member app is coming within six months. If that is on the roadmap, split now.

---

## 3. System architecture

```
                     ┌──────────────────────────────┐
   Members  ────────▶│  Next.js app (Vercel)        │
   Well-wishers      │  RSC content + route handlers│
                     └───────┬──────────────┬───────┘
                             │              │
                    ┌────────▼───────┐   ┌──▼──────────────┐
                    │ Domain services│   │ Cached read APIs│
                    │ src/server/    │   │ 30s revalidate  │
                    └────────┬───────┘   └──┬──────────────┘
                             │              │
                     ┌───────▼──────────────▼───────┐
                     │   Neon Postgres              │
                     │   pledges, payments,         │
                     │   allocations, audit_log     │
                     └───────┬──────────────┬───────┘
                             │              │
              ┌──────────────▼───┐    ┌─────▼──────────────┐
              │ Vercel Cron      │    │ Webhooks (phase 8) │
              │ daily snapshots  │    │ M-Pesa callbacks   │
              │ reminders        │    │ idempotent, logged │
              └──────────────────┘    └────────────────────┘
```

Four rules that keep this from rotting:

1. **The database is the only source of truth for money.** No totals in config, no totals in
   a CMS, no totals in a React constant.
2. **Nothing that touches money runs outside a transaction.** Recording a payment and
   allocating it to a pledge is one transaction or neither happens.
3. **Writes are append-only where possible.** You correct a payment by adding a reversal
   row, not by editing the original. Financial systems that allow silent edits cannot be
   audited, and this one will be audited.
4. **Public reads never touch personal data.** The tracker endpoint returns aggregates and
   nothing else.

---

## 4. Database schema

Postgres DDL below. The Drizzle schema mirrors it one to one.

Money is stored as `bigint` in minor units (cents). Never floats, never `money`. KES amounts
in this project run to eleven digits in cents, well within `bigint`.

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;

-- ─── campaign ────────────────────────────────────────────────────────────────
create table campaigns (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  target_minor    bigint not null check (target_minor > 0),
  currency        char(3) not null default 'KES',
  opening_balance_minor bigint not null default 0,   -- funds raised before this platform
  starts_on       date not null,
  target_date     date,
  is_public       boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ─── the person ──────────────────────────────────────────────────────────────
create table pledgers (
  id                 uuid primary key default gen_random_uuid(),
  phone_e164         text not null unique,          -- +2547XXXXXXXX, primary identity key
  phone_verified_at  timestamptz,
  full_name          text not null,
  email              citext,
  membership_no      text,                          -- church membership, preferred over national ID
  is_member          boolean,
  id_type            text check (id_type in ('national_id','passport','alien_id')),
  id_ciphertext      bytea,                         -- encrypted, nullable. See section 12
  id_hash            bytea,                         -- HMAC-SHA256 with server pepper, for dedupe
  display_name       text,                          -- what appears publicly if consented
  display_consent    boolean not null default false,
  contact_consent    boolean not null default false,
  privacy_version    text not null,
  consented_at       timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index pledgers_id_hash_uq on pledgers (id_hash) where id_hash is not null;

-- ─── the promise ─────────────────────────────────────────────────────────────
create type pledge_status as enum
  ('pending','verified','fulfilled','cancelled','void');

create table pledges (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references campaigns(id),
  pledger_id      uuid not null references pledgers(id),
  reference       text not null unique,      -- CF26-000124, max 12 chars. See section 6
  public_token    text not null unique,      -- 22 char nanoid, the QR target
  amount_minor    bigint not null check (amount_minor > 0),
  currency        char(3) not null default 'KES',
  status          pledge_status not null default 'pending',
  intent          text not null default 'one_off'
                    check (intent in ('one_off','installment')),
  installment_amount_minor bigint check (installment_amount_minor > 0),
  installment_frequency    text check (installment_frequency in ('monthly','quarterly','annually')),
  target_completion_on     date,
  channel         text not null default 'web'
                    check (channel in ('web','admin','event','sms','import')),
  note            text,
  verified_at     timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index pledges_campaign_status_idx on pledges (campaign_id, status);
create index pledges_created_idx on pledges (created_at desc);

-- ─── money actually received ─────────────────────────────────────────────────
create table payments (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references campaigns(id),
  method          text not null check (method in ('mpesa','bank','cash','cheque','card','other')),
  external_ref    text,                     -- M-Pesa receipt, bank slip number
  amount_minor    bigint not null check (amount_minor > 0),
  currency        char(3) not null default 'KES',
  paid_at         timestamptz not null,
  payer_name_raw  text,                     -- as the channel reported it
  payer_msisdn    text,
  account_ref_raw text,                     -- what the payer typed, used for matching
  status          text not null default 'received'
                    check (status in ('received','reversed','disputed')),
  recorded_by     uuid references admin_users(id),
  raw_payload     jsonb,                    -- full callback body, kept for audit
  created_at      timestamptz not null default now()
);
create unique index payments_channel_ref_uq
  on payments (method, external_ref) where external_ref is not null;

-- ─── linking money to promises ───────────────────────────────────────────────
create table payment_allocations (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references payments(id),
  pledge_id     uuid not null references pledges(id),
  amount_minor  bigint not null check (amount_minor > 0),
  allocated_by  uuid references admin_users(id),
  allocated_at  timestamptz not null default now(),
  note          text
);
create index alloc_pledge_idx on payment_allocations (pledge_id);
```

Three things this shape buys you:

- A payment can arrive with no matching pledge (a well-wisher who just sends money). It
  still counts toward "received" without inventing a fake pledge.
- A pledge can be paid across many instalments over three years, which is how church
  building funds actually behave.
- Over-allocation is caught. Add a trigger asserting
  `sum(allocations for a payment) <= payments.amount_minor`.

### Derived views

```sql
create view v_pledge_balances as
select p.id as pledge_id,
       p.amount_minor,
       coalesce(sum(a.amount_minor), 0) as paid_minor,
       p.amount_minor - coalesce(sum(a.amount_minor), 0) as outstanding_minor
from pledges p
left join payment_allocations a on a.pledge_id = p.id
group by p.id;

create view v_campaign_totals as
select c.id as campaign_id,
       c.target_minor,
       c.opening_balance_minor
         + coalesce((select sum(amount_minor) from pledges
                     where campaign_id = c.id and status in ('verified','fulfilled')), 0)
         as pledged_minor,
       c.opening_balance_minor
         + coalesce((select sum(amount_minor) from payments
                     where campaign_id = c.id and status = 'received'), 0)
         as received_minor,
       (select count(*) from pledges
        where campaign_id = c.id and status in ('verified','fulfilled')) as pledge_count,
       (select count(distinct pledger_id) from pledges
        where campaign_id = c.id and status in ('verified','fulfilled')) as pledger_count
from campaigns c;
```

Do not denormalise these into counter columns yet. At the realistic volume for this
congregation (single-digit thousands of pledges) the aggregate is a millisecond query and a
counter column is a bug waiting to happen. Revisit if a row count ever exceeds six figures.

### Snapshots, audit, admin

```sql
create table campaign_daily_stats (
  campaign_id     uuid not null references campaigns(id),
  stat_date       date not null,
  pledged_minor   bigint not null,
  received_minor  bigint not null,
  pledge_count    int not null,
  pledger_count   int not null,
  new_pledges     int not null,
  new_pledged_minor bigint not null,
  primary key (campaign_id, stat_date)
);

create table audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_type  text not null check (actor_type in ('public','admin','system','webhook')),
  actor_id    uuid,
  action      text not null,          -- pledge.created, payment.recorded, pledge.voided
  entity      text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text
);
revoke update, delete on audit_log from public;

create table admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  full_name     text not null,
  role          text not null check (role in ('viewer','treasurer','admin')),
  totp_secret   bytea,
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);
```

The daily snapshot matters more than it looks. It gives you an immutable history for charts
and forecasting even if pledges are later corrected, and it means the timeseries endpoint
never scans the pledge table.

---

## 5. Pledge workflow

```
  Member lands on /pledge
        │
        ▼
  Step 1  Amount            large numeric input, quick chips (10k / 50k / 100k / 500k / 1M)
        │                    plus "pay in instalments" toggle
        ▼
  Step 2  Who you are        full name, phone, email (optional), membership no (optional)
        │                    consent checkboxes, explicit and separate
        ▼
  Step 3  Confirm            review, submit
        │
        ▼
  POST /api/pledges          Turnstile + rate limit + zod validation
        │                    status = 'pending'   ← does NOT count toward the public total
        ▼
  SMS OTP to the phone       6 digits, 10 minute expiry, 5 attempts
        │
        ▼
  POST /api/pledges/verify   status = 'verified'  ← now counts toward the public total
        │
        ▼
  /pledge/confirmed          reference, QR, downloadable share card,
                             payment instructions, live totals with their pledge included
```

### Why the pending state exists

This is the most important thing in the whole design and it is not in the brief.

A public counter fed by an unauthenticated form is a target. One person entering a
KES 100,000,000 pledge as a joke, or a bot hitting the endpoint a thousand times, puts a
false number in front of the congregation. Once a member screenshots a wrong total and it
circulates on WhatsApp, the credibility of the whole platform is gone, and credibility is
the only reason the platform exists.

Phone verification costs roughly one SMS per pledge and removes the entire class of problem.
Additional controls:

- Amounts above a configurable threshold (suggest KES 1,000,000) stay `pending` until an
  admin confirms, regardless of OTP.
- Rate limit by IP and by phone number.
- Turnstile on submit.
- Admin can void a pledge, which is a status change plus an audit row, never a delete.

### Reminders

Instalment pledges get a monthly SMS or email reminder with the outstanding balance and the
paybill details. Schedule these to avoid Friday sunset through Saturday sunset. You already
have Nairobi sundown data from the camp meeting build, so reuse it.

---

## 6. Reference numbers and QR codes

### Two identifiers, different jobs

The brief proposes `CFDP-2026-000124`. Split it into two values, because one string cannot
do both jobs safely.

**1. Human reference, shown everywhere, used as the M-Pesa account number.**

Format: `CF26-000124`, 11 characters.

Reason for the shorter format: the Daraja `AccountReference` field is documented as a
maximum of 12 characters in Safaricom's API reference and in every third-party SDK I
checked. `CFDP-2026-000124` is 16 characters and would be rejected or truncated at STK Push
time, which you would only discover during payment integration. Confirm the current limit on
developer.safaricom.co.ke before locking the format, but design for 12 as a ceiling.

Sequential is fine here. It is meant to be read over the phone and typed into a keypad.

**2. Public token, used in URLs and the QR code.**

22 character nanoid, e.g. `V1StGXR8_Z5jdHi6B-myT9`.

Reason: `/p/CF26-000124` is trivially enumerable. Anyone could walk the range and read every
pledger's name and amount. The token makes the link unguessable, and the reference stays
short for payments. Both live on the same row.

### QR contents

Encode a URL and nothing else:

```
https://crystalfountain.newlifesdanairobi.org/p/V1StGXR8_Z5jdHi6B-myT9
```

Not the name, not the amount, not the phone number, not JSON. A QR code is public by nature.
People photograph them, print them, put them in WhatsApp groups. Anything encoded in it is
disclosed. The URL resolves server side and shows only what the viewer is entitled to see.

Generation: server-rendered SVG via `qrcode`, cached indefinitely (the token never changes).

### The share card

Members will forward their pledge on WhatsApp. Give them something worth forwarding: a PNG
generated with `@vercel/og` showing the project name, the QR, the reference, the campaign
progress bar, and no personal data other than the display name if they consented. This is
the cheapest growth mechanism available and it costs one route handler.

### On M-Pesa's Dynamic QR

Safaricom's Daraja platform includes a Dynamic QR API that generates payment QRs directly.
Worth evaluating at payment integration time as a second QR on the confirmation page (scan
to pay, versus scan to view). I have not verified its current pricing or availability for
paybill holders, so treat it as a phase 8 investigation, not a commitment.

---

## 7. Live progress mechanism

```
GET /api/campaign/summary
{
  "currency": "KES",
  "target": 550000000,
  "pledged": 128450000,
  "received": 41200000,
  "remaining": 421550000,
  "percentPledged": 23.35,
  "percentReceived": 7.49,
  "pledgeCount": 412,
  "pledgerCount": 389,
  "asOf": "2026-09-08T11:32:00Z"
}
```

Implementation:

- Server component reads `v_campaign_totals` directly on page render. First paint has real
  numbers, no loading spinner, no layout shift, and it works with JavaScript disabled.
- Wrap in Next's cache with `revalidateTag('campaign-totals')`, and call
  `revalidateTag` inside the same code path that verifies a pledge or records a payment.
  Cache invalidation is driven by writes, not by a timer.
- Client polls `/api/campaign/summary` every 30 seconds while the tab is visible, so the
  number moves during a Sabbath appeal without a refresh. Animate the count up on change.
  Do not use websockets or SSE for this. The update rate does not justify a persistent
  connection.
- Percentages are computed once, server side, from integer minor units. Never in the
  browser, never from a float total.

Publish both numbers, pledged and received, side by side and label them plainly. A tracker
showing only pledges overstates progress, and someone will notice. Showing both is the
transparency the page already promises.

**Recent pledges feed:** opt-in only, display name or "A member of Newlife", amount band
rather than exact amount unless they explicitly allow it (e.g. "pledged KES 100,000+").
Never the phone, never the ID, never the full name unless consented.

---

## 8. Admin dashboard

Roles:

| Role | Can do |
|---|---|
| viewer | Read pledges and totals, no PII beyond name, no export |
| treasurer | Record payments, allocate to pledges, export, view full contact details |
| admin | All of the above, plus void pledges, manage users, edit campaign settings |

Screens:

```
/admin                  Totals, today's activity, unmatched payments queue, pending approvals
/admin/pledges          Table: search by reference, phone, name. Filter by status, amount,
                        date, fulfilment. Cursor pagination, not offset
/admin/pledges/[id]     Detail, payment history, allocations, audit trail, actions
/admin/payments         All payments received, matched and unmatched
/admin/payments/new     Manual entry for bank transfers, cash, cheques
/admin/reconcile        Unmatched payments beside likely pledges, one click to allocate
/admin/reports          Pledged vs received, outstanding by ageing bucket, channel mix
/admin/exports          CSV and XLSX, every export written to audit_log
/admin/updates          Post project updates to the public site
/admin/users            User and role management
```

The reconciliation screen is the one that decides whether the treasurer actually uses this
system. M-Pesa gives you a payer name and an account reference typed by a human at a keypad.
Some will type `CF26-000124`, some will type `crystal fountain`, some will type their own
name. Build fuzzy matching on reference, then phone, then name similarity, present the top
three candidates, let a human confirm. Never auto-allocate below a high confidence threshold.

---

## 9. Analytics architecture

Postgres does all of this. No warehouse, no pipeline, no BigQuery for a dataset that will
not exceed a few tens of thousands of rows this decade.

Layers:

1. **Operational reads** straight off the tables and views for the admin dashboard.
2. **`campaign_daily_stats`**, written by a Vercel Cron at 00:15 EAT, one row per day. Every
   chart and trend reads from here.
3. **Metrics views** for the recurring questions:

```sql
-- pledge fulfilment by cohort month
create view v_fulfilment_by_cohort as
select date_trunc('month', p.created_at)::date as cohort_month,
       count(*)                                as pledges,
       sum(p.amount_minor)                     as pledged_minor,
       sum(b.paid_minor)                       as paid_minor,
       round(100.0 * sum(b.paid_minor) / nullif(sum(p.amount_minor), 0), 2) as fulfilment_pct
from pledges p
join v_pledge_balances b on b.pledge_id = p.id
where p.status in ('verified','fulfilled')
group by 1 order by 1;
```

Metrics to track from day one: pledges per week, new pledgers per week, median and mean
pledge (report both, the mean will be dragged by a few large pledges), fulfilment rate by
cohort age, channel mix, outstanding by ageing bucket (0-30, 31-90, 91-180, 180+ days),
run rate over trailing 4 and 12 weeks.

Instrument the funnel too: page view, form start, step 2, submit, OTP sent, OTP verified.
Drop-off between "submit" and "OTP verified" is the number that tells you whether
verification is costing you pledges, and you cannot tune what you do not measure.

---

## 10. Machine learning, honestly

Direct answer: the two questions in the brief are arithmetic, not machine learning, and
dressing them up as ML would make the answers worse and less trustworthy.

**"How long to reach KES 550M at the current rate?"**

```
remaining = target - pledged
run_rate  = pledged in the trailing 12 weeks / 12
weeks_to_target = remaining / run_rate
```

Present it as a range from the trailing 4, 12 and 26 week run rates, because those three
numbers will differ a lot and the spread is the honest answer. Add the obvious caveat that
church giving is seasonal (camp meeting, year end, appeal Sabbaths), so a single-point
projection is misleading.

**"What monthly rate is needed to hit the target by December 2027?"**

```
required_monthly = (target - pledged) / months_remaining
```

That is the whole model.

Where a real model earns its place, later:

- **Fulfilment prediction.** Given a pledge's amount, instalment plan, channel, and payment
  behaviour in the first 90 days, what is the probability it is paid in full? This is a
  genuine classification problem, and it is useful, because it tells the treasurer which
  pledges need a follow-up call. It needs roughly 300 or more resolved pledges with at least
  12 months of history. Logistic regression, with the coefficients readable, so the treasurer
  can see why a pledge was flagged. Do not use a gradient boosted model here. A church
  committee will not act on an unexplainable score.
- **Seasonality-adjusted forecasting.** Once you have two years of `campaign_daily_stats`,
  a simple decomposition or Prophet-style model beats a linear run rate. Not before.

Prerequisite for both: clean data. That is exactly what section 4 is for. Build the schema
right and the models are a weekend in eighteen months. Build it wrong and no model saves you.

---

## 11. Future authentication and member dashboards

Out of scope for the MVP, and the schema is already ready for it.

When it comes:

- `member_accounts` table with a nullable one-to-one link to `pledgers`. Identity is the
  verified phone number, which is why phone verification in the MVP matters beyond spam
  control. It is the account key you will use later.
- Auth: Better Auth or Auth.js with the Drizzle adapter, so sessions live in your own
  Postgres and there is no per-user vendor cost for a congregation of thousands. Session in
  an httpOnly, Secure, SameSite=Lax cookie. No tokens in localStorage, per your standing
  rule.
- Login by phone OTP, not password. Members will not remember a password for a site they
  visit four times a year, and password reset flows are a support burden the church office
  does not want.
- Dashboard reads `v_pledge_balances` filtered to that pledger. All the data already exists
  from day one, which means every pledge made during the MVP shows up in the dashboard the
  day it launches.
- Admin auth is separate from member auth. Different table, different session, mandatory
  TOTP. Do not put a treasurer and a member in the same auth namespace with a role column.

---

## 12. Security and data protection

### The ID number question

You asked for phone, email and ID number for accountability. My recommendation is: phone
mandatory and verified, name mandatory, email optional, **national ID optional and encrypted,
church membership number preferred over national ID.**

The reasoning:

1. **Phone number does the accountability job better than ID in Kenya.** M-Pesa payments
   carry the payer's MSISDN and registered name. That is your reconciliation key. A national
   ID number appears nowhere in the payment flow, so it cannot help you match money to
   pledges. It is accountability theatre.
2. **The church already has a membership register** and a membership confirmation flow on
   the existing site. A membership number ties a pledge to the church's own records, which
   is what the Building Committee actually wants when it says "accountability".
3. **A database of names, phones, ID numbers and giving amounts is a serious target.** ID
   numbers are used in Kenya for SIM swap and loan fraud. If this platform leaks, the harm
   to members is real and the harm to the church's standing is worse.
4. **Under the Data Protection Act 2019, this dataset is sensitive personal data regardless
   of whether you collect IDs**, because a record of someone pledging to a Seventh-day
   Adventist church reveals religious belief, which sits inside the Act's definition of
   sensitive personal data. That raises the compliance bar for the whole system, not just
   the ID field.

If the committee still wants ID numbers, that is their call to make, not mine. Make it a
documented decision, and then:

- Store `id_ciphertext` encrypted at rest with an application-managed key (AES-256-GCM, key
  in the platform secret store, rotated, never in the repo, never in an env var checked into
  anything).
- Store `id_hash` as an HMAC-SHA256 with a server-side pepper, for dedupe and lookup, so you
  never decrypt to answer "has this person already pledged".
- Never return the ID from any list endpoint. Masked in the admin UI (`****4821`) with an
  explicit "reveal" action that writes an audit row naming the admin who revealed it.
- Excluded from CSV exports unless an admin with the `admin` role ticks a box, which is also
  audited.
- State the purpose in the privacy notice in one plain sentence.

### Data protection obligations

Based on published summaries of the Data Protection Act 2019 and ODPC guidance. I am not a
lawyer and these are secondary sources, so have the church confirm the specifics with the
ODPC or counsel before launch. What I am confident about:

- **Registration.** Data controllers register with the ODPC. Multiple compliance guides state
  that religious organisations must register regardless of revenue, unlike the general
  exemption for entities under KES 5M turnover with fewer than 10 employees. Verify this
  directly with the ODPC, since it materially affects the church.
- **Lawful basis and consent.** Consent must be freely given, specific, informed and
  unambiguous. That means separate checkboxes: one to record the pledge, one to be contacted
  about the project, one to appear publicly. Not one bundled checkbox, and never pre-ticked.
- **Privacy notice** published before you collect a single record.
- **DPIA** before launch. High-risk processing (sensitive data, large scale, financial) calls
  for one, and published guidance points to conducting it ahead of processing. Write it down
  even if you conclude the risk is manageable. The document is the deliverable.
- **Breach notification** to the ODPC within 72 hours of becoming aware. Write the runbook
  before you need it: who is called, who decides, what is sent.
- **Data subject rights.** Access, correction, deletion. Build the admin actions for these,
  do not plan to handle them by hand.
- **Retention.** Decide now how long pledge records are kept after the campaign closes, and
  write it into the notice. Financial records have their own retention needs, so treat
  pledge data and contact data separately.
- **Cross-border transfer.** Vercel and Neon have no Kenyan region. Choose the closest
  region, document the transfer and its safeguards in the privacy notice, and check whether
  the ODPC's cloud policy guidance affects the choice. This is a real obligation, not a
  formality, and it is easier to handle at design time than after launch.

Penalties are reported at up to KES 5 million or 1% of annual turnover. Confidence: medium,
from compliance guides rather than the gazetted text. Confirm before quoting the number to
the committee.

### Application security

- Zod validation on every input, server side. Client validation is a convenience only.
- Rate limiting: per IP and per phone on pledge creation, tighter on OTP verify.
- Turnstile on the pledge form.
- Amount ceiling on the public form, above which the pledge is queued for admin approval.
- Parameterised queries only (Drizzle gives you this, do not reach for raw string SQL).
- Strict CSP, HSTS, no inline scripts.
- Admin: TOTP mandatory, httpOnly Secure SameSite cookies, short idle timeout, IP logging.
- Webhooks: allowlist Safaricom's source IPs, verify the payload shape, treat
  `(method, external_ref)` as the idempotency key so a replayed callback cannot double-count.
- Sentry with PII scrubbing configured before the first deploy, not after.
- Neon point in time recovery on, and test a restore before launch. An untested backup is a
  hope, not a backup.
- Separate database roles: the app role cannot `drop`, and nothing but the migration role
  can alter schema.

---

## 13. API structure

Public:

| Method | Path | Notes |
|---|---|---|
| POST | `/api/pledges` | Turnstile + rate limit. Returns reference, publicToken, otpRequired |
| POST | `/api/pledges/verify` | Body: reference, otp. Promotes pending to verified |
| POST | `/api/pledges/resend-otp` | Rate limited hard |
| GET | `/api/pledges/:publicToken` | Pledge detail, phone masked, no ID ever |
| GET | `/api/pledges/:publicToken/qr.svg` | Immutable cache |
| GET | `/api/pledges/:publicToken/card.png` | Share image |
| GET | `/api/campaign/summary` | Aggregates only, 30s cache |
| GET | `/api/campaign/timeseries` | From `campaign_daily_stats` |
| GET | `/api/campaign/recent` | Opt-in pledges only, banded amounts |

Admin (all authenticated, all role-checked, all audited):

| Method | Path |
|---|---|
| GET | `/api/admin/pledges` (cursor paginated, filterable) |
| PATCH | `/api/admin/pledges/:id` (status, note) |
| POST | `/api/admin/payments` |
| POST | `/api/admin/payments/:id/allocations` |
| DELETE | `/api/admin/payments/:id/allocations/:allocationId` |
| GET | `/api/admin/reconcile/suggestions?paymentId=` |
| GET | `/api/admin/exports/pledges.csv` |
| GET | `/api/admin/stats/*` |

Webhooks (phase 8): `/api/webhooks/mpesa/stk-callback`,
`/api/webhooks/mpesa/c2b/confirmation`, `/api/webhooks/mpesa/c2b/validation`.

Conventions: JSON only, `application/problem+json` for errors with a stable `code` field,
ISO 8601 UTC timestamps, amounts always integer minor units with an explicit `currency`,
cursor pagination everywhere (offset pagination breaks when rows are inserted during
paging, which is exactly what happens on a live campaign).

---

## 14. Delivery phases

Sized for bounded Claude Code sessions, gated, each ending in a commit and a SQL
verification step, per your usual method.

| Phase | Scope | Done when |
|---|---|---|
| 0 | Repo, Next 15 + TS + Tailwind + shadcn, pnpm exact pins, env schema, Neon branch, CI | `pnpm build` green, deploy preview live |
| 1 | Drizzle schema, migrations, seed, verification queries | Seeded data returns correct totals from `v_campaign_totals` in psql |
| 2 | Domain services and zod contracts: create pledge, verify, reference and token generation, totals | Unit tests pass, no HTTP layer touched |
| 3 | Public content pages: home, vision, story, accountability, FAQ, privacy | Content reviewed and signed off by the Building Committee |
| 4 | Pledge flow: form, OTP, confirmation, QR, share card | End to end pledge on a real phone number |
| 5 | Live tracker, timeseries chart, recent pledges, cache invalidation on write | New pledge moves the homepage number within 30s |
| 6 | Admin: auth + TOTP, pledge list, payment entry, allocation, reconciliation, export, audit | Treasurer records a bank payment and it reconciles to a pledge |
| 7 | Hardening: rate limits, DPIA, privacy notice, backups tested, Sentry, load test, launch checklist | Restore test passed, DPIA signed |
| 8 | M-Pesa: STK Push, C2B callbacks, idempotency, auto-matching | Test transaction reconciles automatically in sandbox and production |
| 9 | Member accounts and dashboards | Members log in by OTP and see their history |
| 10 | Forecasting and fulfilment model | Only once there are 12 months of data |

Phases 0 to 5 are the real MVP. That is a launchable, trustworthy pledge platform. Phases 6
and 7 make it operable and lawful, and I would not launch publicly without them.

Sequencing note: start the ODPC registration question and the content gathering (real names,
real photos, real numbers) in parallel with phase 0. Both are slower than the code and both
block launch.

---

## 15. UI and UX direction

Design principles for this specific brief:

- **The hero is the number, not a stock photo.** A member arriving from a WhatsApp link
  wants to know two things in under two seconds: what is being built, and how it is going.
  Lead with the live figure at display size, the target under it, one line of story, and one
  button.
- **One call to action above the fold.** "Make a pledge". The feedback form, the video, the
  renders and the FAQ all sit below it.
- **Reuse the church's official Adventist palette** already resolved for the camp meeting
  site (Emperor #4b207f, Denim #2f557f, Earth #5e3929, Campfire #e36520, Tree Frog #448d21).
  This is the same congregation and the same brand. Anchor on the deep purple and denim, use
  Campfire only for the progress fill so the one warm colour on the page is the number that
  matters. Do not invent a new palette.
- **Typography.** Two families at most, one display and one text. Set the money figures in
  tabular lining numerals so digits do not jitter when the counter animates. This detail is
  small and it is the difference between a tracker that feels engineered and one that feels
  improvised.
- **Mobile first, seriously.** Most of this traffic will be Android phones on mobile data,
  arriving from a WhatsApp group. Test on a mid-range Android over a throttled connection,
  not on a laptop. Budget the pledge page hard: the camp meeting site already ran into a
  large image payload, so do not repeat that on the page where conversion happens.
- **The form is three short steps, not one long page.** Amount first, because deciding the
  amount is the real decision and everything after it is admin. Numeric keypad on the amount
  input. Quick-select chips. Phone input pre-filled with +254 and formatted as they type.
- **Say what happens next.** After submitting, the member must see: their reference, how to
  actually pay, that the pledge is a promise rather than a payment, and who to contact. The
  commonest failure of pledge platforms is that a member submits the form and believes they
  have given.
- **Motion, once.** The counter animating to its value on load is the one moment. No
  fade-up on every section.
- **Copy in plain language.** "Make a pledge" not "Submit". "Your pledge is recorded" not
  "Success". "Pledge acknowledgement, not a receipt" on the confirmation, because the
  treasurer's official receipt is the only receipt that counts.
- **English with Kiswahili strings ready.** Not required at launch. Structure the copy so it
  can be added without a refactor.
- **Accessibility.** Visible focus, keyboard reachable, reduced motion respected, contrast
  checked. The congregation includes elderly members, and the existing FAQ already commits
  the project to accessibility. The website should hold to the same standard as the building.

---

## 16. Things the brief missed

Ordered by how much they matter.

1. **Fraud on the public counter.** Covered in section 5. This is the one that can end the
   project's credibility in a single afternoon.
2. **The pledge is not a payment, and members will confuse the two.** Say it explicitly on
   the confirmation screen, in the SMS, and on the share card. Also decide who chases
   unpaid pledges and how, because a pledge platform with no follow-up produces a large
   pledged number and a small received number, which is worse than not publishing pledges.
3. **The opening balance.** Money has already been raised since the 5 July 2025 fund launch.
   The tracker must start from that figure, not from zero, and the figure needs a source the
   treasurer will stand behind.
4. **Reconciliation with the church's actual books.** The platform is the system of record
   for pledges. The treasurer's ledger, under Kenya-Lake Union Conference financial policy,
   remains the system of record for money. Define which is authoritative for which number
   before launch, and build a monthly export that lets the two be compared. Two ledgers that
   disagree in public is a governance incident.
5. **Offline pledges.** Most pledges will be made on a Sabbath, in the church, on paper, at
   an appeal. Build admin bulk entry and a CSV import in phase 6. If the platform only
   accepts web pledges, the public total is wrong from week one.
6. **Instalments.** Large pledges will be paid over years. The schema handles it. The UI
   needs to offer it, because "KES 1,000,000 over 24 months" is a far easier decision than
   "KES 1,000,000".
7. **Diaspora giving.** SDA congregations in Nairobi typically have members abroad. They
   cannot use M-Pesa easily. Keep the `currency` column, and plan for a card or bank rail
   later. At minimum, publish bank details for international transfer at launch.
8. **Anonymous pledges.** Some people will not want their name displayed, and some will not
   want to be identified at all. The consent flags handle display. Decide the policy on truly
   anonymous pledges, given that accountability cuts against it.
9. **Withdrawing or reducing a pledge.** Circumstances change. There must be a path that is
   not "email the office". A status change with an audit trail, initiated by the member from
   their pledge link, reviewed by an admin.
10. **What happens if the project does not proceed.** The existing FAQ says construction is
    phased to funding, which is good. Members giving KES 500,000 will still ask. Answer it on
    `/accountability`.
11. **Tax treatment.** Whether contributions are deductible, and whether receipts need
    specific details for KRA. I cannot confirm the current position, so ask the church's
    accountant before designing the receipt.
12. **SEO and link previews.** Every WhatsApp share needs a proper OG image and description.
    The current page's OG image is a 2021 photo.
13. **Load at appeal moments.** The traffic pattern is flat, then two thousand people hit the
    site in ten minutes after an announcement. Cached server components handle reads fine.
    Make sure the write path and the SMS provider can handle the burst, and check the SMS
    rate limit before an appeal Sabbath, not during one.

---

## 17. What to do first

Practical order for the next two weeks:

1. Get the Building Committee to fix the campaign target as one number, and confirm the
   opening balance raised to date. Nothing else can be built accurately without these.
2. Decide the ID number question, in writing, with the reasoning in section 12 in front of
   them.
3. Start the ODPC registration enquiry. It has a lead time and it blocks a lawful launch.
4. Collect real content: named leaders with photos, real renders, the cost breakdown, the
   accountability statement.
5. Register the subdomain and the paybill account reference format.
6. Phase 0 and phase 1 in code. Schema first, because everything else depends on it and it
   is the part that is expensive to change later.

Build the schema right, verify the totals in SQL before a single component is written, and
the rest of this plan is mostly typing.
