import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  assertBuildingInfoUrl,
  buildingInfoBrowserRowsToCsv,
  buildingInfoProjectCategory,
  extractBuildingInfoBrowserRow,
  isCurrentBuildingInfoBrowserTarget,
  parseBuildingInfoResultCount,
} from "../../src/lib/tender-intelligence/building-info-browser.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence");
const outputDirectory = process.env.HELMONIC_BUILDINGINFO_CSV_DIRECTORY
  ? path.resolve(process.env.HELMONIC_BUILDINGINFO_CSV_DIRECTORY)
  : path.join(artifactRoot, "incoming", "buildinginfo");
const auditDirectory = path.join(artifactRoot, "buildinginfo-browser-audit");
const outputPath = path.join(outputDirectory, "buildinginfo-browser-latest.csv");
const temporaryOutputPath = `${outputPath}.tmp`;
const auditPath = path.join(auditDirectory, "latest.json");
const baseUrl = assertBuildingInfoUrl(process.env.BUILDINGINFO_BROWSER_BASE_URL || "https://app.buildinginfo.com/");
const searchUrl = assertBuildingInfoUrl(
  process.env.BUILDINGINFO_BROWSER_SEARCH_URL || new URL("/page.u.newsearch", baseUrl).toString(),
  new URL(baseUrl).hostname,
);
const username = process.env.BUILDINGINFO_BROWSER_USERNAME || "";
const password = process.env.BUILDINGINFO_BROWSER_PASSWORD || "";
const consentReference = process.env.BUILDINGINFO_BROWSER_CONSENT_REFERENCE || "";
const searchTerms = (process.env.BUILDINGINFO_BROWSER_KEYWORDS
  || "noise,acoustic,vibration,sound insulation,noise impact assessment")
  .split(",").map((value) => value.trim()).filter(Boolean);
const searchStages = (process.env.BUILDINGINFO_BROWSER_STAGES
  || "Plans Applied,Plans Granted,Pre-commencement,Commencement")
  .split(",").map((value) => value.trim()).filter(Boolean);
const maximumProjects = Math.max(1, Number.parseInt(process.env.BUILDINGINFO_BROWSER_MAX_PROJECTS || "150", 10));
const maximumResultsPerSearch = Math.max(1, Number.parseInt(process.env.BUILDINGINFO_BROWSER_MAX_RESULTS_PER_SEARCH || "2000", 10));
const maximumLoadMoreClicks = Math.max(0, Number.parseInt(process.env.BUILDINGINFO_BROWSER_MAX_LOAD_MORE_CLICKS || "4", 10));
const requestDelayMs = Math.max(750, Number.parseInt(process.env.BUILDINGINFO_BROWSER_REQUEST_DELAY_MS || "2200", 10));
const navigationTimeoutMs = Math.max(5_000, Number.parseInt(process.env.BUILDINGINFO_BROWSER_TIMEOUT_MS || "45000", 10));
const includePotential = process.env.BUILDINGINFO_BROWSER_INCLUDE_POTENTIAL !== "false";
const headless = process.env.BUILDINGINFO_BROWSER_HEADLESS !== "false";

if (!username || !password) {
  throw new Error("BuildingInfo browser intake is enabled but its Key Vault-backed username/password settings are missing.");
}
if (!consentReference) {
  throw new Error("BuildingInfo browser intake requires a written-consent or contract reference before automated collection can run.");
}
if (searchTerms.length === 0) throw new Error("BuildingInfo browser intake has no configured acoustic search terms.");

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(username, "[username]").replaceAll(password, "[password]");
}

function delay(milliseconds = requestDelayMs) {
  const jitter = Math.floor(Math.random() * Math.min(750, Math.max(1, milliseconds / 3)));
  return new Promise((resolve) => setTimeout(resolve, milliseconds + jitter));
}

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: navigationTimeoutMs });
}

