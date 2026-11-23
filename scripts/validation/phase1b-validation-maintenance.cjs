const { ManagedIdentityCredential } = require("@azure/identity");
const { Client } = require("pg");

const ownerObjectId = "c34341a3-7783-44d7-8980-b6ea8111bc06";
const fixtureName = "phase1b-validation.pdf";
const validationStart = "2026-08-26T14:45:00Z";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}-required`);
  return value;
}

function credential() {
  return new ManagedIdentityCredential(required("AZURE_CLIENT_ID"));
}

async function postgresClient() {
  const token = await credential().getToken(
    "https://ossrdbms-aad.database.windows.net/.default",
  );
  const client = new Client({
    host: required("AZURE_POSTGRES_HOST"),
    port: 5432,
    database: required("AZURE_POSTGRES_DATABASE"),
    user: required("BOOTSTRAP_DB_USER"),
    password: token.token,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  return client;
}

async function searchCount() {
  const token = await credential().getToken("https://search.azure.com/.default");
  const response = await fetch(
    `${required("AZURE_SEARCH_ENDPOINT")}/indexes/${required("AZURE_SEARCH_SESSION_INDEX")}/docs/$count?api-version=${required("AZURE_SEARCH_API_VERSION")}`,
    {
      headers: { Authorization: `Bearer ${token.token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`session-search-count-${response.status}`);
  return Number.parseInt(await response.text(), 10);
}

async function audit() {
  const client = await postgresClient();
  try {
    const documents = await client.query(
      `select d.id, d.state, d.blob_container, d.blob_name, d.content_hash,
              j.id as job_id, j.state as job_state
       from consult.documents d
       left join consult.document_versions v on v.document_id = d.id
       left join consult.ingestion_jobs j on j.document_version_id = v.id
       where d.owner_object_id = $1 and d.display_name = $2
         and d.created_at >= $3::timestamptz
       order by d.created_at`,
      [ownerObjectId, fixtureName, validationStart],
    );
    const folders = await client.query(
      `select id, parent_folder_id, name
       from consult.folders
       where owner_object_id = $1 and created_at >= $2::timestamptz
         and name in ('Validation 2026-08-26', 'Child validation')
       order by parent_folder_id nulls first`,
      [ownerObjectId, validationStart],
    );
    const conversations = await client.query(
      `select id, folder_id, title
       from consult.conversations
       where owner_object_id = $1 and created_at >= $2::timestamptz
         and title in ('Phase 1B validation', 'New Consult conversation')
       order by created_at`,
      [ownerObjectId, validationStart],
    );
    return {
      documents: documents.rows,
      folders: folders.rows,
      conversations: conversations.rows,
      sessionSearchDocuments: await searchCount(),
    };
  } finally {
    await client.end();
  }
}

const controlledQueryFillerWords = new Set(
  "a an and are assessed at about did do does evidence for in is me of on please recorded say says tell the to was were what".split(
    " ",
  ),
);

function normalizeControlledSearchQuery(question) {
  const normalized = question
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && !controlledQueryFillerWords.has(word.toLowerCase()))
    .join(" ");
  return normalized || question.trim();
}

function controlledSearchRequest(question) {
  return {
    search: normalizeControlledSearchQuery(question),
    queryType: "simple",
    searchMode: "all",
    searchFields: "title,section,content",
    filter: "permission_scope eq 'iAcoustics'",
    top: 4,
    select: "chunk_id,source_id,source_uri,title,section,page_number,content",
  };
}

