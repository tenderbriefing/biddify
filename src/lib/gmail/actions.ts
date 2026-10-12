"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/domain/permissions";
import { writeAuditEvent } from "@/lib/audit";

export async function mapGmailToCompanyAction(formData: FormData) {
  const user = await getSession();
  if (!user || !hasPermission(user.role, "admin:outbound")) {
    throw new Error("Forbidden");
  }
  if (user.isDemo) throw new Error("DEMO user cannot map operational Gmail");

  const gmailAccountId = String(formData.get("gmailAccountId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!gmailAccountId || !companyId) throw new Error("Missing mapping fields");

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.isDemo || company.dataMode === "TEST") {
    throw new Error("Can only map Gmail to operational (non-DEMO) companies");
  }

  await prisma.gmailAccount.update({
    where: { id: gmailAccountId },
    data: {
      companyId,
      mappedAt: new Date(),
      mappingConfirmedBy: user.email,
      // Sending stays disabled until Founder explicitly enables.
      sendingEnabled: false,
    },
  });

  await writeAuditEvent({
    action: "GMAIL_MAPPED",
    entityType: "GmailAccount",
    entityId: gmailAccountId,
    userId: user.id,
    newState: { companyId, company: company.legalName },
  });

  revalidatePath("/settings/gmail");
  revalidatePath(`/companies/${companyId}`);
}

export async function setGmailSendingAction(formData: FormData) {
  const user = await getSession();
  if (!user || !hasPermission(user.role, "admin:outbound")) {
    throw new Error("Forbidden");
  }
  const gmailAccountId = String(formData.get("gmailAccountId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const account = await prisma.gmailAccount.findUnique({
    where: { id: gmailAccountId },
  });
  if (!account?.companyId) {
    throw new Error("Map company before enabling sending");
  }
  await prisma.gmailAccount.update({
    where: { id: gmailAccountId },
    data: { sendingEnabled: enabled },
  });
  revalidatePath("/settings/gmail");
}

export async function setGlobalOutboundPauseAction(formData: FormData) {
  const user = await getSession();
  if (!user || !hasPermission(user.role, "admin:outbound")) {
    throw new Error("Forbidden");
  }
  const paused = String(formData.get("paused") ?? "") === "true";
  await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      globalOutboundPaused: paused,
      outboundMode: "DISABLED",
    },
    update: { globalOutboundPaused: paused },
  });
  await writeAuditEvent({
    action: paused ? "OUTBOUND_PAUSED" : "OUTBOUND_RESUMED",
    entityType: "SystemSettings",
    entityId: "default",
    userId: user.id,
  });
  revalidatePath("/settings/gmail");
  revalidatePath("/");
}

export async function setCompanyOutboundAction(formData: FormData) {
  const user = await getSession();
  if (!user || !hasPermission(user.role, "admin:outbound")) {
    throw new Error("Forbidden");
  }
  const companyId = String(formData.get("companyId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.isDemo) {
    throw new Error("Cannot enable outbound on DEMO company");
  }
  await prisma.company.update({
    where: { id: companyId },
    data: { outboundSourcingEnabled: enabled },
  });
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/settings/gmail");
}
