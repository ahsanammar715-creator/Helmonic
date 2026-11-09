import "server-only";

import type {
  ConsultConversationSummary,
  ConsultFolder,
} from "@/lib/consult/organization";
import type { RuntimeConfig } from "@/lib/server/config";
import { withPostgresClient } from "@/lib/server/postgres";

export class ConsultRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "not-found" | "conflict" | "invalid-parent",
  ) {
    super(message);
    this.name = "ConsultRepositoryError";
  }
}

export type CreateSessionUploadInput = {
  documentId: string;
  versionId: string;
  jobId: string;
  conversationId: string;
  ownerObjectId: string;
  displayName: string;
  blobContainer: string;
  blobName: string;
  indexName: string;
  sizeBytes: number;
  expiresAt: Date;
  correlationId: string;
};

export async function createSessionUpload(
  config: RuntimeConfig,
  input: CreateSessionUploadInput,
) {
  await withPostgresClient(config, "helmonic-consult-upload", async (client) => {
    await client.query("begin");
    try {
      const conversation = await client.query(
        `select id from consult.conversations
         where id = $1 and owner_object_id = $2 and deleted_at is null
         for update`,
        [input.conversationId, input.ownerObjectId],
      );
      if (conversation.rowCount !== 1) {
        throw new ConsultRepositoryError("Conversation not found", "not-found");
      }

      await client.query(
        `insert into consult.documents
          (id, owner_object_id, classification, display_name, state, blob_container,
           blob_name, size_bytes, expires_at)
         values ($1, $2, 'session', $3, 'uploading', $4, $5, $6, $7)`,
        [
          input.documentId,
          input.ownerObjectId,
          input.displayName,
          input.blobContainer,
          input.blobName,
          input.sizeBytes,
          input.expiresAt,
        ],
      );
      await client.query(
        `insert into consult.document_versions
          (id, document_id, version_number, index_name, index_status)
         values ($1, $2, 1, $3, 'pending')`,
        [input.versionId, input.documentId, input.indexName],
      );
      await client.query(
        `insert into consult.conversation_documents
          (conversation_id, document_id, owner_object_id)
         values ($1, $2, $3)`,
        [input.conversationId, input.documentId, input.ownerObjectId],
      );
      await client.query(
        `insert into consult.ingestion_jobs
          (id, document_version_id, operation, state, correlation_id)
         values ($1, $2, 'ingest', 'created', $3)`,
        [input.jobId, input.versionId, input.correlationId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function markSessionUploadStored(
  config: RuntimeConfig,
  documentId: string,
  jobId: string,
  contentHash: string,
) {
  await withPostgresClient(config, "helmonic-consult-upload", async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `update consult.documents
         set state = 'stored', content_hash = $2, updated_at = now()
         where id = $1 and state = 'uploading'`,
        [documentId, contentHash],
      );
      await client.query(
        `update consult.ingestion_jobs set state = 'stored', updated_at = now()
         where id = $1`,
        [jobId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function markSessionUploadQueued(
  config: RuntimeConfig,
  documentId: string,
  jobId: string,
) {
  await withPostgresClient(config, "helmonic-consult-upload", async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `update consult.documents set state = 'queued', updated_at = now()
         where id = $1 and state = 'stored'`,
        [documentId],
      );
      await client.query(
        `update consult.ingestion_jobs set state = 'queued', updated_at = now()
         where id = $1`,
        [jobId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function markSessionUploadFailed(
  config: RuntimeConfig,
  documentId: string,
  jobId: string,
  safeErrorCode: string,
) {
  await withPostgresClient(config, "helmonic-consult-upload", async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `update consult.documents
         set state = 'failed', safe_error_code = $2, updated_at = now()
         where id = $1 and state not in ('ready', 'deleted')`,
        [documentId, safeErrorCode],
      );
      await client.query(
        `update consult.ingestion_jobs
         set state = 'failed', safe_error_code = $2, updated_at = now(), completed_at = now()
         where id = $1`,
        [jobId, safeErrorCode],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function listConsultFolders(config: RuntimeConfig, ownerObjectId: string) {
  return withPostgresClient(config, "helmonic-consult-folders", async (client) => {
    const result = await client.query(
      `select id, parent_folder_id, name, sort_order
       from consult.folders
       where owner_object_id = $1 and deleted_at is null
       order by sort_order, lower(name), id`,
      [ownerObjectId],
    );
    return result.rows.map<ConsultFolder>((row) => ({
      id: String(row.id),
      parentFolderId: row.parent_folder_id ? String(row.parent_folder_id) : null,
      name: String(row.name),
      sortOrder: Number(row.sort_order),
    }));
  });
}

export async function createConsultFolder(
  config: RuntimeConfig,
  input: {
    id: string;
    ownerObjectId: string;
    parentFolderId: string | null;
    name: string;
  },
) {
  return withPostgresClient(config, "helmonic-consult-folders", async (client) => {
    if (input.parentFolderId) {
      const parent = await client.query(
        `with recursive ancestors as (
           select id, parent_folder_id, 1 as depth
           from consult.folders
           where id = $1 and owner_object_id = $2 and deleted_at is null
           union all
           select folder.id, folder.parent_folder_id, ancestors.depth + 1
           from consult.folders folder
           join ancestors on folder.id = ancestors.parent_folder_id
           where folder.owner_object_id = $2 and folder.deleted_at is null
         )
         select coalesce(max(depth), 0) as depth from ancestors`,
        [input.parentFolderId, input.ownerObjectId],
      );
      const depth = Number(parent.rows[0]?.depth ?? 0);
      if (depth === 0 || depth >= 5) {
        throw new ConsultRepositoryError("Invalid parent folder", "invalid-parent");
      }
    }

    try {
      await client.query(
        `insert into consult.folders
          (id, owner_object_id, parent_folder_id, name, sort_order)
         values ($1, $2, $3, $4,
           coalesce((select max(sort_order) + 1 from consult.folders
             where owner_object_id = $2 and parent_folder_id is not distinct from $3
               and deleted_at is null), 0))`,
        [input.id, input.ownerObjectId, input.parentFolderId, input.name],
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new ConsultRepositoryError("Folder already exists", "conflict");
      }
      throw error;
    }

    return {
      id: input.id,
      parentFolderId: input.parentFolderId,
      name: input.name,
      sortOrder: 0,
    } satisfies ConsultFolder;
  });
}

export async function updateConsultFolder(
  config: RuntimeConfig,
  input: { id: string; ownerObjectId: string; name: string },
) {
  return withPostgresClient(config, "helmonic-consult-folders", async (client) => {
    try {
      const result = await client.query(
        `update consult.folders set name = $3, updated_at = now()
         where id = $1 and owner_object_id = $2 and deleted_at is null
         returning id, parent_folder_id, name, sort_order`,
        [input.id, input.ownerObjectId, input.name],
      );
      if (result.rowCount !== 1) {
        throw new ConsultRepositoryError("Folder not found", "not-found");
      }
      const row = result.rows[0];
      return {
        id: String(row.id),
        parentFolderId: row.parent_folder_id ? String(row.parent_folder_id) : null,
        name: String(row.name),
        sortOrder: Number(row.sort_order),
      } satisfies ConsultFolder;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new ConsultRepositoryError("Folder already exists", "conflict");
      }
      throw error;
    }
  });
}

export async function listConsultConversations(
  config: RuntimeConfig,
  ownerObjectId: string,
) {
  return withPostgresClient(config, "helmonic-consult-conversations", async (client) => {
    const result = await client.query(
      `select id, folder_id, title, updated_at
       from consult.conversations
       where owner_object_id = $1 and deleted_at is null
       order by updated_at desc, id`,
      [ownerObjectId],
    );
    return result.rows.map<ConsultConversationSummary>((row) => ({
      id: String(row.id),
      folderId: row.folder_id ? String(row.folder_id) : null,
      title: String(row.title),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  });
}

export async function createConsultConversation(
  config: RuntimeConfig,
  input: {
    id: string;
    ownerObjectId: string;
    folderId: string | null;
    title: string;
  },
) {
  return withPostgresClient(config, "helmonic-consult-conversations", async (client) => {
    if (input.folderId) {
      const folder = await client.query(
        `select id from consult.folders
         where id = $1 and owner_object_id = $2 and deleted_at is null`,
        [input.folderId, input.ownerObjectId],
      );
      if (folder.rowCount !== 1) {
        throw new ConsultRepositoryError("Folder not found", "invalid-parent");
      }
    }

    await client.query(
      `insert into consult.conversations
        (id, owner_object_id, folder_id, workspace, title)
       values ($1, $2, $3, 'consult', $4)`,
      [input.id, input.ownerObjectId, input.folderId, input.title],
    );
    return {
      id: input.id,
      folderId: input.folderId,
      title: input.title,
      updatedAt: new Date().toISOString(),
    } satisfies ConsultConversationSummary;
  });
}
