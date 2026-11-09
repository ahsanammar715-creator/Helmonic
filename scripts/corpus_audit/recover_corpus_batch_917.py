from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from collections import Counter
from pathlib import Path
from typing import Any

from build_corpus_pilot_payload import (
    atomic_json,
    available_commit_bytes,
    available_memory_bytes,
    digest,
    process_document,
    read_jsonl,
)


MIB = 1024 * 1024
EXPECTED_ATTEMPTS = 917
EXPECTED_INITIAL_ACCEPTED = 881
EXPECTED_INITIAL_QUARANTINE = 36
EXPECTED_NEW_MEMORY = 27
EXPECTED_REPEAT_MEMORY = 5
EXPECTED_TIMEOUT = 1
EXPECTED_NO_TEXT = 3


def normalized_reason(item: dict[str, Any]) -> str:
    reason = item.get("execution", {}).get("reason", "unknown")
    if reason == "completed" and "No extractable content" in item.get("error", ""):
        return "no_extractable_text"
    return reason


def recovery_identity(
    base_payload_path: Path,
    current_manual_review: list[dict[str, Any]],
    prior_manual_review: list[dict[str, Any]],
) -> str:
    material = {
        "basePayloadHash": digest(base_payload_path),
        "currentManualReview": sorted(item["sourceId"] for item in current_manual_review),
        "priorManualReview": sorted(item["sourceId"] for item in prior_manual_review),
        "policy": {
            "firstMemory": "full-4096MiB-600s",
            "repeatMemory": "bounded_text_tables-4096MiB-600s",
            "timeout": "full-2048MiB-1200s",
            "noText": "not-retried-no-OCR",
        },
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode("utf-8")).hexdigest()


def wait_for_capacity(
    *,
    physical_floor_mib: int,
    commit_floor_mib: int,
    wait_seconds: int,
) -> None:
    started = time.monotonic()
    while True:
        physical = available_memory_bytes() // MIB
        commit = available_commit_bytes() // MIB
        if physical >= physical_floor_mib and commit >= commit_floor_mib:
            return
        if time.monotonic() - started >= wait_seconds:
            raise RuntimeError(
                "Recovery memory gate timed out: "
                f"{physical} MiB physical available/{physical_floor_mib} required, "
                f"{commit} MiB commit available/{commit_floor_mib} required"
            )
        print(
            "Waiting for recovery capacity: "
            f"{physical} MiB physical available/{physical_floor_mib} required, "
            f"{commit} MiB commit available/{commit_floor_mib} required",
            flush=True,
        )
        time.sleep(30)


def load_checkpoint(path: Path, identity: str) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "identity": identity, "documents": {}}
    checkpoint = json.loads(path.read_text(encoding="utf-8"))
    if checkpoint.get("identity") != identity:
        raise RuntimeError("Existing recovery checkpoint does not match this exact recovery scope")
    return checkpoint


def resumable_result(
    record: dict[str, Any] | None,
    result_path: Path,
    originals: Path,
) -> dict[str, Any] | None:
    if not record or record.get("status") != "completed" or not result_path.exists():
        return None
    result = json.loads(result_path.read_text(encoding="utf-8"))
    document = result["document"]
    original = originals / document["fileName"]
    if not original.is_file() or digest(original) != document["sourceHash"]:
        return None
    return result


