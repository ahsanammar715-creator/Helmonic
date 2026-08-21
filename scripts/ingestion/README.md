# Phase 1A controlled ingestion

This is a one-shot operator path for exactly five approved documents. It is deliberately separate
from the live Next.js runtime identity.

The payload directory is never committed. It contains `payload.json` in the documented example
shape plus an `originals/` directory holding the five source files. An ephemeral Azure Container
Apps Job runs `upload-payload.mjs` with a dedicated user-assigned identity that has only:

- `Storage Blob Data Contributor` on the Phase 1A storage account;
- `Search Service Contributor` to create the named index;
- `Search Index Data Contributor` to load chunks.

The live Container App retains Search read-only access. Service Bus is not part of this Tuesday
path. The script creates the index only when it does not already exist; it does not overwrite or
delete an existing index definition.
