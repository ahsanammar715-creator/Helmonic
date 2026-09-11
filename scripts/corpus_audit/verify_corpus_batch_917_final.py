from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import shutil
from collections import Counter
from pathlib import Path
from typing import Any


EXPECTED_ATTEMPTS = 917
EXPECTED_PRE_RECOVERY = 881
EXPECTED_RECOVERED = 22
EXPECTED_ACCEPTED = 903
EXPECTED_QUARANTINE = 14
EXPECTED_RECOVERY_FAILURES = 11
EXPECTED_NO_TEXT = 3
EXPECTED_MAIN_DIRECT = 703
EXPECTED_MAIN_REPAIR = 178


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def reconcile_checkpoint(
    main_path: Path,
    recovery_checkpoint: dict[str, Any],
    recovered_ids: set[str],
) -> dict[str, Any]:
    checkpoint = read_json(main_path)
    documents = checkpoint.get("documents", {})
    recovery_documents = recovery_checkpoint.get("documents", {})
    require(
        set(recovery_documents) == recovered_ids
        | {source_id for source_id, record in recovery_documents.items() if record.get("status") != "completed"},
        "Recovery checkpoint scope does not cover its own terminal records",
    )
    already_reconciled = (
        sum(record.get("status") == "completed" for record in documents.values())
        == EXPECTED_ACCEPTED
    )
    if already_reconciled:
        return checkpoint

    require(len(documents) == EXPECTED_ATTEMPTS, "Main checkpoint must contain 917 source records")
    require(
        sum(record.get("status") == "completed" for record in documents.values())
        == EXPECTED_PRE_RECOVERY,
        "Unreconciled main checkpoint must contain 881 completed sources",
    )
    backup = main_path.with_name("checkpoint.pre-recovery.json")
    if not backup.exists():
        shutil.copy2(main_path, backup)
    updated = copy.deepcopy(checkpoint)
    for source_id, recovery_record in recovery_documents.items():
        prior = updated["documents"].get(source_id)
        require(prior is not None, f"Recovery source absent from main checkpoint: {source_id}")
        updated["documents"][source_id] = {
            **recovery_record,
            "recoveryApplied": True,
            "previousAttempt": prior,
        }
    updated["recovery"] = {
        "reconciled": True,
        "attemptedDocuments": len(recovery_documents),
        "acceptedDocuments": sum(
            record.get("status") == "completed" for record in recovery_documents.values()
        ),
    }
    atomic_json(main_path, updated)
    return read_json(main_path)