def validate_scope(
    current_summary: dict[str, Any],
    prior_summary: dict[str, Any],
) -> tuple[list[str], list[str], list[str], list[str]]:
    if current_summary.get("attemptedDocumentCount") != EXPECTED_ATTEMPTS:
        raise RuntimeError("Recovery refuses a base summary other than the exact 917-attempt batch")
    if current_summary.get("documentCount") != EXPECTED_INITIAL_ACCEPTED:
        raise RuntimeError("Recovery expected exactly 881 initially accepted documents")
    current_manual = current_summary.get("manualReview", [])
    if len(current_manual) != EXPECTED_INITIAL_QUARANTINE:
        raise RuntimeError("Recovery expected exactly 36 initial quarantines")

    prior_ids = {item["sourceId"] for item in prior_summary.get("manualReview", [])}
    new_memory: list[str] = []
    repeat_memory: list[str] = []
    timeout: list[str] = []
    no_text: list[str] = []
    for item in current_manual:
        source_id = item["sourceId"]
        reason = normalized_reason(item)
        if reason == "memory_limit":
            if source_id in prior_ids and int(item.get("memoryLimitMiB", 0)) == 4096:
                repeat_memory.append(source_id)
            else:
                new_memory.append(source_id)
        elif reason == "timeout":
            timeout.append(source_id)
        elif reason == "no_extractable_text":
            no_text.append(source_id)
        else:
            raise RuntimeError(f"Unexpected recovery reason for {source_id}: {reason}")

    observed = (
        len(new_memory),
        len(repeat_memory),
        len(timeout),
        len(no_text),
    )
    expected = (
        EXPECTED_NEW_MEMORY,
        EXPECTED_REPEAT_MEMORY,
        EXPECTED_TIMEOUT,
        EXPECTED_NO_TEXT,
    )
    if observed != expected:
        raise RuntimeError(f"Recovery scope drift: observed {observed}, expected {expected}")
    return tuple(sorted(values) for values in (new_memory, repeat_memory, timeout, no_text))


def validate_merged_payload(
    payload: dict[str, Any],
    summary: dict[str, Any],
    originals: Path,
) -> None:
    documents = payload["documents"]
    source_ids = [document["sourceId"] for document in documents]
    if len(source_ids) != len(set(source_ids)):
        raise RuntimeError("Merged recovery payload contains duplicate source IDs")
    chunk_ids = [chunk["chunkId"] for document in documents for chunk in document["chunks"]]
    if len(chunk_ids) != len(set(chunk_ids)):
        raise RuntimeError("Merged recovery payload contains duplicate chunk IDs")
    manual_ids = {item["sourceId"] for item in summary["manualReview"]}
    if manual_ids.intersection(source_ids):
        raise RuntimeError("A source cannot be both accepted and quarantined")
    if len(documents) + len(manual_ids) != EXPECTED_ATTEMPTS:
        raise RuntimeError("Merged recovery totals no longer equal the exact 917 attempts")
    for document in documents:
        original = originals / document["fileName"]
        if not original.is_file() or digest(original) != document["sourceHash"]:
            raise RuntimeError(f"Merged original verification failed for {document['sourceId']}")


