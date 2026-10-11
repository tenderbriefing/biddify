# Biddify

Internal RFQ bidding operating system for TenderBriefing companies.

Biddify is **not** a public SaaS product. It helps authorised operators identify, evaluate, price, prepare, submit and track profitable RFQs — with **Founder approval** as a non-negotiable gate before any submission.

Primary initial focus: South African public-sector **supply and deliver** opportunities for ordinary commercially available goods.

## Phase status

| Phase | Status |
| --- | --- |
| Phase 0 — Repository initialisation | Implemented |
| Phase 1 — Foundation | Implemented |
| Phase 2+ | Awaiting Founder approval |

**Not deployed. No production integrations. No real email. No RFQ submissions.**

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

## TenderBriefing integration

Phase 1 does **not** connect to TenderBriefing / eTenders production systems. Integration boundary will be decided in Phase 8 after Founder approval, based on evidence of the safest approach (API / read replica / scheduled import / webhook).

## Licence

Proprietary — internal use only.
