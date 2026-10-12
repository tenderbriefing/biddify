# Biddify ↔ TenderBriefing / eTenders integration boundary

**Phase 2 decision (Founder-authorised inspection, read-only).**

## Architecture discovered

Three separate systems already ingest the **public** National Treasury OCDS API:

| System | Store | Cadence | Focus |
| --- | --- | --- | --- |
| TenderBriefing (`tenderbriefing/tender`) | Firestore `tenderBriefings` | ~15 min | Briefings + RFQ/RFP/RFB |
| RFQ Agent (`tenderbriefing/rfqagent`) | Firestore `etendersRfqs` | 1–2 h (prepared) | RFQ-only |
| MoneyMatters / InvoiceToday | Firestore `etendersRfqs` | 2 h | RFQ-only |

**OCDS source (no auth):** `https://ocds-api.etenders.gov.za/api/OCDSReleases`  
Requires `dateFrom` + `dateTo`. Portal: `https://www.etenders.gov.za` · Data: `https://data.etenders.gov.za`

Identifiers: `ocid` (e.g. `ocds-9t57fa-173573`), `tender.id` (platform number), opportunity URL `https://www.etenders.gov.za/Home/opportunity?id={tenderNumber}`.

Documents: OCDS `tender.documents[]` with eTenders download URLs. Briefing/province fields are often sparse on the API; apps enrich from PDFs/heuristics.

## Options evaluated

| Option | Security | Coupling | Cost | Freshness | TB impact | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| A. Consume TenderBriefing API | Needs SYNC/user secrets | High | Low infra | Good | Read load on TB | Later optional |
| B. Dedicated read-only TB API | Better isolation | Medium | Build cost | Good | Requires TB work | Future |
| **C. Biddify → public OCDS directly** | **No secrets** | **None to TB** | **Free** | Controlled | **None** | **Selected** |
| D. Scheduled export/import | Depends on export | Medium | Ops cost | Batch | TB job | Fallback |
| E. Direct TB Firestore/DB read | Credential exposure | Very high | — | Good | Risky | **Rejected** |

## Recommended boundary (Phase 2)

**Biddify imports from the public eTenders OCDS API via `TenderSourceAdapter` (`EtendersOcdsAdapter`).**

- Biddify RFQ model remains canonical.
- Source identity: `ETENDERS_OCDS` + `ocid` (unique).
- Provenance: source URL, published/modified timestamps, raw release JSON, import timestamp.
- No TenderBriefing production reads/writes.
- No Gmail, no submissions, no paid infra.

Optional later: a read-only TenderBriefing projection adapter implementing the same interface for enrichment (briefing attendance, PDF extracts) — never as the only source of truth for legal deadlines.

## PostgreSQL notes (future)

- Current Phase 2 uses SQLite locally.
- Avoid SQLite-specific SQL in business logic (none used).
- `@@unique([source, sourceOpportunityId])` is portable; NULL handling differs slightly — always set `sourceOpportunityId` for real imports.
- JSON fields stored as `String` today; may become `Json` on PostgreSQL.
- Timezone: Africa/Johannesburg assumed for SA OCDS when no contrary zone is present.
