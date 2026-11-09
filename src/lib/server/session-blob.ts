import "server-only";

import { createHash } from "node:crypto";

import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

const storageApiVersion = "2023-11-03";

function encodeBlobName(blobName: string) {
  return blobName.split("/").map(encodeURIComponent).join("/");
}

function validatingPdfStream(source: ReadableStream<Uint8Array>) {
  const reader = source.getReader();
  const hash = createHash("sha256");
  const buffered: Uint8Array[] = [];
  let bufferedLength = 0;
  let validated = false;
  let settled = false;
  let resolveHash: (value: string) => void;
  let rejectHash: (reason: unknown) => void;
  const contentHash = new Promise<string>((resolve, reject) => {
    resolveHash = resolve;
    rejectHash = reject;
  });

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          if (!validated) throw new Error("invalid-pdf-signature");
          controller.close();
          if (!settled) {
            settled = true;
            resolveHash(hash.digest("hex"));
          }
          return;
        }

        const bytes = result.value;
        hash.update(bytes);

        if (!validated) {
          buffered.push(bytes);
          bufferedLength += bytes.byteLength;
          if (bufferedLength < 5) return;

          const prefix = Buffer.concat(buffered.map((chunk) => Buffer.from(chunk))).subarray(0, 5);
          if (prefix.toString("ascii") !== "%PDF-") {
            throw new Error("invalid-pdf-signature");
          }
          validated = true;
          for (const chunk of buffered) controller.enqueue(chunk);
          buffered.length = 0;
          return;
        }

        controller.enqueue(bytes);
      } catch (error) {
        controller.error(error);
        if (!settled) {
          settled = true;
          rejectHash(error);
        }
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      if (!settled) {
        settled = true;
        rejectHash(reason);
      }
    },
  });

  return { stream, contentHash };
}

export async function uploadSessionPdf(
  config: RuntimeConfig,
  blobName: string,
  contentLength: number,
  body: ReadableStream<Uint8Array>,
  requestId: string,
) {
  const accountName = config.storage.accountName;
  if (!accountName) throw new Error("storage-not-configured");

  const token = await getAzureAccessToken("https://storage.azure.com/.default");
  const { stream, contentHash } = validatingPdfStream(body);
  const url = `https://${accountName}.blob.core.windows.net/${encodeURIComponent(
    config.phase1b.sessionBlobContainer,
  )}/${encodeBlobName(blobName)}`;
  const init = {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Length": String(contentLength),
      "Content-Type": "application/pdf",
      "x-ms-blob-content-type": "application/pdf",
      "x-ms-blob-type": "BlockBlob",
      "x-ms-client-request-id": requestId,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": storageApiVersion,
    },
    body: stream,
    duplex: "half",
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  } as RequestInit & { duplex: "half" };
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    void contentHash.catch(() => undefined);
    throw error;
  }
  if (!response.ok) {
    void contentHash.catch(() => undefined);
    throw new Error(`blob-upload-${response.status}`);
  }

  return { sourceUri: url, contentHash: await contentHash };
}
