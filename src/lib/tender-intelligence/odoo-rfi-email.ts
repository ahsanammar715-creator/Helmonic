type OdooRfiEmailConfig = {
  enabled: boolean;
  baseUrl?: string;
  database?: string;
  apiKey?: string;
  recipients?: string;
  allowedDomains?: string;
  timeoutMs?: number;
};

type RfiEmailMessage = {
  runId: string;
  subject: string;
  bodyHtml: string;
};

function configured(config: OdooRfiEmailConfig) {
  if (!config.baseUrl || !config.apiKey) {
    throw new Error("RFI email is enabled but ODOO_BASE_URL or ODOO_API_KEY is missing.");
  }
  return {
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    database: config.database?.trim(),
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs ?? 30_000,
  };
}

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

async function responseError(response: Response) {
  const body = (await response.text()).slice(0, 1_000);
  return `Odoo ${response.status}${body ? `: ${body}` : ""}`;
}

async function json2Call(
  config: ReturnType<typeof configured>,
  model: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `bearer ${config.apiKey}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "Helmonic-Tender-Intelligence/1.0",
  };
  if (config.database) headers["X-Odoo-Database"] = config.database;
  const response = await fetcher(`${config.baseUrl}/json/2/${encodeURIComponent(model)}/${encodeURIComponent(method)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

function createdId(result: unknown) {
  if (Number.isInteger(result) && Number(result) > 0) return Number(result);
  if (Array.isArray(result) && Number.isInteger(result[0]) && Number(result[0]) > 0) return Number(result[0]);
  throw new Error("Odoo RFI email creation returned no usable message ID.");
}

export async function sendRfiChangeEmail(
  message: RfiEmailMessage,
  inputConfig: OdooRfiEmailConfig,
  fetcher: typeof fetch = fetch,
) {
  if (!inputConfig.enabled) return { status: "disabled", runId: message.runId, recipients: [] as string[] };
  const config = configured(inputConfig);
  const recipients = normalizedRecipients(inputConfig.recipients, inputConfig.allowedDomains);
  const messageId = createdId(await json2Call(config, "mail.mail", "create", {
    vals_list: [{
      subject: message.subject,
      body_html: message.bodyHtml,
      email_to: recipients.join(","),
      auto_delete: false,
    }],
  }, fetcher));
  await json2Call(config, "mail.mail", "send", { ids: [messageId] }, fetcher);
  return {
    status: "sent",
    runId: message.runId,
    recipients,
    messageId,
    sentAt: new Date().toISOString(),
  };
}
