import { normalizeText } from "./policy.ts";

const agilePlanningSlugs = new Map<string, string>([
  ["dublin city council", "dublincity"],
  ["dun laoghaire rathdown county council", "dunlaoghaire"],
  ["fingal county council", "fingal"],
  ["south dublin county council", "southdublin"],
]);

const eplanningAuthoritySlugs = new Map<string, string>([
  ["carlow county council", "CarlowCC"],
  ["kildare county council", "KildareCC"],
  ["kilkenny county council", "KilkennyCC"],
  ["laois county council", "LaoisCC"],
  ["longford county council", "LongfordCC"],
  ["louth county council", "LouthCC"],
  ["meath county council", "MeathCC"],
  ["offaly county council", "OffalyCC"],
  ["westmeath county council", "WestmeathCC"],
  ["wexford county council", "WexfordCC"],
  ["wicklow county council", "WicklowCC"],
]);

function normalizedAuthority(value: string) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function resolvedAgileSlug(authority: string) {
  const direct = agilePlanningSlugs.get(authority);
  if (direct) return direct;
  if (/dublin city/.test(authority)) return "dublincity";
  if (/dun laoghaire.*rathdown/.test(authority)) return "dunlaoghaire";
  if (/south dublin/.test(authority)) return "southdublin";
  if (/fingal/.test(authority)) return "fingal";
  return "";
}

function resolvedEplanningSlug(authority: string) {
  const direct = eplanningAuthoritySlugs.get(authority);
  if (direct) return direct;
  for (const [name, slug] of eplanningAuthoritySlugs.entries()) {
    const county = name.replace(/ county council$/, "");
    if (authority.includes(county)) return slug;
  }
  return "";
}

export function genericPlanningPortalUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "");
    return url.hostname.toLowerCase() === "planning.localgov.ie"
      && ["", "/homepage", "/search/application"].includes(path)
      && !url.search;
  } catch {
    return false;
  }
}

/**
 * Return a project-specific public planning URL. The national register does
 * not always populate LinkAppDetails (notably some Dublin authorities), so a
 * deterministic official-council search URL is used rather than exposing a
 * generic portal homepage that cannot identify the project.
 */
export function nationalPlanningProjectUrl(authority: string, reference: string, suppliedUrl = "") {
  const normalizedSupplied = normalizeText(suppliedUrl).replace(/^http:/i, "https:");
  if (normalizedSupplied && !genericPlanningPortalUrl(normalizedSupplied)) return normalizedSupplied;

  const authorityKey = normalizedAuthority(authority);
  const agileSlug = resolvedAgileSlug(authorityKey);
  if (agileSlug) {
    const criteria = encodeURIComponent(JSON.stringify({ openApplications: false, reference }));
    return `https://planning.agileapplications.ie/${agileSlug}/search-applications/results?criteria=${criteria}&page=1`;
  }

  const eplanningSlug = resolvedEplanningSlug(authorityKey);
  if (eplanningSlug) {
    return `https://www.eplanning.ie/${eplanningSlug}/AppFileRefDetails/${encodeURIComponent(reference)}/0`;
  }

  const query = new URLSearchParams({ reference, authority });
  return `https://planning.localgov.ie/search/application?${query}`;
}