async function assertNoAccessChallenge(page, operation) {
  const text = await bodyText(page).catch(() => "");
  if (/captcha|verify you are human|unusual traffic|access denied|temporarily blocked|too many requests/i.test(text)) {
    throw new Error(`BuildingInfo presented an access challenge during ${operation}; the collector stopped and did not attempt a bypass.`);
  }
}

async function firstVisible(locators) {
  for (const locator of locators) {
    if (await locator.first().isVisible().catch(() => false)) return locator.first();
  }
  return undefined;
}

async function ensureAuthenticated(page) {
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await assertNoAccessChallenge(page, "initial navigation");
  const searchInput = page.getByPlaceholder(/Keywords,?\s*Project Id,?\s*Plan,?\s*Ref/i).first();
  if (await searchInput.isVisible().catch(() => false)) return "existing-session";

  const passwordInput = await firstVisible([
    page.locator('input[type="password"]'),
    page.getByLabel(/password/i),
  ]);
  const usernameInput = await firstVisible([
    page.locator('input[type="email"]'),
    page.getByLabel(/user|email|login/i),
    page.locator('input[name*="user" i], input[name*="email" i], input[name*="login" i], input[type="text"]'),
  ]);
  if (!usernameInput || !passwordInput) {
    throw new Error("BuildingInfo did not show either its authenticated search page or a recognised login form.");
  }
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  const submit = await firstVisible([
    page.getByRole("button", { name: /log\s*in|sign\s*in/i }),
    page.locator('button[type="submit"], input[type="submit"]'),
  ]);
  if (!submit) throw new Error("BuildingInfo login form has no recognised submit control.");
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: navigationTimeoutMs }).catch(() => undefined),
    submit.click(),
  ]);
  await delay(800);
  await assertNoAccessChallenge(page, "login");
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  if (!await searchInput.isVisible().catch(() => false)) {
    throw new Error("BuildingInfo login did not reach the search page; credentials may be invalid or interactive verification may be required.");
  }
  return "fresh-login";
}

async function applyOptionalStageFilters(page) {
  const stagesControl = page.getByText(/^Stages\s*$/i).first();
  if (!await stagesControl.isVisible().catch(() => false)) return { applied: [], unavailable: searchStages };
  await stagesControl.click();
  const applied = [];
  const unavailable = [];
  for (const stage of searchStages) {
    const option = page.getByText(new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).last();
    if (await option.isVisible().catch(() => false)) {
      await option.click();
      applied.push(stage);
    } else unavailable.push(stage);
  }
  return { applied, unavailable };
}

async function runSearch(page, term) {
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await assertNoAccessChallenge(page, `search setup for ${term}`);
  const input = page.getByPlaceholder(/Keywords,?\s*Project Id,?\s*Plan,?\s*Ref/i).first();
  if (!await input.isVisible().catch(() => false)) throw new Error("BuildingInfo keyword search field was not found.");
  await input.fill(term);
  const exact = page.getByLabel(/Exact Match/i).first();
  if (await exact.isVisible().catch(() => false) && await exact.isChecked().catch(() => false)) await exact.uncheck();
  const stageFilter = await applyOptionalStageFilters(page);
  const searchButton = page.getByRole("button", { name: /^Search$/i }).first();
  if (!await searchButton.isVisible().catch(() => false)) throw new Error("BuildingInfo Search button was not found.");
  await searchButton.click();
  await page.waitForLoadState("domcontentloaded", { timeout: navigationTimeoutMs }).catch(() => undefined);
  await delay(700);
  await assertNoAccessChallenge(page, `search for ${term}`);
  let text = await bodyText(page);
  const count = parseBuildingInfoResultCount(text);
  if (count && count.total > maximumResultsPerSearch) {
    throw new Error(`BuildingInfo search '${term}' returned ${count.total} results, above the ${maximumResultsPerSearch} safety limit.`);
  }
  for (let click = 0; click < maximumLoadMoreClicks; click += 1) {
    const loadMore = page.getByRole("button", { name: /Load More Results/i }).first();
    if (!await loadMore.isVisible().catch(() => false)) break;
    await loadMore.click();
    await delay(600);
    await assertNoAccessChallenge(page, `result pagination for ${term}`);
    text = await bodyText(page);
  }
  const hrefs = await page.locator('a[href*="/p-"]').evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
  const projectUrls = [];
  for (const href of hrefs) {
    try {
      projectUrls.push(assertBuildingInfoUrl(href, new URL(baseUrl).hostname));
    } catch {
      // Ignore off-site and malformed links rather than following them.
    }
  }
  return { projectUrls: [...new Set(projectUrls)], count, stageFilter };
}

