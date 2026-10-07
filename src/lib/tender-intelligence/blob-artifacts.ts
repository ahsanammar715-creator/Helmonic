import { ManagedIdentityCredential } from "@azure/identity";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchWithTimeout } from "./fetch-with-timeout.ts";

const storageScope = "https://storage.azure.com/.default";
const storageApiVersion = "2023-11-03";
const durableFiles = [
  "document-proven/confirmed-ledger.json",
  "document-proven/pipeline-state.json",
  "document-proven/latest-audit.json",
] as const;

type BlobConfig = {
  accountName: string;
  containerName: string;
  managedIdentityClientId: string;
};

function configuration(): BlobConfig | undefined {
  if (process.env.HELMONIC_TENDER_BLOB_ENABLED !== "true") return undefined;
  const accountName = process.env.AZURE_TENDER_STORAGE_ACCOUNT?.trim();
  const containerName = process.env.AZURE_TENDER_STORAGE_CONTAINER?.trim();
  const managedIdentityClientId = process.env.AZURE_TENDER_STORAGE_CLIENT_ID?.trim();
  if (!accountName || !containerName || !managedIdentityClientId) {
    throw new Error("Tender artifact persistence is enabled but its account, container or managed identity is missing.");
  }
  return { accountName, containerName, managedIdentityClientId };
}

function blobUrl(config: BlobConfig, blobName: string) {
  const encoded = blobName.split("/").map(encodeURIComponent).join("/");
  return `https://${config.accountName}.blob.core.windows.net/${encodeURIComponent(config.containerName)}/${encoded}`;
}

function containerUrl(config: BlobConfig) {
  return `https://${config.accountName}.blob.core.windows.net/${encodeURIComponent(config.containerName)}`;
}

async function accessToken(config: BlobConfig) {
  const credential = new ManagedIdentityCredential(config.managedIdentityClientId);
  const token = await credential.getToken(storageScope);
  if (!token?.token) throw new Error("Tender artifact storage token was unavailable.");
  return token.token;
}

async function request(config: BlobConfig, token: string, blobName: string, init: RequestInit = {}) {
  return fetchWithTimeout(fetch, blobUrl(config, blobName), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": storageApiVersion,
      ...(init.headers ?? {}),
    },
  }, 60_000);
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

async function listBlobs(config: BlobConfig, token: string, prefix: string) {
  const names: string[] = [];
  let marker = "";
  do {
    const query = new URLSearchParams({ restype: "container", comp: "list", prefix });
    if (marker) query.set("marker", marker);
    const response = await fetchWithTimeout(fetch, `${containerUrl(config)}?${query}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-ms-date": new Date().toUTCString(),
        "x-ms-version": storageApiVersion,
      },
    }, 60_000);
    if (!response.ok) throw new Error(`Tender input listing failed with status ${response.status}.`);
    const xml = await response.text();
    names.push(...[...xml.matchAll(/<Name>([\s\S]*?)<\/Name>/g)].map((match) => decodeXml(match[1])));
    marker = decodeXml(xml.match(/<NextMarker>([\s\S]*?)<\/NextMarker>/)?.[1] ?? "").trim();
  } while (marker);
  return names;
}

function safeInputRelativePath(blobName: string, prefix: string) {
  if (!blobName.startsWith(prefix)) throw new Error("BuildingInfo input blob is outside the configured prefix.");
  const relative = blobName.slice(prefix.length).replaceAll("\\", "/");
  const segments = relative.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`BuildingInfo input blob has an unsafe name: ${blobName}.`);
  }
  return segments;
}

async function hydrateBuildingInfoCsv(config: BlobConfig, token: string, artifactRoot: string) {
  if (process.env.HELMONIC_BUILDINGINFO_CSV_ENABLED !== "true") return 0;
  const configuredPrefix = process.env.HELMONIC_BUILDINGINFO_BLOB_PREFIX?.trim() || "input/buildinginfo/";
  const prefix = configuredPrefix.endsWith("/") ? configuredPrefix : `${configuredPrefix}/`;
  const maxFiles = Math.max(1, Number.parseInt(process.env.HELMONIC_BUILDINGINFO_CSV_MAX_FILES || "1000", 10));
  const maxFileBytes = Math.max(1, Number.parseInt(process.env.HELMONIC_BUILDINGINFO_CSV_MAX_FILE_BYTES || String(5 * 1024 * 1024), 10));
  const names = (await listBlobs(config, token, prefix))
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .sort();
  if (names.length > maxFiles) {
    throw new Error(`BuildingInfo blob inbox contains ${names.length} CSV files; configured maximum is ${maxFiles}.`);
  }
  for (const name of names) {
    const segments = safeInputRelativePath(name, prefix);
    const response = await request(config, token, name);
    if (!response.ok) throw new Error(`BuildingInfo input download failed for ${name} with status ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxFileBytes) {
      throw new Error(`BuildingInfo input ${name} is ${bytes.byteLength} bytes; configured maximum is ${maxFileBytes}.`);
    }
    const target = path.join(artifactRoot, "incoming", "buildinginfo", ...segments);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return names.length;
}

async function filesUnder(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await filesUnder(path.join(directory, entry.name), relative));
    else if (entry.isFile()) output.push(relative.replaceAll("\\", "/"));
  }
  return output;
}

export async function hydrateTenderArtifacts(artifactRoot: string) {
  const config = configuration();
  if (!config) return { enabled: false, downloaded: 0, buildingInfoCsvFiles: 0 };
  const token = await accessToken(config);
  let downloaded = 0;
  for (const relativePath of durableFiles) {
    const response = await request(config, token, `current/${relativePath}`);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Tender artifact download failed for ${relativePath} with status ${response.status}.`);
    const target = path.join(artifactRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(await response.arrayBuffer()));
    downloaded += 1;
  }
  const buildingInfoCsvFiles = await hydrateBuildingInfoCsv(config, token, artifactRoot);
  return { enabled: true, downloaded, buildingInfoCsvFiles };
}

async function uploadFile(config: BlobConfig, token: string, localPath: string, blobName: string) {
  const body = await readFile(localPath);
  const response = await request(config, token, blobName, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": localPath.endsWith(".json") ? "application/json"
        : localPath.endsWith(".csv") ? "text/csv; charset=utf-8"
          : localPath.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream",
    },
    body,
  });
  if (!response.ok) throw new Error(`Tender artifact upload failed for ${blobName} with status ${response.status}.`);
}

export async function persistTenderArtifacts(artifactRoot: string, runId: string) {
  const config = configuration();
  if (!config) return { enabled: false, uploaded: 0 };
  const token = await accessToken(config);
  // Raw supplier inbox files are inputs, not run artifacts. Avoid multiplying
  // personal/contact data into every run archive.
  const files = (await filesUnder(artifactRoot))
    .filter((relativePath) => !relativePath.startsWith("incoming/"));
  const concurrency = 4;
  let next = 0;
  let uploaded = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= files.length) return;
      const relativePath = files[index];
      await uploadFile(config, token, path.join(artifactRoot, ...relativePath.split("/")), `runs/${runId}/${relativePath}`);
      uploaded += 1;
    }
  }));
  for (const relativePath of durableFiles) {
    const localPath = path.join(artifactRoot, ...relativePath.split("/"));
    try {
      await uploadFile(config, token, localPath, `current/${relativePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      throw error;
    }
  }
  return { enabled: true, uploaded };
}
