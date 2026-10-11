"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  SESSION_COOKIE,
  createSessionToken,
  type SessionUser,
} from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit";
import type { Role } from "@/domain/permissions";

export type LoginState = {
  error?: string;
};

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return { error: "Invalid credentials." };
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return { error: "Invalid credentials." };
  }

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    isDemo: user.isDemo,
  };

  const token = await createSessionToken(sessionUser);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  await writeAuditEvent({
    action: "USER_LOGIN",
    entityType: "User",
    entityId: user.id,
    userId: user.id,
    metadata: { email: user.email, role: user.role },
  });

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);

  if (token) {
    // Best-effort audit; ignore session parse failures on logout
    try {
      const { verifySessionToken } = await import("@/lib/auth/session");
      const session = await verifySessionToken(token);
      if (session) {
        await writeAuditEvent({
          action: "USER_LOGOUT",
          entityType: "User",
          entityId: session.id,
          userId: session.id,
        });
      }
    } catch {
      /* ignore */
    }
  }

  redirect("/login");
}
