import "server-only";

import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

export type SessionIngestionMessage = {
  version: 1;
  operation: "ingest-session-document";
  jobId: string;
  documentId: string;
  documentVersionId: string;
  conversationId: string;
  ownerObjectId: string;
  blobContainer: string;
  blobName: string;
  sourceUri: string;
  contentHash: string;
  displayName: string;
  targetIndex: string;
  expiresAt: string;
  correlationId: string;
};

export async function sendSessionIngestionMessage(
  config: RuntimeConfig,
  message: SessionIngestionMessage,
) {
  const namespace = config.serviceBus.namespace?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const queue = config.serviceBus.queue;
  if (!namespace || !queue) throw new Error("service-bus-not-configured");

  const token = await getAzureAccessToken("https://servicebus.azure.net/.default");
  const response = await fetch(
    `https://${namespace}/${encodeURIComponent(queue)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        BrokerProperties: JSON.stringify({
          MessageId: message.jobId,
          CorrelationId: message.correlationId,
          ContentType: "application/json",
          Label: message.operation,
        }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`service-bus-send-${response.status}`);
}
