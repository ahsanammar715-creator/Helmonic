# Phase 1A controlled ingestion (historical five-document path)

This is the committed one-shot operator path for the original five approved Phase 1A
documents. It is deliberately separate from the live Next.js runtime identity.

The live `consult-demo-v1` corpus was subsequently extended to sixteen controlled PDFs
through approved temporary operational ingestion. That later operational extension is
not represented here as a reusable sixteen-document source-to-index workflow. This
script still enforces exactly five documents and therefore cannot, by itself,
reproducibly rebuild the current live corpus.

Do not extend the live corpus with another one-off script or temporary image. Phase 1B
replaces this limitation with the manifest-driven, asynchronous ingestion design in
[`docs/phase1b-consult-design.md`](../../docs/phase1b-consult-design.md).

The payload directory is never committed. It contains `payload.json` in the documented example
shape plus an `originals/` directory holding the five source files. An ephemeral Azure Container
Apps Job runs `upload-payload.mjs` with a dedicated user-assigned identity that has only:

- `Storage Blob Data Contributor` on the Phase 1A storage account;
- `Search Service Contributor` to create the named index;
- `Search Index Data Contributor` to load chunks.

The live Container App retains Search read-only access. Service Bus is not part of this
historical Tuesday path. The script creates the index only when it does not already
exist; it does not overwrite or delete an existing index definition.
