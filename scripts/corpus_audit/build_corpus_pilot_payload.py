from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import subprocess
import sys
import time
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any, Iterable

BATCH_ID = "corpus-pilot-100-v1"
PERMISSION_SCOPE = "iAcoustics"
DEFAULT_DOCUMENT_TIMEOUT_SECONDS = 600
DEFAULT_DOCUMENT_MEMORY_MIB = 2_048
DEFAULT_WORKERS = 1
DEFAULT_FREE_MEMORY_RESERVE_MIB = 2_048
GROUP_QUOTAS = {
    "IA-02.2": 40,
    "IA-13": 15,
    "IA-04": 10,
    "IOA Bulletin": 10,
    "Third Party Acoustic Reports": 10,
    "IA-02.1": 10,
    "IA-08": 2,
    "IA-12": 1,
    "IA-14": 2,
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def eligible(row: dict[str, Any]) -> bool:
    return (
        row.get("search_state") == "candidate"
        and row.get("is_canonical") is True
        and row.get("processing_lane") == "pdf_extract_embed"
        and row.get("extension") == ".pdf"
        and row.get("integrity_status") == "ok"
        and row.get("ocr_status") == "text_extractable"
    )


def stable_selection_key(row: dict[str, Any], batch_id: str = BATCH_ID) -> tuple[str, str]:
    material = f"{batch_id}\0{row['source_id']}\0{row.get('sha256') or 'capture-hash-required'}".encode("utf-8")
    return hashlib.sha256(material).hexdigest(), row["source_id"]


def balanced_quotas(candidates: list[dict[str, Any]], document_count: int) -> dict[str, int]:
    available = Counter(row["top_level"] for row in candidates)
    if document_count < 1 or document_count > sum(available.values()):
        raise RuntimeError(
            f"Requested {document_count} documents but only {sum(available.values())} are eligible"
        )
    exact = {
        group: document_count * count / sum(available.values())
        for group, count in available.items()
    }
    quotas = {group: min(available[group], int(value)) for group, value in exact.items()}
    remaining = document_count - sum(quotas.values())
    order = sorted(
        available,
        key=lambda group: (-(exact[group] - int(exact[group])), group.casefold()),
    )
    while remaining:
        progressed = False
        for group in order:
            if quotas[group] < available[group]:
                quotas[group] += 1
                remaining -= 1
                progressed = True
                if remaining == 0:
                    break
        if not progressed:
            raise RuntimeError("Could not allocate the requested balanced document count")
    return quotas


def select_rows(
    rows: Iterable[dict[str, Any]],
    *,
    batch_id: str = BATCH_ID,
    document_count: int = 100,
    excluded_source_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    excluded = excluded_source_ids or set()
    candidates = [
        row for row in rows if eligible(row) and row.get("source_id") not in excluded
    ]
    if batch_id == BATCH_ID and document_count == 100 and not excluded:
        quotas = GROUP_QUOTAS
    else:
        quotas = balanced_quotas(candidates, document_count)
    selected: list[dict[str, Any]] = []
    for group, quota in quotas.items():
        group_rows = sorted(
            (row for row in candidates if row["top_level"] == group),
            key=lambda row: stable_selection_key(row, batch_id),
        )
        if len(group_rows) < quota:
            raise RuntimeError(f"{group} has {len(group_rows)} eligible PDFs; {quota} required")
        selected.extend(group_rows[:quota])
    if len(selected) != document_count or len({row["source_id"] for row in selected}) != document_count:
        raise RuntimeError(
            f"The corpus batch selection must contain exactly {document_count} unique sources"
        )
    return sorted(selected, key=lambda row: row["source_id"])


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def process_memory_bytes(process_id: int) -> int:
    if os.name == "nt":
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        process = ctypes.windll.kernel32.OpenProcess(0x0400 | 0x0010, False, process_id)
        if not process:
            return 0
        try:
            counters = ProcessMemoryCounters()
            counters.cb = ctypes.sizeof(counters)
            if ctypes.windll.psapi.GetProcessMemoryInfo(
                process, ctypes.byref(counters), counters.cb
            ):
                return int(counters.WorkingSetSize)
            return 0
        finally:
            ctypes.windll.kernel32.CloseHandle(process)
    status = Path(f"/proc/{process_id}/status")
    if status.exists():
        for line in status.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    return 0


def available_memory_bytes() -> int:
    if os.name == "nt":
        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(status)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            raise RuntimeError("System free-memory check is unavailable")
        return int(status.ullAvailPhys)
    page_size = os.sysconf("SC_PAGE_SIZE")
    available_pages = os.sysconf("SC_AVPHYS_PAGES")
    return int(page_size * available_pages)


def run_limited_process(
    command: list[str],
    *,
    timeout_seconds: float,
    memory_bytes: int,
    stdout_path: Path,
    stderr_path: Path,
) -> dict[str, Any]:
    started = time.monotonic()
    peak_memory = 0
    memory_measurement_seen = False
    reason = "completed"
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        process = subprocess.Popen(command, stdout=stdout, stderr=stderr)
        while process.poll() is None:
            elapsed = time.monotonic() - started
            current_memory = process_memory_bytes(process.pid)
            memory_measurement_seen = memory_measurement_seen or current_memory > 0
            peak_memory = max(peak_memory, current_memory)
            if current_memory > memory_bytes:
                reason = "memory_limit"
                process.kill()
                break
            if elapsed > 5 and not memory_measurement_seen:
                reason = "memory_monitor_unavailable"
                process.kill()
                break
            if elapsed > timeout_seconds:
                reason = "timeout"
                process.kill()
                break
            time.sleep(0.1)
        return_code = process.wait()
    return {
        "returnCode": return_code,
        "reason": reason,
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "peakMemoryBytes": peak_memory,
    }


def checkpoint_identity(selected: list[dict[str, Any]], manifest: Path, batch_id: str = BATCH_ID) -> str:
    material = {
        "batchId": batch_id,
        "manifestHash": digest(manifest),
        "sourceIds": [row["source_id"] for row in selected],
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode("utf-8")).hexdigest()


def load_checkpoint(path: Path, identity: str, limits: dict[str, int]) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "identity": identity, "limits": limits, "documents": {}}
    checkpoint = json.loads(path.read_text(encoding="utf-8"))
    if checkpoint.get("identity") != identity or checkpoint.get("limits") != limits:
        raise RuntimeError("Existing checkpoint does not match the selected sources or processing limits")
    return checkpoint


def load_resumable_result(
    existing: dict[str, Any] | None, result_path: Path, originals: Path
) -> dict[str, Any] | None:
    if not existing or existing.get("status") != "completed" or not result_path.exists():
        return None
    candidate = json.loads(result_path.read_text(encoding="utf-8"))
    staged = originals / candidate["document"]["fileName"]
    if not staged.is_file() or digest(staged) != candidate["document"]["sourceHash"]:
        return None
    return candidate


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def process_document(
    row: dict[str, Any],
    *,
    source_root: Path,
    output: Path,
    timeout_seconds: int,
    memory_mib: int,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    work = output / "checkpoint-documents"
    source_id = row["source_id"]
    request_path = work / f"{source_id}.request.json"
    result_path = work / f"{source_id}.result.json"
    stdout_path = work / f"{source_id}.stdout.log"
    stderr_path = work / f"{source_id}.stderr.log"
    request = {
        "row": row,
        "sourceRoot": str(source_root),
        "originals": str(output / "originals"),
        "resultPath": str(result_path),
    }
    atomic_json(request_path, request)
    worker = Path(__file__).with_name("corpus_document_worker.py")
    execution = run_limited_process(
        [sys.executable, str(worker), "--request", str(request_path)],
        timeout_seconds=timeout_seconds,
        memory_bytes=memory_mib * 1024 * 1024,
        stdout_path=stdout_path,
        stderr_path=stderr_path,
    )
    status = "completed" if execution["returnCode"] == 0 and result_path.exists() else "manual_review"
    record = {"status": status, "execution": execution, "resultFile": result_path.name}
    if status != "completed":
        error = stderr_path.read_text(encoding="utf-8", errors="replace")[-2_000:]
        record["error"] = error or execution["reason"]
        return None, record
    return json.loads(result_path.read_text(encoding="utf-8")), record


def process_selected_documents(
    selected: list[dict[str, Any]],
    *,
    source_root: Path,
    output: Path,
    timeout_seconds: int,
    memory_mib: int,
    workers: int,
    free_memory_reserve_mib: int,
    checkpoint: dict[str, Any],
    checkpoint_path: Path,
    memory_wait_seconds: int = 0,
) -> tuple[dict[str, dict[str, Any]], int]:
    if workers < 1 or workers > 2:
        raise RuntimeError("Document workers must be between one and two")
    originals = output / "originals"
    work = output / "checkpoint-documents"
    results: dict[str, dict[str, Any]] = {}
    resumed_documents = 0
    pending: list[dict[str, Any]] = []
    for row in selected:
        source_id = row["source_id"]
        existing = checkpoint["documents"].get(source_id)
        result = load_resumable_result(existing, work / f"{source_id}.result.json", originals)
        if result is not None:
            resumed_documents += 1
            results[source_id] = result
        else:
            pending.append(row)

    completed_count = resumed_documents
    manual_review_count = 0
    atomic_json(
        output / "progress.json",
        {
            "status": "running",
            "selectedDocuments": len(selected),
            "completedDocuments": completed_count,
            "manualReviewDocuments": manual_review_count,
            "pendingDocuments": len(pending),
            "workers": workers,
        },
    )

    memory_bytes = memory_mib * 1024 * 1024
    reserve_bytes = free_memory_reserve_mib * 1024 * 1024
    active: dict[Future[tuple[dict[str, Any] | None, dict[str, Any]]], dict[str, Any]] = {}
    next_row = 0
    memory_wait_started: float | None = None
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="corpus-parent") as executor:
        while next_row < len(pending) or active:
            while next_row < len(pending) and len(active) < workers:
                required = reserve_bytes + memory_bytes * (len(active) + 1)
                free = available_memory_bytes()
                if free < required:
                    if active:
                        break
                    if memory_wait_started is None:
                        memory_wait_started = time.monotonic()
                    remaining_wait = memory_wait_seconds - (time.monotonic() - memory_wait_started)
                    if memory_wait_seconds > 0 and remaining_wait > 0:
                        atomic_json(
                            output / "progress.json",
                            {
                                "status": "waiting_for_memory",
                                "selectedDocuments": len(selected),
                                "completedDocuments": completed_count,
                                "manualReviewDocuments": manual_review_count,
                                "pendingDocuments": len(pending) - next_row,
                                "workers": workers,
                                "availableMemoryMiB": free // (1024 * 1024),
                                "requiredMemoryMiB": required // (1024 * 1024),
                            },
                        )
                        print(
                            "Waiting for enough free memory to start the bounded document worker: "
                            f"{free // (1024 * 1024)} MiB available, "
                            f"{required // (1024 * 1024)} MiB required",
                            flush=True,
                        )
                        time.sleep(min(30.0, remaining_wait))
                        continue
                    raise RuntimeError(
                        "Insufficient free memory to start a bounded document worker: "
                        f"{free // (1024 * 1024)} MiB available, "
                        f"{required // (1024 * 1024)} MiB required"
                    )
                row = pending[next_row]
                next_row += 1
                memory_wait_started = None
                atomic_json(
                    output / "progress.json",
                    {
                        "status": "running",
                        "selectedDocuments": len(selected),
                        "completedDocuments": completed_count,
                        "manualReviewDocuments": manual_review_count,
                        "pendingDocuments": len(pending) - next_row,
                        "workers": workers,
                    },
                )
                future = executor.submit(
                    process_document,
                    row,
                    source_root=source_root,
                    output=output,
                    timeout_seconds=timeout_seconds,
                    memory_mib=memory_mib,
                )
                active[future] = row
            if not active:
                continue
            completed, _ = wait(active, return_when=FIRST_COMPLETED)
            for future in completed:
                row = active.pop(future)
                source_id = row["source_id"]
                result, record = future.result()
                checkpoint["documents"][source_id] = record
                atomic_json(checkpoint_path, checkpoint)
                if result is not None:
                    results[source_id] = result
                    completed_count += 1
                else:
                    manual_review_count += 1
                atomic_json(
                    output / "progress.json",
                    {
                        "status": "running",
                        "selectedDocuments": len(selected),
                        "completedDocuments": completed_count,
                        "manualReviewDocuments": manual_review_count,
                        "pendingDocuments": len(pending) - next_row + len(active),
                        "workers": workers,
                        "lastSourceId": source_id,
                    },
                )
                if (completed_count + manual_review_count) % 10 == 0:
                    print(
                        f"Processed {completed_count + manual_review_count}/{len(selected)} "
                        f"({manual_review_count} manual review)",
                        flush=True,
                    )
    return results, resumed_documents


def build(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    originals = output / "originals"
    originals.mkdir(exist_ok=True)
    work = output / "checkpoint-documents"
    work.mkdir(exist_ok=True)

    manifest = args.manifest.resolve()
    excluded_source_ids: set[str] = set()
    for excluded_payload in args.exclude_payload:
        excluded = json.loads(excluded_payload.resolve().read_text(encoding="utf-8"))
        excluded_source_ids.update(
            document["sourceId"] for document in excluded.get("documents", [])
        )
    manifest_rows = read_jsonl(manifest)
    selected = select_rows(
        manifest_rows,
        batch_id=args.batch_id,
        document_count=args.document_count,
        excluded_source_ids=excluded_source_ids,
    )
    attempted_rows = selected
    limits = {
        "timeoutSeconds": args.document_timeout_seconds,
        "memoryMiB": args.document_memory_mib,
        "workers": args.workers,
        "freeMemoryReserveMiB": args.free_memory_reserve_mib,
        "memoryWaitSeconds": getattr(args, "memory_wait_seconds", 0),
    }
    checkpoint_path = output / "checkpoint.json"
    checkpoint = load_checkpoint(
        checkpoint_path,
        checkpoint_identity(selected, manifest, args.batch_id),
        limits,
    )
    results, resumed_documents = process_selected_documents(
        selected,
        source_root=args.source_root.resolve(),
        output=output,
        timeout_seconds=args.document_timeout_seconds,
        memory_mib=args.document_memory_mib,
        workers=args.workers,
        free_memory_reserve_mib=args.free_memory_reserve_mib,
        checkpoint=checkpoint,
        checkpoint_path=checkpoint_path,
        memory_wait_seconds=getattr(args, "memory_wait_seconds", 0),
    )
    quarantined_rows = [row for row in selected if row["source_id"] not in results]
    selected = [row for row in selected if row["source_id"] in results]
    documents: list[dict[str, Any]] = []
    totals = Counter()
    manual_review: list[dict[str, Any]] = []
    for row in selected:
        source_id = row["source_id"]
        result = results.get(source_id)
        documents.append(result["document"])
        totals.update(result["metrics"])
    for row in quarantined_rows:
        source_id = row["source_id"]
        manual_review.append({"sourceId": source_id, **checkpoint["documents"][source_id]})

    payload = {
        "batch": {
            "id": args.batch_id,
            "selection": "deterministic-category-balanced-pipeline-validation",
            "attemptedDocumentCount": args.document_count,
            "quarantineCount": len(manual_review),
            "promotionReady": False,
            "promotionBlocker": "consultant-ranked sources and known-answer evaluation are pending",
        },
        "extraction": {"version": 2, "tableStrategy": "atomic-markdown-or-key-value"},
        "documents": documents,
    }
    atomic_json(output / "payload.json", payload)
    completed_executions = [
        record["execution"]
        for record in checkpoint["documents"].values()
        if record.get("status") == "completed"
    ]
    elapsed = [float(execution["elapsedSeconds"]) for execution in completed_executions]
    peak_memory = [int(execution["peakMemoryBytes"]) for execution in completed_executions]
    summary = {
        "batchId": args.batch_id,
        "attemptedDocumentCount": args.document_count,
        "documentCount": len(documents),
        "attemptedBytes": sum(int(row["size_bytes"]) for row in attempted_rows),
        "bytes": sum(int(row["size_bytes"]) for row in selected),
        "pages": totals["pages"],
        "chunks": totals["chunks"],
        "tablePages": totals["tablePages"],
        "permissionScope": PERMISSION_SCOPE,
        "attemptedGroupCounts": dict(
            sorted(Counter(row["top_level"] for row in attempted_rows).items())
        ),
        "groupCounts": dict(sorted(Counter(row["top_level"] for row in selected).items())),
        "processingLimits": limits,
        "resumedDocuments": resumed_documents,
        "processingTelemetry": {
            "measuredDocuments": len(completed_executions),
            "totalElapsedSeconds": round(sum(elapsed), 3),
            "medianElapsedSeconds": percentile(elapsed, 0.5),
            "p95ElapsedSeconds": percentile(elapsed, 0.95),
            "maxPeakMemoryBytes": max(peak_memory, default=0),
        },
        "manualReviewCount": len(manual_review),
        "manualReview": manual_review,
        "verifiedDirectCount": sum(
            document["integrity"]["outcome"] == "verified" for document in documents
        ),
        "repairVerifiedCount": sum(
            document["integrity"]["outcome"] == "repair_verified" for document in documents
        ),
        "promotionReady": False,
    }
    atomic_json(output / "summary.json", summary)
    atomic_json(
        output / "progress.json",
        {
            "status": "complete_with_quarantine" if manual_review else "complete",
            "selectedDocuments": args.document_count,
            "completedDocuments": len(documents),
            "manualReviewDocuments": len(manual_review),
            "pendingDocuments": 0,
            "workers": args.workers,
        },
    )
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a private bounded PDF corpus payload")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--batch-id", default=BATCH_ID)
    parser.add_argument("--document-count", type=int, default=100)
    parser.add_argument("--exclude-payload", type=Path, action="append", default=[])
    parser.add_argument(
        "--document-timeout-seconds", type=int, default=DEFAULT_DOCUMENT_TIMEOUT_SECONDS
    )
    parser.add_argument("--document-memory-mib", type=int, default=DEFAULT_DOCUMENT_MEMORY_MIB)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument(
        "--free-memory-reserve-mib",
        type=int,
        default=DEFAULT_FREE_MEMORY_RESERVE_MIB,
    )
    parser.add_argument("--memory-wait-seconds", type=int, default=0)
    return parser.parse_args()


def main() -> int:
    print(json.dumps(build(parse_args()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
