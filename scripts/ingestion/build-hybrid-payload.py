"""Build the approved hybrid-ingestion payload from the private v1 corpus.

This script runs only inside the VNet-integrated ingestion job. It uses the job's
user-assigned managed identity to read the rollback Search manifest and approved
Blob originals. Tables detected on a page are rendered as one atomic Markdown
chunk while retaining the v1 chunk/source/title/page identifiers for parity.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote, urlparse

import pdfplumber
import requests
from azure.identity import ManagedIdentityCredential
from azure.storage.blob import BlobClient


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable {name}")
    return value


SEARCH_ENDPOINT = required("AZURE_SEARCH_ENDPOINT").rstrip("/")
SEARCH_INDEX = os.environ.get("AZURE_SEARCH_ROLLBACK_INDEX", "consult-demo-v1")
SEARCH_API_VERSION = os.environ.get("AZURE_SEARCH_API_VERSION", "2025-09-01")
STORAGE_CONTAINER = os.environ.get("AZURE_STORAGE_CONTAINER", "consult-sources")
PAYLOAD_ROOT = Path(os.environ.get("HELMONIC_INGESTION_PAYLOAD", "/payload"))
EXPECTED_DOCUMENTS = int(
    os.environ.get("HELMONIC_INGESTION_EXPECTED_DOCUMENT_COUNT", "16")
)
PERMISSION_SCOPE = required("HELMONIC_PERMISSION_SCOPE")


def normalized_cell(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text.replace("|", "\\|")


def useful_table(table: list[list[object]]) -> bool:
    populated_rows = [row for row in table if any(normalized_cell(cell) for cell in row)]
    widest = max((sum(bool(normalized_cell(cell)) for cell in row) for row in populated_rows), default=0)
    return len(populated_rows) >= 2 and widest >= 2


def table_markdown(table: list[list[object]], ordinal: int) -> str:
    width = max(len(row) for row in table)
    rows = [list(row) + [""] * (width - len(row)) for row in table]
    header = [normalized_cell(cell) or f"Column {index + 1}" for index, cell in enumerate(rows[0])]
    body = [[normalized_cell(cell) for cell in row] for row in rows[1:]]
    lines = [
        f"Table {ordinal}",
        f"| {' | '.join(header)} |",
        f"| {' | '.join('---' for _ in header)} |",
    ]
    lines.extend(f"| {' | '.join(row)} |" for row in body)
    return "\n".join(lines)


def page_tables(pdf_path: Path, page_numbers: set[int]) -> dict[int, str]:
    structured: dict[int, str] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page_number in sorted(page_numbers):
            if page_number < 1 or page_number > len(pdf.pages):
                continue
            tables = [table for table in (pdf.pages[page_number - 1].extract_tables() or []) if useful_table(table)]
            if tables:
                structured[page_number] = "\n\n".join(
                    table_markdown(table, index + 1) for index, table in enumerate(tables)
                )
    return structured


def blob_name_from_uri(source_uri: str) -> str:
    path = unquote(urlparse(source_uri).path).lstrip("/")
    prefix = f"{STORAGE_CONTAINER}/"
    if not path.startswith(prefix):
        raise RuntimeError("Source URI does not target the approved controlled-source container")
    return path[len(prefix) :]


def read_manifest(credential: ManagedIdentityCredential) -> list[dict]:
    token = credential.get_token("https://search.azure.com/.default").token
    response = requests.post(
        f"{SEARCH_ENDPOINT}/indexes/{SEARCH_INDEX}/docs/search",
        params={"api-version": SEARCH_API_VERSION},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "search": "*",
            "top": 1000,
            "select": "chunk_id,source_id,source_uri,title,section,page_number,content",
        },
        timeout=60,
    )
    if not response.ok:
        raise RuntimeError(
            f"Rollback index manifest failed with status {response.status_code}: "
            f"{response.text[:500]}"
        )
    values = response.json().get("value", [])
    if not values:
        raise RuntimeError(f"Rollback index {SEARCH_INDEX} returned no controlled chunks")
    return values


def main() -> None:
    client_id = required("AZURE_CLIENT_ID")
    credential = ManagedIdentityCredential(client_id=client_id)
    manifest = read_manifest(credential)
    grouped: dict[str, list[dict]] = defaultdict(list)
    for chunk in manifest:
        grouped[chunk["source_id"]].append(chunk)
    if len(grouped) != EXPECTED_DOCUMENTS:
        raise RuntimeError(
            f"Expected {EXPECTED_DOCUMENTS} controlled sources, found {len(grouped)}"
        )

    originals = PAYLOAD_ROOT / "originals"
    originals.mkdir(parents=True, exist_ok=True)
    documents: list[dict] = []

    for source_id, chunks in sorted(grouped.items()):
        chunks.sort(key=lambda item: (item.get("page_number") or 0, item["chunk_id"]))
        first = chunks[0]
        blob_name = blob_name_from_uri(first["source_uri"])
        file_name = Path(blob_name).name
        local_pdf = originals / file_name
        with local_pdf.open("wb") as target:
            BlobClient.from_blob_url(
                first["source_uri"], credential=credential
            ).download_blob().readinto(target)

        candidate_pages = {
            int(chunk["page_number"])
            for chunk in chunks
            if isinstance(chunk.get("page_number"), int)
        }
        structured_tables = page_tables(local_pdf, candidate_pages)
        used_table_pages: set[int] = set()
        payload_chunks: list[dict] = []
        for chunk in chunks:
            page_number = chunk.get("page_number")
            content = chunk.get("content", "")
            kind = "text"
            content_format = "plain_text"
            atomic = False
            if page_number in structured_tables and page_number not in used_table_pages:
                narrative = content.strip()
                table_content = structured_tables[page_number]
                content = f"{narrative}\n\n{table_content}" if narrative else table_content
                kind = "table"
                content_format = "markdown"
                atomic = True
                used_table_pages.add(page_number)
            payload_chunks.append(
                {
                    "chunkId": chunk["chunk_id"],
                    "section": chunk.get("section") or "",
                    "pageNumber": page_number,
                    "content": content,
                    "contentHash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                    "kind": kind,
                    "contentFormat": content_format,
                    "atomic": atomic,
                }
            )

        documents.append(
            {
                "sourceId": source_id,
                "title": first["title"],
                "fileName": file_name,
                "permissionScope": PERMISSION_SCOPE,
                "tablePageNumbers": sorted(used_table_pages),
                "chunks": payload_chunks,
            }
        )

    payload = {
        "extraction": {
            "version": 2,
            "tableStrategy": "atomic-markdown-or-key-value",
        },
        "documents": documents,
    }
    (PAYLOAD_ROOT / "payload.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "status": "payload-built",
                "documents": len(documents),
                "chunks": len(manifest),
                "tablePages": sum(len(item["tablePageNumbers"]) for item in documents),
            }
        )
    )


if __name__ == "__main__":
    main()
