import "server-only";

import { createHash } from "node:crypto";

import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

const storageApiVersion = "2023-11-03";

function encodeBlobName(blobName: string) {
  return blobName.split("/").map(encodeURIComponent).join("/");
}

function blobUrl(config: RuntimeConfig, blobName: string) {
  const account = config.storage.accountName;
  if (!account) throw new Error("storage-not-configured");
  return `https://${account}.blob.core.windows.net/${encodeURIComponent(
    config.reportGeneration.container,
  )}/${encodeBlobName(blobName)}`;
}

export async function putImmutableReportBlob(input: {
  config: RuntimeConfig;
  blobName: string;
  bytes: Uint8Array;
  contentType: string;
  requestId: string;
}) {
  const token = await getAzureAccessToken("https://storage.azure.com/.default");
  const url = blobUrl(input.config, input.blobName);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": String(input.bytes.byteLength),
      "Content-MD5": Buffer.from(createHash("md5").update(input.bytes).digest()).toString("base64"),
      "Content-Type": input.contentType,
      "x-ms-blob-content-type": input.contentType,
      "x-ms-blob-type": "BlockBlob",
      "x-ms-client-request-id": input.requestId,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": storageApiVersion,
      "If-None-Match": "*",
    },
    body: input.bytes.slice().buffer as ArrayBuffer,
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`report-blob-write-${response.status}`);
  return { blobName: input.blobName, url };
}

export async function readReportBlob(input: {
  config: RuntimeConfig;
  blobName: string;
  requestId: string;
}) {
  const token = await getAzureAccessToken("https://storage.azure.com/.default");
  const response = await fetch(blobUrl(input.config, input.blobName), {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-ms-client-request-id": input.requestId,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": storageApiVersion,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`report-blob-read-${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}
