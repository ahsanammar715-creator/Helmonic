import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createUserAssignedManagedIdentityCredential } from "../managed-identity.mjs";
import {
  encodeBlobName,
  projectReference,
  sha256,
  validatePilotPayload,
} from "./audio-pilot-contract.mjs";

const storageAccount = required("AZURE_STORAGE_ACCOUNT");
const container = process.env.AZURE_STORAGE_AUDIO_CONTAINER || "consult-controlled-audio";
const payloadRoot = process.env.HELMONIC_AUDIO_PILOT_PAYLOAD || "/payload";
const storageApiVersion = "2023-11-03";
const credential = createUserAssignedManagedIdentityCredential();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function token() {
  const result = await credential.getToken("https://storage.azure.com/.default");
  if (!result?.token) throw new Error("No managed-identity Storage token");
  return result.token;
}

async function request(url, accessToken, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-ms-version": storageApiVersion,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-client-request-id": crypto.randomUUID(),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
}

function blobUrl(blobName = "") {
  const suffix = blobName ? `/${encodeBlobName(blobName)}` : "";
  return `https://${storageAccount}.blob.core.windows.net/${encodeURIComponent(container)}${suffix}`;
}

async function ensureContainer(accessToken) {
  const response = await request(`${blobUrl()}?restype=container`, accessToken, { method: "PUT" });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Audio Blob container creation failed with status ${response.status}`);
  }
}

async function verifyBlob(accessToken, item, bytes) {
  const head = await request(blobUrl(item.blob_name), accessToken, { method: "HEAD" });
  if (!head.ok) throw new Error(`Audio Blob HEAD failed for ${item.source_id}: ${head.status}`);
  if (
    Number(head.headers.get("content-length")) !== item.size_bytes ||
    head.headers.get("x-ms-meta-sha256") !== item.sha256 ||
    head.headers.get("x-ms-meta-sourceid") !== item.source_id
  ) {
    throw new Error(`Stored audio metadata mismatch for ${item.source_id}`);
  }

  const range = await request(blobUrl(item.blob_name), accessToken, {
    headers: { Range: "bytes=0-11" },
  });
  if (range.status !== 206) throw new Error(`Audio byte-range check failed for ${item.source_id}: ${range.status}`);
  const header = Buffer.from(await range.arrayBuffer());
  if (!header.subarray(0, 4).equals(bytes.subarray(0, 4)) || !header.subarray(8, 12).equals(bytes.subarray(8, 12))) {
    throw new Error(`Stored WAVE header mismatch for ${item.source_id}`);
  }
}

async function uploadOriginal(accessToken, item, bytes) {
  const put = await request(blobUrl(item.blob_name), accessToken, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "x-ms-meta-sourceid": item.source_id,
      "x-ms-meta-sha256": item.sha256,
      "x-ms-meta-scope": item.permission_scope,
      "x-ms-meta-citation": "AU",
      "x-ms-meta-pilot": "true",
      "Content-Type": "audio/wav",
      "If-None-Match": "*",
    },
    body: bytes,
  });
  if (!put.ok && put.status !== 412) {
    throw new Error(`Audio Blob upload failed for ${item.source_id}: ${put.status}`);
  }
  await verifyBlob(accessToken, item, bytes);
}

async function uploadCatalog(accessToken, payload, catalog) {
  const bytes = Buffer.from(JSON.stringify(catalog));
  const response = await request(
    blobUrl(`catalog/pilots/${payload.pilot_id}.json`),
    accessToken,
    {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-meta-pilot": "true",
        "Content-Type": "application/json",
        "If-None-Match": "*",
      },
      body: bytes,
    },
  );
  if (!response.ok && response.status !== 412) {
    throw new Error(`Audio pilot catalog upload failed: ${response.status}`);
  }
}

async function main() {
  const payload = JSON.parse(await readFile(join(payloadRoot, "payload.json"), "utf8"));
  const { totalBytes } = validatePilotPayload(payload);
  const accessToken = await token();
  await ensureContainer(accessToken);

  const catalog = [];
  for (const item of payload.documents) {
    const bytes = await readFile(join(payloadRoot, "originals", item.local_name));
    if (bytes.length !== item.size_bytes || sha256(bytes) !== item.sha256) {
      throw new Error(`Private payload integrity failed for ${item.source_id}`);
    }
    await uploadOriginal(accessToken, item, bytes);
    catalog.push({
      source_id: item.source_id,
      blob_name: item.blob_name,
      project_reference: projectReference(item.relative_path),
      relative_path: item.relative_path,
      permission_scope: item.permission_scope,
      citation_namespace: "AU",
      duration_seconds: item.duration_seconds,
      playback_strategy: item.playback_strategy,
      sha256: item.sha256,
      promotion_state: "pilot_only",
      content_processing: "none",
    });
  }
  await uploadCatalog(accessToken, payload, catalog);
  console.log(JSON.stringify({
    pilotId: payload.pilot_id,
    documents: catalog.length,
    bytes: totalBytes,
    privateBlobIntegrity: "passed",
    authorizedByteRange: "passed",
    citationNamespace: "AU",
    contentProcessing: "none",
    promotionState: "pilot_only",
  }));
}

await main();
