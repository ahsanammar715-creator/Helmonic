import { readFile } from "node:fs/promises";
import { ManagedIdentityCredential } from "@azure/identity";

const endpoint = required("AZURE_SEARCH_ENDPOINT").replace(/\/$/, "");
const indexName = required("AZURE_SEARCH_INDEX");
const liveIndex = required("HELMONIC_LIVE_SEARCH_INDEX");
const schemaPath = process.env.HELMONIC_INDEX_SCHEMA ||
  "scripts/ingestion/index-schema-corpus-batch-917-v1.json";
const apiVersion = process.env.AZURE_SEARCH_API_VERSION || "2024-07-01";

if (!indexName.startsWith("consult-candidate-")) {
  throw new Error(`Refusing to create a non-candidate index: ${indexName}`);
}
if (indexName === liveIndex || indexName === "consult-demo-v1" || indexName === "consult-demo-v2") {
  throw new Error(`Refusing to create or modify a protected live index: ${indexName}`);
}

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
if (schema.name !== indexName) {
  throw new Error(`Schema name ${schema.name} does not match target index ${indexName}`);
}

const credential = new ManagedIdentityCredential();
const token = await credential.getToken("https://search.azure.com/.default");
const headers = {
  Authorization: `Bearer ${token.token}`,
  "Content-Type": "application/json",
};

const existing = await fetch(
  `${endpoint}/indexes/${encodeURIComponent(indexName)}?api-version=${apiVersion}`,
  { headers },
);
if (existing.status !== 404) {
  throw new Error(
    existing.ok
      ? `Candidate index already exists; refusing to overwrite: ${indexName}`
      : `Candidate preflight failed (${existing.status}): ${await existing.text()}`,
  );
}

const created = await fetch(`${endpoint}/indexes?api-version=${apiVersion}`, {
  method: "POST",
  headers,
  body: JSON.stringify(schema),
});
if (!created.ok) {
  throw new Error(`Candidate index creation failed (${created.status}): ${await created.text()}`);
}

const actual = await created.json();
const vectorField = actual.fields?.find((field) => field.name === "content_vector");
const citationField = actual.fields?.find((field) => field.name === "citation_namespace");
if (actual.name !== indexName || vectorField?.dimensions !== 1536 || !citationField) {
  throw new Error("Created candidate index failed schema verification");
}

console.log(JSON.stringify({
  status: "created-and-verified",
  index: actual.name,
  dimensions: vectorField.dimensions,
  citationNamespaceField: true,
  liveIndex,
  liveIndexTouched: false,
}, null, 2));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
