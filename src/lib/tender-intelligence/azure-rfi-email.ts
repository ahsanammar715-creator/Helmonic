type AzureRfiEmailConfig = {
  enabled: boolean;
  connectionString?: string;
  senderAddress?: string;
  recipients?: string;
  allowedDomains?: string;
};

type RfiEmailMessage = {
  runId: string;
  subject: string;
  bodyHtml: string;
};

type AzureEmailMessage = {
  senderAddress: string;
  content: {
    subject: string;
    html: string;
  };
  recipients: {
    to: Array<{
      address: string;
      displayName?: string;
    }>;
  };
};

type AzureEmailSendResult = {
  id?: string;
  status?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

type AzureEmailClient = {
  beginSend(message: AzureEmailMessage): Promise<{
    pollUntilDone(): Promise<AzureEmailSendResult>;
  }>;
};

function normalizedRecipients(raw: string | undefined, allowedDomains: string | undefined) {
  const domains = new Set((allowedDomains || "smartstudioinc.com,iacoustics.net")
    .split(/[;,]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
  const recipients = [...new Set((raw || "")
    .split(/[;,]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  if (recipients.length === 0) throw new Error("RFI email is enabled but no recipient is configured.");
  for (const recipient of recipients) {
    if (!/^[^@\s]+@[^@\s]+$/.test(recipient)) throw new Error(`Invalid RFI email recipient: ${recipient}`);
    const domain = recipient.split("@")[1];
    if (!domains.has(domain)) throw new Error(`RFI email recipient domain is not allow-listed: ${domain}`);
  }
  return recipients;
}

export async function sendAzureRfiChangeEmail(
  message: RfiEmailMessage,
  config: AzureRfiEmailConfig,
  clientOverride?: AzureEmailClient,
) {
  if (!config.enabled) return { status: "disabled", runId: message.runId, recipients: [] as string[] };
  if (!config.connectionString || !config.senderAddress) {
    throw new Error(
      "Azure RFI email is enabled but AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING or AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS is missing.",
    );
  }
  const recipients = normalizedRecipients(config.recipients, config.allowedDomains);
  const client = clientOverride ?? (new (await import("@azure/communication-email")).EmailClient(
    config.connectionString,
  ) as AzureEmailClient);
  const poller = await client.beginSend({
    senderAddress: config.senderAddress,
    content: {
      subject: message.subject,
      html: message.bodyHtml,
    },
    recipients: {
      to: recipients.map((address) => ({
        address,
      })),
    },
  });
  const result = await poller.pollUntilDone();
  if (result.status?.toLowerCase() !== "succeeded") {
    const detail = result.error?.message || result.error?.code || result.status || "unknown send failure";
    throw new Error(`Azure Communication Services email failed: ${detail}`);
  }
  return {
    status: "sent",
    provider: "azure-communication-services",
    runId: message.runId,
    recipients,
    messageId: result.id,
    sentAt: new Date().toISOString(),
  };
}