def build(args: argparse.Namespace) -> dict[str, Any]:
    base_payload_dir = args.base_payload_dir.resolve()
    base_payload_path = base_payload_dir / "payload.json"
    base_summary_path = base_payload_dir / "summary.json"
    base_originals = base_payload_dir / "originals"
    recovery_output = args.recovery_output.resolve()
    recovery_output.mkdir(parents=True, exist_ok=True)
    (recovery_output / "originals").mkdir(exist_ok=True)
    (recovery_output / "checkpoint-documents").mkdir(exist_ok=True)

    payload = json.loads(base_payload_path.read_text(encoding="utf-8"))
    summary = json.loads(base_summary_path.read_text(encoding="utf-8"))
    prior_summary = json.loads(args.prior_summary.resolve().read_text(encoding="utf-8"))
    new_memory, repeat_memory, timeout, no_text = validate_scope(summary, prior_summary)

    target_ids = new_memory + repeat_memory + timeout
    manifest_rows = read_jsonl(args.manifest.resolve())
    manifest_by_id = {row["source_id"]: row for row in manifest_rows}
    missing_manifest = sorted(set(target_ids) - manifest_by_id.keys())
    if missing_manifest:
        raise RuntimeError(f"Recovery sources absent from manifest: {', '.join(missing_manifest)}")
    missing_originals = [
        source_id for source_id in target_ids if not (base_originals / f"{source_id}.pdf").is_file()
    ]
    if missing_originals:
        raise RuntimeError(
            "Recovery requires the hash-checked staged copies retained by the bounded stop: "
            + ", ".join(missing_originals)
        )

    identity = recovery_identity(
        base_payload_path,
        summary["manualReview"],
        prior_summary.get("manualReview", []),
    )
    checkpoint_path = recovery_output / "checkpoint.json"
    checkpoint = load_checkpoint(checkpoint_path, identity)
    results: dict[str, dict[str, Any]] = {}
    classes = {
        **{source_id: "first_4g_retry" for source_id in new_memory},
        **{source_id: "bounded_low_memory_retry" for source_id in repeat_memory},
        **{source_id: "extended_timeout_retry" for source_id in timeout},
    }
    extraction_modes = {
        "first_4g_retry": "full",
        "bounded_low_memory_retry": "bounded_text_tables",
        "extended_timeout_retry": "full",
    }
    timeouts = {
        "first_4g_retry": 600,
        "bounded_low_memory_retry": 600,
        "extended_timeout_retry": 1200,
    }
    memory_limits = {
        "first_4g_retry": 4096,
        "bounded_low_memory_retry": 4096,
        "extended_timeout_retry": 2048,
    }

    atomic_json(
        recovery_output / "progress.json",
        {
            "status": "running",
            "retryDocuments": len(target_ids),
            "completedDocuments": 0,
            "manualReviewDocuments": 0,
            "pendingDocuments": len(target_ids),
            "noTextNotRetried": len(no_text),
        },
    )
    for ordinal, source_id in enumerate(target_ids, start=1):
        result_path = recovery_output / "checkpoint-documents" / f"{source_id}.result.json"
        result = resumable_result(
            checkpoint["documents"].get(source_id),
            result_path,
            recovery_output / "originals",
        )
        recovery_class = classes[source_id]
        if result is None:
            wait_for_capacity(
                physical_floor_mib=3072,
                commit_floor_mib=5120,
                wait_seconds=args.memory_wait_seconds,
            )
            source = base_originals / f"{source_id}.pdf"
            stat = source.stat()
            row = dict(manifest_by_id[source_id])
            row.update(
                {
                    "relative_path": source.name,
                    "size_bytes": stat.st_size,
                    "modified_ns": stat.st_mtime_ns,
                    "sha256": digest(source),
                }
            )
            result, record = process_document(
                row,
                source_root=base_originals,
                output=recovery_output,
                timeout_seconds=timeouts[recovery_class],
                memory_mib=memory_limits[recovery_class],
                extraction_mode=extraction_modes[recovery_class],
            )
            record["recoveryClass"] = recovery_class
            record["memoryLimitMiB"] = memory_limits[recovery_class]
            record["timeoutSeconds"] = timeouts[recovery_class]
            checkpoint["documents"][source_id] = record
            atomic_json(checkpoint_path, checkpoint)
        if result is not None:
            results[source_id] = result
        completed = sum(
            record.get("status") == "completed"
            for record in checkpoint["documents"].values()
        )
        reviewed = len(checkpoint["documents"]) - completed
        atomic_json(
            recovery_output / "progress.json",
            {
                "status": "running",
                "retryDocuments": len(target_ids),
                "completedDocuments": completed,
                "manualReviewDocuments": reviewed,
                "pendingDocuments": len(target_ids) - len(checkpoint["documents"]),
                "lastSourceId": source_id,
                "noTextNotRetried": len(no_text),
            },
        )
        print(
            f"Recovery {ordinal}/{len(target_ids)}: {source_id} "
            + ("accepted" if source_id in results else "still quarantined"),
            flush=True,
        )

    base_documents = {document["sourceId"]: document for document in payload["documents"]}
    for source_id, result in results.items():
        base_documents[source_id] = result["document"]
    merged_documents = [base_documents[source_id] for source_id in sorted(base_documents)]

    initial_manual = {item["sourceId"]: item for item in summary["manualReview"]}
    final_manual: list[dict[str, Any]] = []
    for source_id, item in initial_manual.items():
        if source_id in results:
            continue
        if source_id in checkpoint["documents"]:
            final_manual.append(
                {
                    "sourceId": source_id,
                    "previousAttempt": item,
                    **checkpoint["documents"][source_id],
                }
            )
        else:
            final_manual.append(item)
    final_manual.sort(key=lambda item: item["sourceId"])

    manifest_by_id.update({row["source_id"]: row for row in manifest_rows})
    accepted_ids = {document["sourceId"] for document in merged_documents}
    totals = Counter()
    for document in merged_documents:
        totals["pages"] += int(document["pageCount"])
        totals["chunks"] += len(document["chunks"])
        totals["tablePages"] += len(document.get("tablePageNumbers", []))

    payload["documents"] = merged_documents
    payload["batch"]["quarantineCount"] = len(final_manual)
    payload["batch"]["recovery"] = {
        "attemptedDocuments": len(target_ids),
        "acceptedDocuments": len(results),
        "remainingQuarantine": len(final_manual),
        "noTextNotRetried": len(no_text),
        "policy": "27 first 4GiB; 5 bounded text-table; 1 extended timeout; no OCR",
    }
    summary.update(
        {
            "documentCount": len(merged_documents),
            "bytes": sum(int(manifest_by_id[source_id]["size_bytes"]) for source_id in accepted_ids),
            "pages": totals["pages"],
            "chunks": totals["chunks"],
            "tablePages": totals["tablePages"],
            "groupCounts": dict(
                sorted(Counter(manifest_by_id[source_id]["top_level"] for source_id in accepted_ids).items())
            ),
            "manualReviewCount": len(final_manual),
            "manualReview": final_manual,
            "verifiedDirectCount": sum(
                document["integrity"]["outcome"] == "verified" for document in merged_documents
            ),
            "repairVerifiedCount": sum(
                document["integrity"]["outcome"] == "repair_verified"
                for document in merged_documents
            ),
            "recovery": payload["batch"]["recovery"],
        }
    )

    validate_merged_payload(payload, summary, base_originals)
    for source_id, result in results.items():
        recovered_original = recovery_output / "originals" / result["document"]["fileName"]
        base_original = base_originals / result["document"]["fileName"]
        if digest(recovered_original) != digest(base_original):
            raise RuntimeError(f"Recovered original differs from retained source for {source_id}")

    for current, backup in (
        (base_payload_path, base_payload_dir / "payload.pre-recovery.json"),
        (base_summary_path, base_payload_dir / "summary.pre-recovery.json"),
    ):
        if not backup.exists():
            shutil.copy2(current, backup)
    atomic_json(base_payload_path, payload)
    atomic_json(base_summary_path, summary)
    atomic_json(
        base_payload_dir / "progress.json",
        {
            "status": "complete_with_quarantine" if final_manual else "complete",
            "selectedDocuments": EXPECTED_ATTEMPTS,
            "completedDocuments": len(merged_documents),
            "manualReviewDocuments": len(final_manual),
            "pendingDocuments": 0,
            "workers": 1,
            "recoveryApplied": True,
        },
    )
    report = {
        "status": "complete",
        "attemptedRecoveryDocuments": len(target_ids),
        "acceptedRecoveryDocuments": len(results),
        "remainingRecoveryFailures": len(target_ids) - len(results),
        "noTextNotRetried": len(no_text),
        "finalAcceptedDocuments": len(merged_documents),
        "finalQuarantineDocuments": len(final_manual),
        "recoveredSourceIds": sorted(results),
        "remainingSourceIds": [item["sourceId"] for item in final_manual],
        "checkpoint": str(checkpoint_path),
    }
    atomic_json(recovery_output / "recovery-report.json", report)
    atomic_json(
        recovery_output / "progress.json",
        {
            "status": "complete",
            "retryDocuments": len(target_ids),
            "completedDocuments": len(results),
            "manualReviewDocuments": len(target_ids) - len(results),
            "pendingDocuments": 0,
            "noTextNotRetried": len(no_text),
            "finalAcceptedDocuments": len(merged_documents),
            "finalQuarantineDocuments": len(final_manual),
        },
    )
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recover bounded failures from corpus batch 917")
    parser.add_argument("--base-payload-dir", type=Path, required=True)
    parser.add_argument("--prior-summary", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--recovery-output", type=Path, required=True)
    parser.add_argument("--memory-wait-seconds", type=int, default=7200)
    return parser.parse_args()


def main() -> int:
    print(json.dumps(build(parse_args()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
