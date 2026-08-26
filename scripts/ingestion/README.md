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
