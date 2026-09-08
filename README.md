# Crystal Fountain pledge platform

Pledge platform for the Crystal Fountain Development Project, the building fund for
Newlife SDA Church, Nairobi. Members and well-wishers record a pledge toward the
KES 550,000,000 target, get a reference number and a QR code, and see live campaign
progress.

A pledge is a promise to give, not a payment. The treasurer's receipt is the only receipt.

Project rules live in `CLAUDE.md`. Read that before changing anything.

## Resolved versions

Every dependency is pinned to an exact version in `package.json`. No carets, no tildes.
`.npmrc` sets `save-exact=true` so future installs stay pinned.

| Package    | Version  |
| ---------- | -------- |
| next       | 15.5.25  |
| react      | 19.2.8   |
| typescript | 5.9.3    |
| tailwindcss| 4.3.3    |

React DOM tracks react at 19.2.8. shadcn/ui was initialised with the `radix-nova` preset
and the `neutral` base colour.

## Requirements

- Node 20 or newer
- pnpm 11.21.0 (see `packageManager` in `package.json`)
- A Neon Postgres database

## Setup

```bash
pnpm install
cp .env.example .env.local
# fill in DATABASE_URL and NEXT_PUBLIC_SITE_URL
pnpm dev
```

`src/env.ts` validates the environment with Zod and is imported once from the root layout,
so a missing variable fails the build rather than a request in front of a user.

## Scripts

| Script             | What it does                                       |
| ------------------ | -------------------------------------------------- |
| `pnpm dev`         | Development server on http://localhost:3000        |
| `pnpm build`       | Production build. Uses `--turbopack`, see below    |
| `pnpm start`       | Serve the production build                         |
| `pnpm lint`        | ESLint                                             |
| `pnpm db:generate` | Generate SQL migrations from `src/db/schema.ts`    |
| `pnpm db:migrate`  | Apply migrations to the database in `.env.local`   |

The build must run with `--turbopack`. Plain `next build` produced an incompatible routes
manifest on the church's camp meeting site and the same gotcha applies here.

## Layout

```
drizzle.config.ts       drizzle-kit config, reads .env.local
src/env.ts              Zod validated environment
src/db/index.ts         Neon serverless driver plus Drizzle client, exports db and Db
src/db/schema.ts        Drizzle schema, empty for now
src/server/             Business logic. Plain functions taking a Db handle and typed input
src/server/services/    Service functions
src/server/contracts/   Zod input and output contracts, shared client and server
src/app/api/            Thin route handlers. Parse, call the service, format
src/components/ui/      shadcn/ui components: button, input, card, label
```

Business logic in `src/server/` never touches `Request`, `Response`, cookies or
`next/headers`. That keeps the domain portable if the API is later split out to Fastify.

## Environment

| Key                    | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `DATABASE_URL`         | Neon Postgres connection string, pooled endpoint   |
| `NEXT_PUBLIC_SITE_URL` | Public origin of the site, no trailing slash       |

`.env.local` is gitignored. `.env.example` lists every key with no values.
