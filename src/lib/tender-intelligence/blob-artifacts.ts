import { ManagedIdentityCredential } from "@azure/identity";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

async function accessToken(config: BlobConfig) {
  const credential = new ManagedIdentityCredential(config.managedIdentityClientId);
  const token = await credential.getToken(storageScope);
  if (!token?.token) throw new Error("Tender artifact storage token was unavailable.");
  return token.token;
}

async function request(config: BlobConfig, token: string, blobName: string, init: RequestInit = {}) {
  return fetch(blobUrl(config, blobName), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": storageApiVersion,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
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
  if (!config) return { enabled: false, downloaded: 0 };
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
  return { enabled: true, downloaded };
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
  const files = await filesUnder(artifactRoot);
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
