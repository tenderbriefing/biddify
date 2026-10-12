/**
 * Deterministic source identity for idempotent imports.
 * source + sourceOpportunityId uniquely identifies a procurement opportunity.
 */

export function buildSourceIdentity(
  source: string,
  sourceOpportunityId: string,
): { source: string; sourceOpportunityId: string; key: string } {
  const normalizedSource = source.trim();
  const normalizedId = sourceOpportunityId.trim();
  if (!normalizedSource) {
    throw new Error("source is required for source identity");
  }
  if (!normalizedId) {
    throw new Error("sourceOpportunityId is required for source identity");
  }
  return {
    source: normalizedSource,
    sourceOpportunityId: normalizedId,
    key: `${normalizedSource}::${normalizedId}`,
  };
}

export const ETENDERS_OCDS_SOURCE = "ETENDERS_OCDS";

export function etendersSourceIdentity(ocid: string) {
  return buildSourceIdentity(ETENDERS_OCDS_SOURCE, ocid);
}
