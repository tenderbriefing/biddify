import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/domain/permissions";
import {
  buildAuthorizationUrl,
  createPkcePair,
  getOAuthConfig,
} from "@/integrations/gmail/oauth";

export async function GET() {
  const user = await getSession();
  if (!user || !hasPermission(user.role, "admin:outbound")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (user.isDemo) {
    return NextResponse.json(
      { error: "DEMO users cannot connect operational Gmail" },
      { status: 403 },
    );
  }

  const config = getOAuthConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "Gmail OAuth not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI in .env (Desktop/loopback client).",
      },
      { status: 503 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const pkce = createPkcePair();
  const jar = await cookies();
  jar.set("gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  jar.set("gmail_oauth_verifier", pkce.verifier, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const url = buildAuthorizationUrl({
    config,
    state,
    codeChallenge: pkce.challenge,
  });
  return NextResponse.redirect(url);
}
