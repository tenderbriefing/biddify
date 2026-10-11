import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AuditInput = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  userId?: string | null;
  previousState?: unknown;
  newState?: unknown;
  metadata?: unknown;
};

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Append-only audit trail. Do not update/delete audit rows in application code.
 */
export async function writeAuditEvent(input: AuditInput) {
  const data: Prisma.AuditEventCreateInput = {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    previousState: serialize(input.previousState),
    newState: serialize(input.newState),
    metadata: serialize(input.metadata),
  };

  if (input.userId) {
    data.user = { connect: { id: input.userId } };
  }

  return prisma.auditEvent.create({ data });
}
