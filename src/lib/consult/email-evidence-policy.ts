import type { AuthenticatedActor } from "@/lib/server/identity";
import type { RuntimeConfig } from "@/lib/server/config";

export const restrictedEmailIndexName = "consult-email-relationship-restricted-v1";

export function emailEvidenceConfigurationErrors(config: RuntimeConfig) {
  const missing: string[] = [];

  if (!config.emailEvidence.enabled) missing.push("HELMONIC_EMAIL_EVIDENCE_ENABLED=true");
  if (!config.emailEvidence.endpoint) missing.push("AZURE_EMAIL_SEARCH_ENDPOINT");
  if (!config.emailEvidence.indexName) missing.push("AZURE_EMAIL_SEARCH_INDEX");
  if (!config.emailEvidence.managedIdentityClientId) {
    missing.push("AZURE_EMAIL_SEARCH_CLIENT_ID");
  }
  if (
    config.emailEvidence.leadershipObjectIds.length === 0 &&
    config.emailEvidence.leadershipGroupIds.length === 0
  ) {
    missing.push("HELMONIC_EMAIL_LEADERSHIP_OBJECT_IDS or HELMONIC_EMAIL_LEADERSHIP_GROUP_IDS");
  }
  if (config.emailEvidence.indexName && config.emailEvidence.indexName === config.search.indexName) {
    missing.push("AZURE_EMAIL_SEARCH_INDEX must be a separate index");
  }

  return missing;
}

export function actorMayReadRestrictedEmailEvidence(
  actor: AuthenticatedActor | null,
  config: RuntimeConfig,
) {
  if (!actor || emailEvidenceConfigurationErrors(config).length > 0) return false;

  const actorId = actor.objectId.toLowerCase();
  if (config.emailEvidence.leadershipObjectIds.includes(actorId)) return true;

  return actor.groupObjectIds.some((group) =>
    config.emailEvidence.leadershipGroupIds.includes(group.toLowerCase()),
  );
}
