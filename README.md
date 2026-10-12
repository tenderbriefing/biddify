# Biddify

Internal RFQ bidding operating system for TenderBriefing companies.

Biddify is **not** a public SaaS product. It helps authorised operators identify, evaluate, price, prepare, submit and track profitable RFQs — with **Founder approval** as a non-negotiable gate before any submission.

Primary initial focus: South African public-sector **supply and deliver** opportunities for ordinary commercially available goods.

## Phase status

| Phase | Status |
| --- | --- |
| Phase 0 — Repository initialisation | Implemented |
| Phase 1 — Foundation | Implemented (approved) |
| Phase 2 — RFQ ops + real data boundary | Implemented |
| Phase 3+ | Awaiting Founder approval |

**Not deployed. No TenderBriefing production writes. No real email. No RFQ submissions.**

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

## Licence

Proprietary — internal use only.
