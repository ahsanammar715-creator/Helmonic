import { sendAzureRfiChangeEmail } from "./azure-rfi-email.ts";
import { sendRfiChangeEmail as sendOdooRfiChangeEmail } from "./odoo-rfi-email.ts";

type RfiEmailMessage = {
  runId: string;
  subject: string;
  bodyHtml: string;
};

type RfiEmailConfig = {
  enabled: boolean;
  transport?: string;
  recipients?: string;
  allowedDomains?: string;
  azureConnectionString?: string;
  azureSenderAddress?: string;
  odooBaseUrl?: string;
  odooDatabase?: string;
  odooApiKey?: string;
  odooTimeoutMs?: number;
};

export async function sendRfiChangeEmail(message: RfiEmailMessage, config: RfiEmailConfig) {
  const transport = (config.transport || "odoo").trim().toLowerCase();
  if (transport === "azure-communication-services" || transport === "azure") {
    return sendAzureRfiChangeEmail(message, {
      enabled: config.enabled,
      connectionString: config.azureConnectionString,
      senderAddress: config.azureSenderAddress,
      recipients: config.recipients,
      allowedDomains: config.allowedDomains,
    });
  }
  if (transport !== "odoo") throw new Error(`Unsupported RFI email transport: ${transport}`);
  return sendOdooRfiChangeEmail(message, {
    enabled: config.enabled,
    baseUrl: config.odooBaseUrl,
    database: config.odooDatabase,
    apiKey: config.odooApiKey,
    recipients: config.recipients,
    allowedDomains: config.allowedDomains,
    timeoutMs: config.odooTimeoutMs,
  });
}
