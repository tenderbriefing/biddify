/**
 * Local Desktop OAuth connect for Biddify.
 * Discovers authenticated email via Google — does not assume identity.
 * Does NOT infer signatory from Gmail profile / CSD / mailbox username.
 * Mapping only allowed when authenticated email matches company mailbox registry.
 */
import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";
import { prisma } from "../src/lib/db";
import { encryptSecret } from "../src/lib/crypto/tokenVault";
import { writeAuditEvent } from "../src/lib/audit";
import {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  getOAuthConfig,
} from "../src/integrations/gmail/oauth";
import { ensureBiddifyLabels } from "../src/integrations/gmail/client";
import {
  assertMailboxMatchesCompany,
  isForbiddenSourcingMailbox,
  resolveApprovedMailbox,
} from "../src/domain/companyMailboxRegistry";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function fetchUserInfo(accessToken: string): Promise<{
  email: string;
  name: string | null;
  sub: string | null;
}> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo HTTP ${res.status}`);
  const data = (await res.json()) as {
    email?: string;
    name?: string;
    sub?: string;
  };
  if (!data.email) throw new Error("Google userinfo missing email");
  return {
    email: data.email.toLowerCase(),
    name: data.name ?? null,
    sub: data.sub ?? null,
  };
}

async function main() {
  const base = getOAuthConfig();
  if (!base) throw new Error("GMAIL_CLIENT_ID/SECRET missing from .env");

  const port = Number(arg("port") ?? "8765");
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const config = { ...base, redirectUri };

  const mapCompanyName = arg("map-company");
  const enableSending = hasFlag("enable-sending");
  // Signatory must NEVER be inferred from Google profile — flag rejected.
  if (hasFlag("confirm-signatory")) {
    console.log(
      JSON.stringify({
        STATUS: "BLOCKED",
        code: "BLOCKED_NO_APPROVED_SIGNATORY",
        reason:
          "--confirm-signatory from Gmail profile is prohibited. Configure an explicitly approved company signatory separately.",
      }),
    );
    process.exit(2);
  }

  const state = createPkcePair();
  const oauthState = Buffer.from(
    JSON.stringify({ n: Math.random().toString(36).slice(2) }),
  ).toString("base64url");

  const authUrl = buildAuthorizationUrl({
    config,
    state: oauthState,
    codeChallenge: state.challenge,
  });

  const result = await new Promise<{
    email: string;
    name: string | null;
    sub: string | null;
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scope?: string;
  }>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!code || returnedState !== oauthState) {
          res.writeHead(400);
          res.end("Invalid OAuth callback");
          reject(new Error("Invalid OAuth callback"));
          server.close();
          return;
        }
        const tokens = await exchangeAuthorizationCode({
          config,
          code,
          codeVerifier: state.verifier,
        });
        const profile = await fetchUserInfo(tokens.access_token);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><body><h1>Biddify Gmail connected</h1><p>${profile.email}</p><p>You can close this window.</p></body></html>`,
        );
        server.close();
        resolve({
          ...profile,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
          scope: tokens.scope,
        });
      } catch (e) {
        res.writeHead(500);
        res.end("OAuth failed");
        server.close();
        reject(e);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(
        JSON.stringify({
          status: "WAITING_FOR_BROWSER_CONSENT",
          redirectUri,
          openUrl: authUrl,
          note: "Authenticate ONLY the company-approved mailbox from the registry. Do not use smartprocure.ai@gmail.com or personal admin accounts for company sourcing.",
        }),
      );
      exec(`open "${authUrl}"`);
    });
  });

  if (isForbiddenSourcingMailbox(result.email)) {
    console.log(
      JSON.stringify({
        STATUS: "BLOCKED",
        code: "BLOCKED_FORBIDDEN_MAILBOX",
        AUTHENTICATED_EMAIL: result.email,
        reason:
          "This mailbox is forbidden for company supplier sourcing (SmartProcure / personal admin).",
      }),
    );
    process.exit(2);
  }

  const account = await prisma.gmailAccount.upsert({
    where: { emailAddress: result.email },
    create: {
      emailAddress: result.email,
      googleAccountId: result.sub,
      connectionStatus: "CONNECTED",
      scopesGranted: result.scope ?? null,
      sendingEnabled: false,
      receivingEnabled: true,
      notes:
        "Connected via local Desktop OAuth. Company mapping requires registry match. Signatory is separate.",
      lastSuccessfulSync: new Date(),
    },
    update: {
      googleAccountId: result.sub,
      connectionStatus: "CONNECTED",
      scopesGranted: result.scope ?? null,
      syncError: null,
      lastSuccessfulSync: new Date(),
      // Never leave sending on after reconnect without explicit enable + registry map
      sendingEnabled: false,
      companyId: null,
      mappedAt: null,
      mappingConfirmedBy: null,
    },
  });

  await prisma.gmailToken.upsert({
    where: { gmailAccountId: account.id },
    create: {
      gmailAccountId: account.id,
      encryptedAccessToken: encryptSecret(result.accessToken),
      encryptedRefreshToken: result.refreshToken
        ? encryptSecret(result.refreshToken)
        : null,
      tokenExpiry: new Date(Date.now() + result.expiresIn * 1000),
    },
    update: {
      encryptedAccessToken: encryptSecret(result.accessToken),
      encryptedRefreshToken: result.refreshToken
        ? encryptSecret(result.refreshToken)
        : undefined,
      tokenExpiry: new Date(Date.now() + result.expiresIn * 1000),
    },
  });

  try {
    await ensureBiddifyLabels(result.accessToken);
  } catch {
    // best-effort
  }

  await writeAuditEvent({
    action: "GMAIL_CONNECTED",
    entityType: "GmailAccount",
    entityId: account.id,
    metadata: { email: result.email },
  });

  let company = null;
  let mapping: ReturnType<typeof assertMailboxMatchesCompany> | null = null;

  if (mapCompanyName) {
    company = await prisma.company.findFirst({
      where: {
        OR: [
          { legalName: mapCompanyName },
          { tradingName: mapCompanyName },
        ],
        isDemo: false,
        dataMode: "OPERATIONAL",
      },
    });
    if (!company) throw new Error(`Company not found: ${mapCompanyName}`);

    const expected = resolveApprovedMailbox({
      legalName: company.legalName,
      tradingName: company.tradingName,
      registrationNumber: company.registrationNumber,
    });
    if (!expected.ok) {
      console.log(JSON.stringify({ STATUS: "BLOCKED", ...expected }, null, 2));
      process.exit(2);
    }

    mapping = assertMailboxMatchesCompany({
      legalName: company.legalName,
      tradingName: company.tradingName,
      registrationNumber: company.registrationNumber,
      candidateGmail: result.email,
    });
    if (!mapping.ok) {
      console.log(
        JSON.stringify(
          {
            STATUS: "BLOCKED",
            ...mapping,
            AUTHENTICATED_EMAIL: result.email,
            EXPECTED_GMAIL: expected.approvedGmail,
            note: "No fallback — authenticate the approved company mailbox only.",
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }

    await prisma.gmailAccount.update({
      where: { id: account.id },
      data: {
        companyId: company.id,
        mappedAt: new Date(),
        mappingConfirmedBy: "FOUNDER_REGISTRY_MATCH",
        sendingEnabled: enableSending,
      },
    });

    await prisma.company.update({
      where: { id: company.id },
      data: {
        approvedSourcingMailbox: mapping.approvedGmail,
        // Do NOT set signatory from Gmail profile
      },
    });

    await writeAuditEvent({
      action: "GMAIL_MAPPED",
      entityType: "GmailAccount",
      entityId: account.id,
      newState: {
        companyId: company.id,
        company: company.legalName,
        approvedGmail: mapping.approvedGmail,
        signatory: "NOT_SET_FROM_GMAIL — explicit Founder config required",
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        STATUS: mapping?.ok ? "GMAIL_CONNECTED_AND_MAPPED" : "GMAIL_CONNECTED",
        AUTHENTICATED_EMAIL: result.email,
        MAPPED_COMPANY: company?.legalName ?? null,
        APPROVED_SOURCING_MAILBOX: mapping?.ok
          ? mapping.approvedGmail
          : null,
        AUTHORISED_SOURCING_SIGNATORY:
          "NOT_INFERRED — configure explicitly or certification shows BLOCKED_NO_APPROVED_SIGNATORY",
        SENDING_ENABLED: enableSending && Boolean(mapping?.ok),
        NOTE: "Tokens encrypted in DB; not printed. SmartProcure/personal mailboxes refused for company sourcing.",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
