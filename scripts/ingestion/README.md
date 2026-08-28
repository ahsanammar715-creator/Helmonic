# Phase 1A controlled ingestion (reproducible 16-document path)

This is the committed one-shot operator path for the current sixteen approved Phase 1A
documents. It is deliberately separate from the live Next.js runtime identity.

The script fails closed unless the payload contains exactly sixteen source documents,
so the current corpus can be reproduced from an approved manifest. For a deliberately
different approved corpus size, set `HELMONIC_INGESTION_EXPECTED_DOCUMENT_COUNT` to that
exact positive integer; changing the value does not itself authorize ingestion.

Do not extend the live corpus with another one-off script or temporary image. Phase 1B
replaces this limitation with the manifest-driven, asynchronous ingestion design in
[`docs/phase1b-consult-design.md`](../../docs/phase1b-consult-design.md).

The payload directory is never committed. It contains `payload.json` in the documented example
shape plus an `originals/` directory holding the sixteen source files. An ephemeral Azure Container
Apps Job runs `upload-payload.mjs` with a dedicated user-assigned identity that has only:

- `Storage Blob Data Contributor` on the Phase 1A storage account;
- `Search Service Contributor` to create the named index;
- `Search Index Data Contributor` to load chunks.

The live Container App retains Search read-only access. Service Bus is not part of this
historical Tuesday path. The script creates the index only when it does not already
exist; it does not overwrite or delete an existing index definition.

The one-document example payload is for shape validation only. Never point that example
at the live index.

## Versioned hybrid re-index path

The hybrid path is opt-in and must target `consult-demo-v2`; `consult-demo-v1` remains
untouched as the rollback index. Set all of the following only in an approved private
ingestion job:

- `HELMONIC_HYBRID_INGESTION_ENABLED=true`;
- `AZURE_SEARCH_INDEX=consult-demo-v2`;
- `AZURE_SEARCH_ROLLBACK_INDEX=consult-demo-v1`;
- `HELMONIC_INDEX_SCHEMA=scripts/ingestion/index-schema-v2.json`;
- `HELMONIC_PERMISSION_SCOPE=iAcoustics` (explicit because the live v1 field is intentionally non-retrievable);
- the approved managed-identity embedding endpoint, deployment, API version, and
  1,536 dimensions.

The v2 path fails before index creation unless the approved payload declares extraction
version 2 and the `atomic-markdown-or-key-value` table strategy. Every document declares
its `tablePageNumbers`; each listed page must contain an atomic `table` chunk represented
as Markdown or explicit key/value content. This makes table preservation an auditable
manifest contract instead of silently flattening frequency or compliance tables.

Before creating v2, the script embeds every chunk and rejects any missing, malformed, or
wrong-dimension vector. Transient model throttling is retried only when Azure returns 429,
using the service's `Retry-After` value with a bounded eight-attempt ceiling. It then
compares the approved manifest with the live v1 chunk,
source, title, and page metadata. After upload it repeats that parity check against v2.
The target is not ready for evaluation or cutover unless both checks pass.

`build-hybrid-payload.py` is the reproducible private-job payload builder used for the
v2 validation. It reads only retrievable fields from the live v1 manifest, takes the
permission scope from the explicit job contract, and reads the existing controlled Blob originals
with the job identity, preserves detected PDF tables as atomic Markdown, and retains the
v1 identifiers/page metadata so the uploader can enforce parity. `Dockerfile.hybrid`
packages that builder with the managed-identity uploader. The image and job are temporary;
the source remains committed so a future approved re-index is reproducible.
