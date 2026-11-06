import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { hydrateTenderArtifacts } from "../../src/lib/tender-intelligence/blob-artifacts.ts";

const maximumAgeHours = Math.max(
  1,
  Number.parseInt(process.env.HELMONIC_TENDER_WATCHDOG_MAX_AGE_HOURS || "5", 10),
);
const root = await mkdtemp(path.join(os.tmpdir(), "helmonic-ti-watchdog-"));

try {
  await hydrateTenderArtifacts(root);
  const healthPath = path.join(root, "automation-runs", "latest-health.json");
  const health = JSON.parse(await readFile(healthPath, "utf8"));
  const completedAt = new Date(health.completedAt);
  const now = new Date();
  const ageHours = (now.getTime() - completedAt.getTime()) / 3_600_000;
  const expectedStart = new Date(now);
  expectedStart.setUTCHours(7, 0, 0, 0);

  const failures = [];
  if (health.healthy !== true) failures.push(`health status is ${health.status ?? "unknown"}`);
  if (Number.isNaN(completedAt.getTime())) failures.push("completion timestamp is invalid");
  if (!Number.isNaN(completedAt.getTime()) && completedAt < expectedStart) {
    failures.push(`latest completion ${completedAt.toISOString()} is before today's 07:00 UTC run`);
  }
  if (!Number.isNaN(ageHours) && ageHours > maximumAgeHours) {
    failures.push(`latest health receipt is ${ageHours.toFixed(2)} hours old`);
  }

  const result = {
    checkedAt: now.toISOString(),
    healthy: failures.length === 0,
    maximumAgeHours,
    failures,
    health,
  };
  console.log(`TENDER_INTELLIGENCE_WATCHDOG_JSON=${JSON.stringify(result)}`);
  if (failures.length) {
    console.error(`Tender Intelligence watchdog failed: ${failures.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(health.message);
  }
} catch (error) {
  console.error(`Tender Intelligence watchdog could not verify the durable health receipt: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
