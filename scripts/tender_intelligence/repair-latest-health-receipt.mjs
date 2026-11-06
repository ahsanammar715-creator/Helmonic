import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  hydrateTenderArtifacts,
  persistTenderArtifacts,
} from "../../src/lib/tender-intelligence/blob-artifacts.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "helmonic-ti-health-repair-"));

try {
  await hydrateTenderArtifacts(root);
  const healthPath = path.join(root, "automation-runs", "latest-health.json");
  const health = JSON.parse(await readFile(healthPath, "utf8"));
  const requiredTrueChecks = [
    "workerCompleted",
    "authoritativeAuditFresh",
    "rfiDocumentAuditFresh",
    "odooSyncFresh",
    "odooSyncCompleted",
    "noOdooFailures",
  ];
  const failedRequiredChecks = requiredTrueChecks.filter((name) => health?.checks?.[name] !== true);
  const actualSourceFailures = (health.sources ?? []).filter((source) => {
    const status = String(source?.fetchStatus ?? "");
    if (status === "not-configured") return false;
    return Boolean(source?.fetchError)
      || /fail|error|timeout|unauthor|rate.?limit/i.test(status);
  });
  const intentionallyDisabled = (health.sources ?? []).filter((source) => source?.fetchStatus === "not-configured");

  if (health.status !== "degraded"
    || health.healthy !== false
    || health?.checks?.noSourceFailures !== false
    || failedRequiredChecks.length
    || actualSourceFailures.length
    || intentionallyDisabled.length === 0) {
    throw new Error("Refusing health repair: the receipt is not degraded solely by intentionally disabled sources.");
  }

  const repairedAt = new Date();
  const status = health?.checks?.odooSyncEnabled === true ? "healthy" : "healthy-no-odoo-write";
  const repaired = {
    ...health,
    status,
    healthy: true,
    checks: { ...health.checks, noSourceFailures: true },
    counts: { ...health.counts, sourceFailures: 0 },
    healthReevaluation: {
      repairedAt: repairedAt.toISOString(),
      reason: "Sources explicitly marked not-configured are inactive by design, not failed.",
      intentionallyDisabledSources: intentionallyDisabled.map((source) => source.name),
    },
    message: status === "healthy"
      ? `Tender Intelligence completed at ${health.completedAtDublin}: ${health.counts.liveConfirmedAcousticRfis} live confirmed acoustic RFI(s), ${health.counts.newlyDetected} newly detected lead(s), ${health.counts.materiallyUpdated} materially updated lead(s), ${health.counts.odooCreated} created in Odoo, ${health.counts.odooUpdated} updated, ${health.counts.evidenceUnavailable} evidence-unavailable.`
      : `Tender Intelligence completed at ${health.completedAtDublin} without Odoo writes: ${health.counts.liveConfirmedAcousticRfis} live confirmed acoustic RFI(s), ${health.counts.newlyDetected} newly detected lead(s), ${health.counts.evidenceUnavailable} evidence-unavailable.`,
  };
  await writeFile(healthPath, `${JSON.stringify(repaired, null, 2)}\n`, "utf8");
  const repairRunId = `health-repair-${repairedAt.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}`;
  const persistence = await persistTenderArtifacts(root, repairRunId);
  console.log(`TENDER_INTELLIGENCE_HEALTH_REPAIR_JSON=${JSON.stringify({ repaired, persistence })}`);
} catch (error) {
  console.error(`Tender Intelligence health repair failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
