export const ROLES = [
  "FOUNDER",
  "ADMIN",
  "BID_MANAGER",
  "REVIEWER",
  "READ_ONLY",
] as const;

export type Role = (typeof ROLES)[number];

export type Permission =
  | "rfq:read"
  | "rfq:write"
  | "rfq:qualify"
  | "rfq:nobid"
  | "company:read"
  | "company:write"
  | "supplier:read"
  | "supplier:write"
  | "pricing:read"
  | "pricing:write"
  | "compliance:read"
  | "compliance:write"
  | "approval:review"
  | "approval:founder"
  | "submission:prepare"
  | "submission:execute"
  | "sourcing:send"
  | "government:submit"
  | "admin:users"
  | "admin:outbound"
  | "audit:read";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  FOUNDER: [
    "rfq:read",
    "rfq:write",
    "rfq:qualify",
    "rfq:nobid",
    "company:read",
    "company:write",
    "supplier:read",
    "supplier:write",
    "pricing:read",
    "pricing:write",
    "compliance:read",
    "compliance:write",
    "approval:review",
    "approval:founder",
    "submission:prepare",
    "submission:execute",
    "sourcing:send",
    "government:submit",
    "admin:users",
    "admin:outbound",
    "audit:read",
  ],
  ADMIN: [
    "rfq:read",
    "rfq:write",
    "rfq:qualify",
    "rfq:nobid",
    "company:read",
    "company:write",
    "supplier:read",
    "supplier:write",
    "pricing:read",
    "pricing:write",
    "compliance:read",
    "compliance:write",
    "approval:review",
    "submission:prepare",
    "sourcing:send",
    "admin:users",
    "admin:outbound",
    "audit:read",
  ],
  BID_MANAGER: [
    "rfq:read",
    "rfq:write",
    "rfq:qualify",
    "rfq:nobid",
    "company:read",
    "supplier:read",
    "supplier:write",
    "pricing:read",
    "pricing:write",
    "compliance:read",
    "compliance:write",
    "approval:review",
    "submission:prepare",
    "sourcing:send",
    "audit:read",
  ],
  REVIEWER: [
    "rfq:read",
    "company:read",
    "supplier:read",
    "pricing:read",
    "compliance:read",
    "approval:review",
    "audit:read",
  ],
  READ_ONLY: [
    "rfq:read",
    "company:read",
    "supplier:read",
    "pricing:read",
    "compliance:read",
    "audit:read",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Role ${role} lacks permission ${permission}`);
  }
}

/** Founder approval is separately enforceable — ADMIN cannot substitute. */
export function canFounderApprove(role: Role): boolean {
  return hasPermission(role, "approval:founder");
}

export function canExecuteSubmission(role: Role): boolean {
  return hasPermission(role, "submission:execute");
}

/** Supplier sourcing send — not government submission. */
export function canSendSupplierSourcing(role: Role): boolean {
  return hasPermission(role, "sourcing:send");
}

/** Government bid submit remains Founder-controlled. */
export function canSubmitGovernmentBid(role: Role): boolean {
  return hasPermission(role, "government:submit");
}
