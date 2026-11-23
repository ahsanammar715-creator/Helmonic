"""Process one Helmonic Consult attachment from Service Bus and then exit.

The Container Apps event job scales this image from zero. Every execution receives at
most one message, validates the PDF, writes page-aware chunks to the isolated session
index, and records the terminal database state before completing the message.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from typing import Any, Iterable

import pdfplumber
import psycopg
import requests
from azure.identity import ManagedIdentityCredential
from azure.servicebus import AutoLockRenewer, ServiceBusClient
from azure.storage.blob import BlobServiceClient
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError


MAXIMUM_PDF_BYTES = 40 * 1024 * 1024
MAXIMUM_PAGES = 2_000
CHUNK_CHARACTERS = 2_800
CHUNK_OVERLAP = 280


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing-environment:{name}")
    return value


@dataclass(frozen=True)
class Settings:
    client_id: str
    storage_account: str
    service_bus_namespace: str
    service_bus_queue: str
    search_endpoint: str
    search_api_version: str
    postgres_host: str
    postgres_database: str
    postgres_user: str
    postgres_port: int

    @classmethod
    def load(cls) -> "Settings":
        return cls(
            client_id=required("AZURE_CLIENT_ID"),
            storage_account=required("AZURE_STORAGE_ACCOUNT"),
            service_bus_namespace=required("AZURE_SERVICE_BUS_NAMESPACE")
            .removeprefix("https://")
            .removesuffix("/"),
            service_bus_queue=required("AZURE_SERVICE_BUS_QUEUE"),
            search_endpoint=required("AZURE_SEARCH_ENDPOINT").removesuffix("/"),
            search_api_version=os.environ.get("AZURE_SEARCH_API_VERSION", "2025-09-01"),
            postgres_host=required("AZURE_POSTGRES_HOST"),
            postgres_database=required("AZURE_POSTGRES_DATABASE"),
            postgres_user=required("AZURE_POSTGRES_USER"),
            postgres_port=int(os.environ.get("AZURE_POSTGRES_PORT", "5432")),
        )


def message_bytes(message: Any) -> bytes:
    body = message.body
    if isinstance(body, bytes):
        return body
    return b"".join(bytes(part) for part in body)


def validate_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("invalid-message-shape")
    required_fields = (
        "jobId",
        "documentId",
        "documentVersionId",
        "conversationId",
        "ownerObjectId",
        "blobContainer",
        "blobName",
        "sourceUri",
        "contentHash",
        "displayName",
        "targetIndex",
        "correlationId",
    )
    if value.get("version") != 1 or value.get("operation") != "ingest-session-document":
        raise ValueError("unsupported-message-contract")
    for field in required_fields:
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError(f"invalid-message-field:{field}")
    for field in ("jobId", "documentId", "documentVersionId", "conversationId", "correlationId"):
        uuid.UUID(value[field])
    if not value["displayName"].lower().endswith(".pdf"):
        raise ValueError("invalid-file-type")
    value["promoteToKnowledge"] = value.get("promoteToKnowledge") is True
    if value.get("expiresAt") is not None and not isinstance(value["expiresAt"], str):
        raise ValueError("invalid-expiry")
    return value


def database_connection(settings: Settings, credential: ManagedIdentityCredential):
    token = credential.get_token("https://ossrdbms-aad.database.windows.net/.default").token
    return psycopg.connect(
        host=settings.postgres_host,
        dbname=settings.postgres_database,
        user=settings.postgres_user,
        password=token,
        port=settings.postgres_port,
        sslmode="require",
        connect_timeout=8,
        application_name="helmonic-session-ingestion",
    )


def mark_processing(connection: psycopg.Connection[Any], payload: dict[str, Any]) -> bool:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            "select state from consult.documents where id = %s for update",
            (payload["documentId"],),
        )
        current = cursor.fetchone()
        if not current:
            raise ValueError("document-not-found")
        if current[0] in ("ready", "duplicate"):
            return False
        cursor.execute(
            """update consult.documents
               set state = 'processing', updated_at = now()
               where id = %s and state in ('queued', 'stored')""",
            (payload["documentId"],),
        )
        cursor.execute(
            """update consult.ingestion_jobs
               set state = 'processing', attempt_count = attempt_count + 1, updated_at = now()
               where id = %s and state not in ('completed', 'duplicate')""",
            (payload["jobId"],),
        )
        if payload["promoteToKnowledge"]:
            cursor.execute(
                """select id from consult.documents
                   where id <> %s and content_hash = %s
                     and classification = 'session' and expires_at is null
                     and state in ('ready', 'duplicate') and deleted_at is null
                   limit 1""",
                (payload["documentId"], payload["contentHash"]),
            )
            duplicate = cursor.fetchone()
            if duplicate:
                cursor.execute(
                    """update consult.documents
                       set state = 'duplicate', expires_at = null, updated_at = now()
                       where id = %s""",
                    (payload["documentId"],),
                )
                cursor.execute(
                    """update consult.document_versions
                       set index_status = 'duplicate', extraction_version = 'session-pdf-v1'
                       where id = %s""",
                    (payload["documentVersionId"],),
                )
                cursor.execute(
                    """update consult.ingestion_jobs
                       set state = 'duplicate', completed_at = now(), updated_at = now()
                       where id = %s""",
                    (payload["jobId"],),
                )
                return False
    return True


def markdown_table(rows: list[list[str | None]]) -> str:
    clean = [[re.sub(r"\s+", " ", cell or "").strip() for cell in row] for row in rows]
    clean = [row for row in clean if any(row)]
    if not clean:
        return ""
    width = max(len(row) for row in clean)
    padded = [row + [""] * (width - len(row)) for row in clean]
    header = padded[0]
    return "\n".join(
        ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * width) + " |"]
        + ["| " + " | ".join(row) + " |" for row in padded[1:]]
    )


def split_text(text: str) -> Iterable[str]:
    normalized = re.sub(r"[ \t]+", " ", text.replace("\x00", " "))
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + CHUNK_CHARACTERS, len(normalized))
        if end < len(normalized):
            boundary = max(normalized.rfind("\n\n", start, end), normalized.rfind(". ", start, end))
            if boundary > start + CHUNK_CHARACTERS // 2:
                end = boundary + 1
        chunks.append(normalized[start:end].strip())
        if end >= len(normalized):
            break
        start = max(start + 1, end - CHUNK_OVERLAP)
    return [chunk for chunk in chunks if chunk]


def extract_chunks(pdf_bytes: bytes, payload: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    chunks: list[dict[str, Any]] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        if not pdf.pages or len(pdf.pages) > MAXIMUM_PAGES:
            raise ValueError("invalid-page-count")
        for page_number, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text(layout=False) or ""
            units: list[tuple[str, str]] = [(f"Page {page_number}", page_text)]
            for table_number, table in enumerate(page.extract_tables() or [], start=1):
                rendered = markdown_table(table)
                if rendered:
                    units.append((f"Page {page_number} · Table {table_number}", rendered))
            ordinal = 0
            for section, content in units:
                for piece in split_text(content):
                    ordinal += 1
                    chunk_id = hashlib.sha256(
                        f"{payload['documentId']}:{page_number}:{ordinal}:{section}".encode("utf-8")
                    ).hexdigest()
                    chunks.append(
                        {
                            "@search.action": "mergeOrUpload",
                            "chunk_id": chunk_id,
                            "document_id": payload["documentId"],
                            "document_version_id": payload["documentVersionId"],
                            "owner_object_id": payload["ownerObjectId"],
                            "conversation_id": payload["conversationId"],
                            "source_type": (
                                "helmonic_knowledge"
                                if payload["promoteToKnowledge"]
                                else "session_attachment"
                            ),
                            "source_uri": payload["sourceUri"],
                            "title": payload["displayName"],
                            "section": section,
                            "page_number": page_number,
                            "content": piece,
                            "content_hash": hashlib.sha256(piece.encode("utf-8")).hexdigest(),
                            "is_active": True,
                            "expires_at": None if payload["promoteToKnowledge"] else payload.get("expiresAt"),
                        }
                    )
        return chunks, len(pdf.pages)


def index_chunks(
    settings: Settings,
    credential: ManagedIdentityCredential,
    payload: dict[str, Any],
    chunks: list[dict[str, Any]],
) -> None:
    if not chunks:
        raise ValueError("no-extractable-text")
    token = credential.get_token("https://search.azure.com/.default").token
    url = (
        f"{settings.search_endpoint}/indexes/{payload['targetIndex']}/docs/index"
        f"?api-version={settings.search_api_version}"
    )
    for offset in range(0, len(chunks), 100):
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"value": chunks[offset : offset + 100]},
            timeout=30,
        )
        response.raise_for_status()
        results = response.json().get("value", [])
        if len(results) != len(chunks[offset : offset + 100]) or any(
            not result.get("status") for result in results
        ):
            raise RuntimeError("search-index-partial-write")


def mark_ready(
    connection: psycopg.Connection[Any], payload: dict[str, Any], page_count: int
) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """update consult.documents
               set state = 'ready',
                   expires_at = case when %s then null else expires_at end,
                   safe_error_code = null, updated_at = now()
               where id = %s""",
            (payload["promoteToKnowledge"], payload["documentId"]),
        )
        cursor.execute(
            """update consult.document_versions
               set index_status = 'ready', page_count = %s,
                   extraction_version = 'session-pdf-v1', is_active = true
               where id = %s""",
            (page_count, payload["documentVersionId"]),
        )
        cursor.execute(
            """update consult.ingestion_jobs
               set state = 'completed', safe_error_code = null,
                   completed_at = now(), updated_at = now()
               where id = %s""",
            (payload["jobId"],),
        )
        if payload["promoteToKnowledge"]:
            cursor.execute(
                """insert into consult.audit_events
                   (id, owner_object_id, event_type, entity_type, entity_id,
                    correlation_id, safe_details)
                   values (%s, %s, 'knowledge-promotion-completed', 'document', %s, %s, %s)""",
                (
                    str(uuid.uuid4()),
                    payload["ownerObjectId"],
                    payload["documentId"],
                    payload["correlationId"],
                    json.dumps(
                        {
                            "sourceType": "helmonic_knowledge",
                            "contentHashPrefix": payload["contentHash"][:12],
                            "extractionVersion": "session-pdf-v1",
                        }
                    ),
                ),
            )


def mark_failed(
    settings: Settings,
    credential: ManagedIdentityCredential,
    payload: dict[str, Any],
    code: str,
) -> None:
    try:
        with database_connection(settings, credential) as connection:
            with connection.transaction(), connection.cursor() as cursor:
                cursor.execute(
                    """update consult.documents
                       set state = 'failed', safe_error_code = %s,
                           updated_at = now()
                       where id = %s and state not in ('ready', 'duplicate', 'deleted')""",
                    (code, payload["documentId"]),
                )
                cursor.execute(
                    """update consult.ingestion_jobs
                       set state = 'failed', safe_error_code = %s,
                           completed_at = now(), updated_at = now()
                       where id = %s""",
                    (code, payload["jobId"]),
                )
    except Exception as error:  # Preserve the original failure and let Service Bus retry/dead-letter.
        print(json.dumps({"event": "failure-state-write-failed", "type": type(error).__name__}))


def mark_retryable(
    settings: Settings,
    credential: ManagedIdentityCredential,
    payload: dict[str, Any],
) -> None:
    try:
        with database_connection(settings, credential) as connection:
            with connection.transaction(), connection.cursor() as cursor:
                cursor.execute(
                    """update consult.documents
                       set state = 'queued', safe_error_code = null, updated_at = now()
                       where id = %s and state = 'processing'""",
                    (payload["documentId"],),
                )
                cursor.execute(
                    """update consult.ingestion_jobs
                       set state = 'queued', safe_error_code = null, updated_at = now()
                       where id = %s and state = 'processing'""",
                    (payload["jobId"],),
                )
    except Exception as error:
        print(json.dumps({"event": "retry-state-write-failed", "type": type(error).__name__}))


def process(
    settings: Settings,
    credential: ManagedIdentityCredential,
    payload: dict[str, Any],
) -> None:
    with database_connection(settings, credential) as connection:
        if not mark_processing(connection, payload):
            return

        blob_service = BlobServiceClient(
            account_url=f"https://{settings.storage_account}.blob.core.windows.net",
            credential=credential,
        )
        blob = blob_service.get_blob_client(payload["blobContainer"], payload["blobName"])
        properties = blob.get_blob_properties()
        if properties.size < 5 or properties.size > MAXIMUM_PDF_BYTES:
            raise ValueError("invalid-pdf-size")
        pdf_bytes = blob.download_blob(
            offset=0,
            length=MAXIMUM_PDF_BYTES + 1,
            max_concurrency=2,
        ).readall()
        if (
            len(pdf_bytes) < 5
            or len(pdf_bytes) > MAXIMUM_PDF_BYTES
            or not pdf_bytes.startswith(b"%PDF-")
        ):
            raise ValueError("invalid-pdf")
        if hashlib.sha256(pdf_bytes).hexdigest() != payload["contentHash"]:
            raise ValueError("content-hash-mismatch")

        chunks, page_count = extract_chunks(pdf_bytes, payload)
        index_chunks(settings, credential, payload, chunks)
        mark_ready(connection, payload, page_count)


def main() -> int:
    settings = Settings.load()
    credential = ManagedIdentityCredential(client_id=settings.client_id)
    service_bus = ServiceBusClient(
        fully_qualified_namespace=settings.service_bus_namespace,
        credential=credential,
    )
    with AutoLockRenewer(max_lock_renewal_duration=900) as renewer, service_bus:
        with service_bus.get_queue_receiver(
            queue_name=settings.service_bus_queue,
            max_wait_time=10,
            prefetch_count=0,
        ) as receiver:
            messages = receiver.receive_messages(max_message_count=1, max_wait_time=10)
            if not messages:
                print(json.dumps({"event": "no-message"}))
                return 0
            message = messages[0]
            renewer.register(receiver, message, max_lock_renewal_duration=900)
            payload: dict[str, Any] | None = None
            try:
                payload = validate_payload(json.loads(message_bytes(message).decode("utf-8")))
                process(settings, credential, payload)
                receiver.complete_message(message)
                print(json.dumps({"event": "completed", "documentId": payload["documentId"]}))
                return 0
            except (ValueError, json.JSONDecodeError, PDFPasswordIncorrect, PDFSyntaxError) as error:
                if payload:
                    mark_failed(settings, credential, payload, str(error)[:80])
                receiver.dead_letter_message(
                    message,
                    reason="invalid-session-document",
                    error_description=type(error).__name__,
                )
                print(json.dumps({"event": "dead-lettered", "type": type(error).__name__}))
                return 2
            except Exception as error:
                if payload:
                    mark_retryable(settings, credential, payload)
                receiver.abandon_message(message)
                print(json.dumps({"event": "abandoned", "type": type(error).__name__}))
                return 1


if __name__ == "__main__":
    sys.exit(main())