def verify(args: argparse.Namespace) -> dict[str, Any]:
    payload_dir = args.payload_dir.resolve()
    recovery_dir = args.recovery_dir.resolve()
    payload = read_json(payload_dir / "payload.json")
    pre_payload = read_json(payload_dir / "payload.pre-recovery.json")
    summary = read_json(payload_dir / "summary.json")
    pre_summary = read_json(payload_dir / "summary.pre-recovery.json")
    recovery_report = read_json(recovery_dir / "recovery-report.json")
    recovery_checkpoint = read_json(recovery_dir / "checkpoint.json")
    manifest_by_id = {
        row["source_id"]: row
        for row in (
            json.loads(line)
            for line in args.manifest.resolve().read_text(encoding="utf-8").splitlines()
            if line
        )
    }

    pre_ids = [document["sourceId"] for document in pre_payload["documents"]]
    final_ids = [document["sourceId"] for document in payload["documents"]]
    recovered_ids = set(recovery_report["recoveredSourceIds"])
    remaining_ids = set(recovery_report["remainingSourceIds"])
    recovery_records = recovery_checkpoint.get("documents", {})

    require(len(pre_ids) == EXPECTED_PRE_RECOVERY, "Pre-recovery payload is not the exact 881-document base")
    require(len(pre_ids) == len(set(pre_ids)), "Pre-recovery payload contains duplicate source IDs")
    require(pre_summary["verifiedDirectCount"] == EXPECTED_MAIN_DIRECT, "Main direct count is not 703")
    require(pre_summary["repairVerifiedCount"] == EXPECTED_MAIN_REPAIR, "Main repair count is not 178")
    require(len(final_ids) == EXPECTED_ACCEPTED, "Final payload is not exactly 903 documents")
    require(len(final_ids) == len(set(final_ids)), "Final payload contains duplicate source IDs")
    require(not recovered_ids.intersection(pre_ids), "Recovery overlaps an already accepted main-run source")
    require(set(final_ids) - set(pre_ids) == recovered_ids, "Final payload delta is not the exact recovered set")
    require(len(recovered_ids) == EXPECTED_RECOVERED, "Recovery did not add exactly 22 sources")
    require(len(remaining_ids) == EXPECTED_QUARANTINE, "Recovery report does not contain 14 final quarantines")
    require(len(recovery_records) == EXPECTED_RECOVERED + EXPECTED_RECOVERY_FAILURES, "Recovery checkpoint is not 33 attempts")
    require(
        sum(record.get("status") == "completed" for record in recovery_records.values())
        == EXPECTED_RECOVERED,
        "Recovery checkpoint does not contain 22 completed attempts",
    )
    require(
        sum(record.get("status") != "completed" for record in recovery_records.values())
        == EXPECTED_RECOVERY_FAILURES,
        "Recovery checkpoint does not contain 11 failed recovery attempts",
    )

    checkpoint = reconcile_checkpoint(payload_dir / "checkpoint.json", recovery_checkpoint, recovered_ids)
    checkpoint_documents = checkpoint.get("documents", {})
    checkpoint_completed = {
        source_id for source_id, record in checkpoint_documents.items() if record.get("status") == "completed"
    }
    checkpoint_quarantine = set(checkpoint_documents) - checkpoint_completed
    require(len(checkpoint_documents) == EXPECTED_ATTEMPTS, "Final checkpoint is not 917 records")
    require(checkpoint_completed == set(final_ids), "Checkpoint completed set differs from the 903-document payload")
    require(checkpoint_quarantine == remaining_ids, "Checkpoint quarantine set differs from the final 14")

    summary_manual_ids = {item["sourceId"] for item in summary["manualReview"]}
    require(summary["documentCount"] == EXPECTED_ACCEPTED, "Summary accepted count is not 903")
    require(summary["manualReviewCount"] == EXPECTED_QUARANTINE, "Summary quarantine count is not 14")
    require(summary_manual_ids == remaining_ids, "Summary quarantine IDs differ from the recovery report")
    require(not summary_manual_ids.intersection(final_ids), "Accepted and quarantined sets overlap")
    require(set(final_ids) | summary_manual_ids == set(checkpoint_documents), "Final source union is not 917")
    no_text = [
        item
        for item in summary["manualReview"]
        if "No extractable content" in json.dumps(item)
    ]
    require(len(no_text) == EXPECTED_NO_TEXT, "Final quarantine does not contain exactly three no-text sources")

    originals = payload_dir / "originals"
    chunk_ids: set[str] = set()
    calculated = Counter()
    integrity_outcomes = Counter()
    hash_checked = 0
    for document in payload["documents"]:
        source_id = document["sourceId"]
        original = originals / document["fileName"]
        require(original.is_file(), f"Accepted original is missing: {source_id}")
        require(digest(original) == document["sourceHash"], f"Accepted original hash mismatch: {source_id}")
        hash_checked += 1
        integrity = document["integrity"]
        expected_pages = int(document["pageCount"])
        require(expected_pages == int(integrity["expectedPages"]), f"Expected-page mismatch: {source_id}")
        require(integrity["pageCountsMatch"] is True, f"Two-reader page mismatch: {source_id}")
        require(int(integrity["pdfminerPages"]) == expected_pages, f"PDFMiner page mismatch: {source_id}")
        require(int(integrity["pypdfPages"]) == expected_pages, f"pypdf page mismatch: {source_id}")
        require(not integrity.get("pypdfFailures"), f"Unresolved second-reader failure: {source_id}")
        require(document["permissionScope"] == "iAcoustics", f"Permission scope drift: {source_id}")
        manifest_row = manifest_by_id.get(source_id)
        require(manifest_row is not None, f"Accepted source absent from manifest: {source_id}")
        require(
            document["citationNamespace"] == manifest_row.get("citation_namespace", "D"),
            f"Citation namespace drift: {source_id}",
        )
        require(document["chunks"], f"Accepted document has no chunks: {source_id}")
        calculated["bytes"] += original.stat().st_size
        calculated["pages"] += expected_pages
        calculated["chunks"] += len(document["chunks"])
        calculated["tablePages"] += len(document.get("tablePageNumbers", []))
        integrity_outcomes[integrity["outcome"]] += 1
        for chunk in document["chunks"]:
            chunk_id = chunk["chunkId"]
            require(chunk_id not in chunk_ids, f"Duplicate chunk ID: {chunk_id}")
            chunk_ids.add(chunk_id)
            require(chunk["content"].strip(), f"Empty chunk content: {chunk_id}")
            require(
                hashlib.sha256(chunk["content"].encode("utf-8")).hexdigest()
                == chunk["contentHash"],
                f"Chunk content hash mismatch: {chunk_id}",
            )
            require(1 <= int(chunk["pageNumber"]) <= expected_pages, f"Chunk page out of range: {chunk_id}")

    require(calculated["bytes"] == summary["bytes"], "Summary byte total differs from accepted originals")
    require(calculated["pages"] == summary["pages"], "Summary page total differs from payload")
    require(calculated["chunks"] == summary["chunks"], "Summary chunk total differs from payload")
    require(calculated["tablePages"] == summary["tablePages"], "Summary table-page total differs from payload")
    require(integrity_outcomes["verified"] == summary["verifiedDirectCount"], "Direct count mismatch")
    require(integrity_outcomes["repair_verified"] == summary["repairVerifiedCount"], "Repair count mismatch")
    require(sum(integrity_outcomes.values()) == EXPECTED_ACCEPTED, "Unexpected integrity outcome")

    result = {
        "status": "verified",
        "attemptedDocuments": EXPECTED_ATTEMPTS,
        "mainAcceptedDocuments": EXPECTED_PRE_RECOVERY,
        "recoveredDocuments": EXPECTED_RECOVERED,
        "acceptedDocuments": EXPECTED_ACCEPTED,
        "quarantinedDocuments": EXPECTED_QUARANTINE,
        "recoveryFailures": EXPECTED_RECOVERY_FAILURES,
        "noTextDocuments": EXPECTED_NO_TEXT,
        "directVerifiedDocuments": integrity_outcomes["verified"],
        "repairVerifiedDocuments": integrity_outcomes["repair_verified"],
        "sourceHashesVerified": hash_checked,
        "chunksVerified": len(chunk_ids),
        "pagesVerified": calculated["pages"],
        "bytesVerified": calculated["bytes"],
        "duplicateMainRecoverySourceIds": 0,
        "duplicateFinalSourceIds": 0,
        "duplicateChunkIds": 0,
        "checkpointCompletedDocuments": len(checkpoint_completed),
        "checkpointQuarantinedDocuments": len(checkpoint_quarantine),
        "azureCalls": 0,
    }
    atomic_json(args.output.resolve(), result)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reconcile and independently verify corpus batch 917")
    parser.add_argument("--payload-dir", type=Path, required=True)
    parser.add_argument("--recovery-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    print(json.dumps(verify(parse_args()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