async function retrieval() {
  const sourceRef = required("HELMONIC_SOURCE_REF");
  const suiteResponse = await fetch(
    `https://raw.githubusercontent.com/ahsanammar715-creator/Helmonic/${sourceRef}/scripts/evaluation/consult-retrieval.json`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!suiteResponse.ok) throw new Error(`evaluation-suite-${suiteResponse.status}`);
  const suite = await suiteResponse.json();
  const token = await credential().getToken("https://search.azure.com/.default");
  const outcomes = [];
  for (const testCase of suite.cases) {
    const response = await fetch(
      `${required("AZURE_SEARCH_ENDPOINT")}/indexes/${required("AZURE_SEARCH_INDEX")}/docs/search?api-version=${required("AZURE_SEARCH_API_VERSION")}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(controlledSearchRequest(testCase.question)),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const responseBody = await response.text();
    if (!response.ok) {
      outcomes.push({ id: testCase.id, passed: false, status: response.status, error: responseBody });
      continue;
    }
    const payload = JSON.parse(responseBody);
    const results = Array.isArray(payload.value) ? payload.value : [];
    const titles = results.map((result) => String(result.title || ""));
    const passed = testCase.expectedNoEvidence
      ? results.length === 0
      : results.length >= (testCase.minimumCitations || 1) &&
        testCase.expectedTitleIncludes.some((expected) =>
          titles.some((title) => title.toLowerCase().includes(expected.toLowerCase())),
        );
    outcomes.push({ id: testCase.id, passed, resultCount: results.length, titles });
  }
  return { status: outcomes.every((outcome) => outcome.passed) ? "passed" : "failed", outcomes };
}

async function deleteBlob(container, blobName, storageToken) {
  const encodedBlob = blobName.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `https://${required("AZURE_STORAGE_ACCOUNT")}.blob.core.windows.net/${encodeURIComponent(container)}/${encodedBlob}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${storageToken}`,
        "x-ms-date": new Date().toUTCString(),
        "x-ms-version": "2023-11-03",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (![202, 404].includes(response.status)) {
    throw new Error(`blob-delete-${response.status}`);
  }
  return response.status;
}

async function deleteQueuedValidationMessage(targetJobIds) {
  if (targetJobIds.size === 0) return { status: "no-target-job" };
  const token = await credential().getToken("https://servicebus.azure.net/.default");
  const base = `https://${required("AZURE_SERVICE_BUS_NAMESPACE")}/${encodeURIComponent(required("AZURE_SERVICE_BUS_QUEUE"))}`;
  const response = await fetch(`${base}/messages/head?timeout=5`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 204) return { status: "queue-empty" };
  const bodyText = await response.text();
  if (![200, 201].includes(response.status)) {
    throw new Error(`service-bus-receive-${response.status}-${bodyText}`);
  }
  const message = JSON.parse(bodyText);
  if (!targetJobIds.has(message.jobId)) {
    throw new Error("service-bus-head-was-not-validation-message");
  }
  const location = response.headers.get("location");
  if (!location) throw new Error("service-bus-lock-location-missing");
  const deleteResponse = await fetch(new URL(location, base), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (![200, 204].includes(deleteResponse.status)) {
    throw new Error(`service-bus-delete-${deleteResponse.status}`);
  }
  return { status: "deleted", jobId: message.jobId };
}

async function cleanup() {
  const before = await audit();
  const storageToken = await credential().getToken("https://storage.azure.com/.default");
  const blobDeletes = [];
  for (const document of before.documents) {
    blobDeletes.push({
      documentId: document.id,
      status: await deleteBlob(document.blob_container, document.blob_name, storageToken.token),
    });
  }
  const targetJobIds = new Set(before.documents.map((document) => document.job_id).filter(Boolean));
  const queueCleanup = await deleteQueuedValidationMessage(targetJobIds);

  const client = await postgresClient();
  try {
    await client.query("begin");
    await client.query(
      `delete from consult.message_citations where message_id in (
         select id from consult.messages where conversation_id in (
           select id from consult.conversations where owner_object_id = $1
             and created_at >= $2::timestamptz
             and title in ('Phase 1B validation', 'New Consult conversation')))` ,
      [ownerObjectId, validationStart],
    );
    await client.query(
      `delete from consult.messages where conversation_id in (
         select id from consult.conversations where owner_object_id = $1
           and created_at >= $2::timestamptz
           and title in ('Phase 1B validation', 'New Consult conversation'))`,
      [ownerObjectId, validationStart],
    );
    await client.query(
      `delete from consult.ingestion_jobs where document_version_id in (
         select v.id from consult.document_versions v join consult.documents d on d.id = v.document_id
         where d.owner_object_id = $1 and d.display_name = $2 and d.created_at >= $3::timestamptz)`,
      [ownerObjectId, fixtureName, validationStart],
    );
    await client.query(
      `delete from consult.conversation_documents where owner_object_id = $1 and (
         document_id in (select id from consult.documents where owner_object_id = $1 and display_name = $2 and created_at >= $3::timestamptz)
         or conversation_id in (select id from consult.conversations where owner_object_id = $1 and created_at >= $3::timestamptz and title in ('Phase 1B validation', 'New Consult conversation')))`,
      [ownerObjectId, fixtureName, validationStart],
    );
    await client.query(
      `delete from consult.document_versions where document_id in (
         select id from consult.documents where owner_object_id = $1 and display_name = $2 and created_at >= $3::timestamptz)`,
      [ownerObjectId, fixtureName, validationStart],
    );
    await client.query(
      `delete from consult.documents where owner_object_id = $1 and display_name = $2 and created_at >= $3::timestamptz`,
      [ownerObjectId, fixtureName, validationStart],
    );
    await client.query(
      `delete from consult.conversations where owner_object_id = $1 and created_at >= $2::timestamptz
         and title in ('Phase 1B validation', 'New Consult conversation')`,
      [ownerObjectId, validationStart],
    );
    await client.query(
      `delete from consult.folders where owner_object_id = $1 and created_at >= $2::timestamptz
         and name = 'Child validation'`,
      [ownerObjectId, validationStart],
    );
    await client.query(
      `delete from consult.folders where owner_object_id = $1 and created_at >= $2::timestamptz
         and name = 'Validation 2026-08-26'`,
      [ownerObjectId, validationStart],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
  return { before, blobDeletes, queueCleanup, after: await audit() };
}

async function main() {
  const mode = required("VALIDATION_MODE");
  const result = mode === "audit" ? await audit() : mode === "retrieval" ? await retrieval() : mode === "cleanup" ? await cleanup() : null;
  if (!result) throw new Error(`unsupported-validation-mode-${mode}`);
  console.log(JSON.stringify({ mode, result }));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", message: error instanceof Error ? error.message : "validation-maintenance-failed" }));
  process.exitCode = 1;
});
