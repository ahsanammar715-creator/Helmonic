import "server-only";

import { verifyReportTemplateBytes } from "@/lib/consult/report-template-policy";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

const storageApiVersion = "2023-11-03";

function encodeBlobName(blobName: string) {
  return blobName.split("/").map(encodeURIComponent).join("/");
}

export async function loadConfiguredReportTemplate(config: RuntimeConfig) {
  const template = config.reportTemplate;
  if (!template.enabled) throw new Error("report-template-disabled");
  if (!config.storage.accountName) throw new Error("storage-not-configured");
  if (!template.container || !template.blobName || !template.sha256 || !template.byteLength) {
    throw new Error("report-template-not-configured");
  }
  const token = await getAzureAccessToken("https://storage.azure.com/.default");
  const url = `https://${config.storage.accountName}.blob.core.windows.net/${encodeURIComponent(
    template.container,
  )}/${encodeBlobName(template.blobName)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-ms-client-request-id": crypto.randomUUID(),
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": storageApiVersion,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`report-template-read-${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyReportTemplateBytes(bytes, { sha256: template.sha256, byteLength: template.byteLength });
  return { bytes, blobName: template.blobName, sha256: template.sha256 };
}
