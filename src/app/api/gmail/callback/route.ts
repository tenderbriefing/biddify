import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto/tokenVault";
import {
  emailFromIdToken,
  exchangeAuthorizationCode,
  getOAuthConfig,
} from "@/integrations/gmail/oauth";
import { ensureBiddifyLabels } from "@/integrations/gmail/client";
import { getSession } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const config = getOAuthConfig();
  if (!config) {
    return NextResponse.json({ error: "OAuth not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expectedState = jar.get("gmail_oauth_state")?.value;
  const verifier = jar.get("gmail_oauth_verifier")?.value;

  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  jar.delete("gmail_oauth_state");
  jar.delete("gmail_oauth_verifier");

  const tokens = await exchangeAuthorizationCode({
    config,
    code,
    codeVerifier: verifier,
  });

  const email = emailFromIdToken(tokens.id_token);
  if (!email) {
    return NextResponse.json(
      {
        error:
          "Could not discover account email from OAuth identity. Reconnect and ensure email scope is granted.",
      },
      { status: 400 },
    );
  }

  const account = await prisma.gmailAccount.upsert({
    where: { emailAddress: email.toLowerCase() },
    create: {
      emailAddress: email.toLowerCase(),
      connectionStatus: "CONNECTED",
      scopesGranted: tokens.scope ?? null,
      sendingEnabled: false,
      receivingEnabled: true,
      notes:
        "Connected via OAuth. Company mapping required before sending is enabled.",
    },
    update: {
      connectionStatus: "CONNECTED",
      scopesGranted: tokens.scope ?? null,
      syncError: null,
      lastSuccessfulSync: new Date(),
    },
  });

  await prisma.gmailToken.upsert({
    where: { gmailAccountId: account.id },
    create: {
      gmailAccountId: account.id,
      encryptedAccessToken: encryptSecret(tokens.access_token),
      encryptedRefreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null,
      tokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
    },
    update: {
      encryptedAccessToken: encryptSecret(tokens.access_token),
      encryptedRefreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : undefined,
      tokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  try {
    await ensureBiddifyLabels(tokens.access_token);
  } catch {
    // Labels are best-effort; do not fail connection.
  }

  await writeAuditEvent({
    action: "GMAIL_CONNECTED",
    entityType: "GmailAccount",
    entityId: account.id,
    userId: user.id,
    metadata: {
      email: account.emailAddress,
      companyMapped: Boolean(account.companyId),
    },
  });

  return NextResponse.redirect(
    new URL(`/settings/gmail?connected=${encodeURIComponent(account.emailAddress)}`, req.url),
  );
}
