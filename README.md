# Biddify

Internal RFQ bidding operating system for TenderBriefing companies.

Biddify is **not** a public SaaS product. It helps authorised operators identify, evaluate, price, prepare, submit and track profitable RFQs — with **Founder approval** as a non-negotiable gate before any submission.

Primary initial focus: South African public-sector **supply and deliver** opportunities for ordinary commercially available goods.

## Phase status

| Phase | Status |
| --- | --- |
| Phase 0 — Repository initialisation | Implemented |
| Phase 1 — Foundation | Implemented (approved) |
| Phase 2 — RFQ ops + real data boundary | Implemented (approved) |
| Phase 3 — Supplier intelligence & commercial proof | Conditional pass (approved) |
| Phase 4 — Real companies, Gmail, autonomous sourcing | In progress — certification gated |
| Phase 5+ | Awaiting Founder approval |

**Not deployed. No government submissions. Gmail send requires certification + Founder approval.**

Integration boundary: public eTenders OCDS via `TenderSourceAdapter` — see [docs/INTEGRATION_BOUNDARY.md](docs/INTEGRATION_BOUNDARY.md).

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- PostgreSQL-ready Prisma schema; **SQLite for Phase 1 local/demo** (zero infra cost)
- Zod (available for validation expansion)
- Vitest for domain tests
- Signed cookie sessions (jose) + RBAC roles

Production database target remains PostgreSQL. Switch `provider` + `DATABASE_URL` when deploying (Founder-approved).

## Quick start (local DEMO)

```bash
cp .env.example .env
# set AUTH_SECRET to a long random string

npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### DEMO logins

All DEMO users share password: `demo-password-change-me`

| Email | Role |
| --- | --- |
| founder@demo.biddify.local | FOUNDER |
| admin@demo.biddify.local | ADMIN |
| bidmanager@demo.biddify.local | BID_MANAGER |
| reviewer@demo.biddify.local | REVIEWER |
| readonly@demo.biddify.local | READ_ONLY |

Seed/demo records are labelled **DEMO** and must never be mixed with real procurement data without environment separation.

## Quality gates

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run secret-scan
# or
npm run gate
```

## Core domain rules (enforced in code)

- **VAT is never inferred** — taken from company `vatRegistered` only.
- **Markup ≠ margin** — commercial engine calculates both.
- **Founder approval required** before `SUBMISSION_AUTHORISED` / `SUBMITTED`.
- **Invalid workflow transitions rejected** by status machine.
- **Mandatory compliance gaps block** submission-ready status.
- **Late submission blocked** unless Founder override is explicit.
- **Outbound email remains mock** until Founder authorises Gmail.

## Repository

GitHub: https://github.com/tenderbriefing/biddify

## Security

- Never commit `.env`, API keys, OAuth secrets, Gmail credentials, or company documents.
- Use `.env.example` as the only committed environment template.
- Roles: `FOUNDER`, `ADMIN`, `BID_MANAGER`, `REVIEWER`, `READ_ONLY`.
- Founder approval permission is separately enforceable (`approval:founder`).

## eTenders import (Phase 2)

```bash
npm run import:etenders -- --dateFrom=2026-10-05 --dateTo=2026-10-11 --limit=5
```

Reads the **public** OCDS API only. Writes to the local Biddify database. Does not modify TenderBriefing.

Filter UI for real imports: `/rfqs?real=1`

## Phase 3 commercial pilot

```bash
npm run phase3:pilot
```

Document-first pipeline for BID-000011. Public prices are never stored as `SUPPLIER_QUOTE`.

## Phase 4 — real companies & Gmail

```bash
npm run phase4:onboard
npm run phase4:cert-preview
```

- Onboards Orison Chemicals / Orison Services from compliance vault evidence (no invented fields).
- DEMO entities are `dataMode=TEST` and blocked from outbound.
- Connect Gmail via `/settings/gmail` (OAuth discover → explicit company map).
- Certification preview builds Founder-reviewable drafts; **does not send** until approved.
- Scopes: [docs/GMAIL_SCOPES.md](docs/GMAIL_SCOPES.md).
- Kill switch + company/Gmail send controls on `/settings/gmail`.
- Founder Bid Queue: `/founder-queue`.

## Licence

Proprietary — internal use only.
