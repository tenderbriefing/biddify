# Gmail OAuth scopes (Phase 4)

Biddify requests the **minimum** Google permissions needed for supplier sourcing.

## Requested scopes

| Scope | Why |
| --- | --- |
| `openid` | Identify the Google account subject |
| `email` | Discover the connected account email for company mapping |
| `https://www.googleapis.com/auth/gmail.send` | Send Founder-approved / autonomous supplier RFQs only |
| `https://www.googleapis.com/auth/gmail.readonly` | Read Biddify-relevant threads/replies and attachments |
| `https://www.googleapis.com/auth/gmail.labels` | Create/apply `Biddify/*` labels when authorised |

## Not requested

- Full mailbox modify/delete (`gmail.modify` / `mail.google.com`) unless later justified
- Contacts, Drive, Calendar
- Any scope for government portal submission

## Mapping rule

Connecting a Gmail account **does not** enable sending.

Sending requires:

1. Account CONNECTED via OAuth  
2. Explicit Company ↔ Gmail mapping confirmed by Founder/operator  
3. Company `outboundSourcingEnabled`  
4. Gmail `sendingEnabled`  
5. Global kill switch not paused  
6. Outbound mode CERTIFICATION (Founder-approved batch) or AUTONOMOUS (after certification + autonomy event)

## Local OAuth

Phase 4 uses a **Desktop / loopback** OAuth client with `http://127.0.0.1:<port>/api/gmail/callback` so Biddify can stay local during certification. If Google or infrastructure forces a public callback URL, **stop and obtain Founder deployment approval** before proceeding.
