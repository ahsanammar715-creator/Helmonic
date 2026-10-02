import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hydrateTenderArtifacts,
  persistTenderArtifacts,
} from "../../src/lib/tender-intelligence/blob-artifacts.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence");
const automationRoot = path.join(artifactRoot, "automation-runs");
const lockPath = path.join(automationRoot, "daily-worker.lock");
const staleLockMs = 18 * 60 * 60 * 1_000;
const startedAt = new Date();
const runId = startedAt.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputDirectory = path.join(automationRoot, runId);
const summaryPath = path.join(outputDirectory, "summary.json");
const summarizeOnly = process.argv.includes("--summarize-only");

function localHour(date, timeZone) {
  return Number.parseInt(new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date), 10);
}

if (process.env.HELMONIC_SCHEDULE_GUARD_ENABLED === "true") {
  const timeZone = process.env.HELMONIC_SCHEDULE_TIMEZONE || "Europe/Dublin";
  const targetHour = Number.parseInt(process.env.HELMONIC_SCHEDULE_LOCAL_HOUR || "7", 10);
  const observedHour = localHour(startedAt, timeZone);
  if (observedHour !== targetHour) {
    console.log(JSON.stringify({
      status: "skipped-outside-local-window",
      runId,
      timeZone,
      targetHour,
      observedHour,
    }));
    process.exit(0);
  }
}

await mkdir(outputDirectory, { recursive: true });
const hydration = await hydrateTenderArtifacts(artifactRoot);
console.log(JSON.stringify({ artifactHydration: hydration }));

async function acquireLock() {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: startedAt.toISOString() })}\n`);
    await handle.close();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let stale = false;
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      stale = Date.now() - Date.parse(lock.startedAt) > staleLockMs;
    } catch {
      stale = true;
    }
    if (!stale) throw new Error("Tender Intelligence daily worker is already running.");
    await unlink(lockPath);
    return acquireLock();
  }
}

function runScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      ...(script.endsWith(".ts") || script.includes("run-document-proven-pipeline") || script.includes("odoo")
        ? ["--experimental-strip-types"] : []),
      path.join(repoRoot, script),
      ...args,
    ], {
      cwd: repoRoot,
      env: { ...process.env, HELMONIC_TENDER_ARTIFACT_ROOT: artifactRoot },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(undefined) : reject(new Error(`${script} stopped with exit code ${code}.`)));
  });
}

const steps = [
  { script: "scripts/tender_intelligence/run-document-proven-pipeline.mjs", args: summarizeOnly ? ["--summarize-only"] : [] },
  { script: "scripts/tender_intelligence/export-review-artifacts.mjs", args: [] },
  { script: "scripts/tender_intelligence/generate-review-digest.mjs", args: [] },
  { script: "scripts/tender_intelligence/build-odoo-dry-run.mjs", args: [] },
  { script: "scripts/tender_intelligence/sync-odoo-leads.mjs", args: [] },
];
const summary = {
  status: "running",
  runId,
  startedAt: startedAt.toISOString(),
  completedAt: undefined,
  artifactRoot,
  odooSyncEnabled: process.env.HELMONIC_ODOO_SYNC_ENABLED === "true",
  buildingInfoEnabled: process.env.HELMONIC_BUILDINGINFO_ENABLED === "true",
  summarizeOnly,
  completedSteps: [],
  failedStep: undefined,
  error: undefined,
};

await acquireLock();
try {
  for (const step of steps) {
    await runScript(step.script, step.args);
    summary.completedSteps.push(step.script);
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  summary.status = "completed";
} catch (error) {
  summary.status = "failed";
  summary.failedStep = steps[summary.completedSteps.length]?.script;
  summary.error = error instanceof Error ? error.message : "Unknown daily-worker error";
  process.exitCode = 1;
} finally {
  summary.completedAt = new Date().toISOString();
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await unlink(lockPath).catch(() => undefined);
  try {
    summary.artifactPersistence = await persistTenderArtifacts(artifactRoot, runId);
  } catch (error) {
    summary.status = "failed";
    summary.failedStep = "artifact-persistence";
    summary.error = error instanceof Error ? error.message : "Tender artifact persistence failed";
    process.exitCode = 1;
  }
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...summary, artifactHydration: hydration }, null, 2));
}
