export type RateLimitConfig = {
  maxPerHour: number;
  maxPerDay: number;
  maxPerSupplierPerDay: number;
  maxPerCompanyPerDay: number;
  cooldownHours: number;
};

export type RateLimitUsage = {
  sentLastHour: number;
  sentLastDay: number;
  sentToSupplierLastDay: number;
  sentByCompanyLastDay: number;
  hoursSinceSupplierContact: number | null;
};

export function evaluateRateLimits(
  config: RateLimitConfig,
  usage: RateLimitUsage,
): { allowed: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (usage.sentLastHour >= config.maxPerHour) {
    blockers.push(`Hourly limit reached (${config.maxPerHour})`);
  }
  if (usage.sentLastDay >= config.maxPerDay) {
    blockers.push(`Daily limit reached (${config.maxPerDay})`);
  }
  if (usage.sentToSupplierLastDay >= config.maxPerSupplierPerDay) {
    blockers.push(`Per-supplier daily limit reached`);
  }
  if (usage.sentByCompanyLastDay >= config.maxPerCompanyPerDay) {
    blockers.push(`Per-company daily limit reached`);
  }
  if (
    usage.hoursSinceSupplierContact != null &&
    usage.hoursSinceSupplierContact < config.cooldownHours
  ) {
    blockers.push(
      `Supplier cooldown active (${config.cooldownHours}h) — consolidate or wait`,
    );
  }
  return { allowed: blockers.length === 0, blockers };
}