async function projectSnapshot(page, projectUrl) {
  await page.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await delay();
  await assertNoAccessChallenge(page, `project read ${projectUrl}`);
  const text = await bodyText(page);
  const heading = await page.locator("h1, h2, h3, .project-title, .title").first().innerText().catch(() => "");
  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
    text: (anchor.textContent || "").trim(),
    href: anchor.href,
  })));
  return {
    projectUrl,
    pageTitle: await page.title(),
    heading,
    bodyText: text,
    links,
    observedAt: new Date().toISOString(),
    searchProfile: "iAcoustics acoustic opportunity watch (authenticated browser)",
  };
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(auditDirectory, { recursive: true });
const startedAt = new Date();
const audit = {
  status: "running",
  startedAt: startedAt.toISOString(),
  completedAt: undefined,
  searchUrl,
  consentReference,
  searches: [],
  uniqueProjectLinks: 0,
  inspectedProjects: 0,
  acceptedProjects: 0,
  rejected: { expiredOrFulfilledRfi: 0, notAcoustic: 0, potentialExcluded: 0, incomplete: 0 },
  failures: [],
  outputPath,
};

const browser = await chromium.launch({ headless });
try {
  const context = await browser.newContext({
    locale: "en-IE",
    timezoneId: "Europe/Dublin",
    viewport: { width: 1365, height: 900 },
  });
  const searchPage = await context.newPage();
  audit.authentication = await ensureAuthenticated(searchPage);
  const allUrls = new Set();
  for (const term of searchTerms) {
    const result = await runSearch(searchPage, term);
    audit.searches.push({
      term,
      resultCount: result.count,
      discoveredLinks: result.projectUrls.length,
      stageFilter: result.stageFilter,
    });
    for (const url of result.projectUrls) {
      if (allUrls.size >= maximumProjects) break;
      allUrls.add(url);
    }
    if (allUrls.size >= maximumProjects) break;
    await delay();
  }
  audit.uniqueProjectLinks = allUrls.size;
  const projectPage = await context.newPage();
  const rows = [];
  for (const projectUrl of allUrls) {
    try {
      const snapshot = await projectSnapshot(projectPage, projectUrl);
      audit.inspectedProjects += 1;
      const category = buildingInfoProjectCategory(snapshot);
      const row = extractBuildingInfoBrowserRow(snapshot);
      if (!row) {
        audit.rejected.incomplete += 1;
      } else if (!isCurrentBuildingInfoBrowserTarget(row, category, startedAt, includePotential)) {
        if (category === "fulfilled-rfi" || (category === "acoustic-rfi" && row.rfi_response_due_date)) {
          audit.rejected.expiredOrFulfilledRfi += 1;
        } else if (category === "potential-acoustic") audit.rejected.potentialExcluded += 1;
        else audit.rejected.notAcoustic += 1;
      } else rows.push(row);
    } catch (error) {
      audit.failures.push({ projectUrl, error: redactError(error) });
    }
  }
  audit.acceptedProjects = rows.length;
  await writeFile(temporaryOutputPath, buildingInfoBrowserRowsToCsv(rows), "utf8");
  await rename(temporaryOutputPath, outputPath);
  audit.status = "completed";
} catch (error) {
  audit.status = "failed";
  audit.error = redactError(error);
  process.exitCode = 1;
} finally {
  audit.completedAt = new Date().toISOString();
  await browser.close().catch(() => undefined);
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(audit, null, 2));
}
