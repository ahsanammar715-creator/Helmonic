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
from pathlib import Path
from typing import Any, Iterable

BATCH_ID = "corpus-pilot-100-v1"
PERMISSION_SCOPE = "iAcoustics"
DEFAULT_DOCUMENT_TIMEOUT_SECONDS = 600
DEFAULT_DOCUMENT_MEMORY_MIB = 2_048
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
        and row.get("top_level") in GROUP_QUOTAS
    )


def stable_selection_key(row: dict[str, Any]) -> tuple[str, str]:
    material = f"{BATCH_ID}\0{row['source_id']}\0{row.get('sha256') or 'capture-hash-required'}".encode("utf-8")
    return hashlib.sha256(material).hexdigest(), row["source_id"]


def select_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = [row for row in rows if eligible(row)]
    selected: list[dict[str, Any]] = []
    for group, quota in GROUP_QUOTAS.items():
        group_rows = sorted(
            (row for row in candidates if row["top_level"] == group),
            key=stable_selection_key,
        )
        if len(group_rows) < quota:
            raise RuntimeError(f"{group} has {len(group_rows)} eligible PDFs; {quota} required")
        selected.extend(group_rows[:quota])
    if len(selected) != 100 or len({row["source_id"] for row in selected}) != 100:
        raise RuntimeError("The corpus pilot selection must contain exactly 100 unique sources")
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


def checkpoint_identity(selected: list[dict[str, Any]], manifest: Path) -> str:
    material = {
        "batchId": BATCH_ID,
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


def build(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    originals = output / "originals"
    originals.mkdir(exist_ok=True)
    work = output / "checkpoint-documents"
    work.mkdir(exist_ok=True)

    manifest = args.manifest.resolve()
    selected = select_rows(read_jsonl(manifest))
    limits = {
        "timeoutSeconds": args.document_timeout_seconds,
        "memoryMiB": args.document_memory_mib,
    }
    checkpoint_path = output / "checkpoint.json"
    checkpoint = load_checkpoint(checkpoint_path, checkpoint_identity(selected, manifest), limits)
    documents: list[dict[str, Any]] = []
    totals = Counter()
    manual_review: list[dict[str, Any]] = []
    resumed_documents = 0
    for row in selected:
        source_id = row["source_id"]
        existing = checkpoint["documents"].get(source_id)
        result_path = work / f"{source_id}.result.json"
        result = load_resumable_result(existing, result_path, originals)
        if result is not None:
            resumed_documents += 1
        if result is None:
            result, record = process_document(
                row,
                source_root=args.source_root.resolve(),
                output=output,
                timeout_seconds=args.document_timeout_seconds,
                memory_mib=args.document_memory_mib,
            )
            checkpoint["documents"][source_id] = record
            atomic_json(checkpoint_path, checkpoint)
        if result is None:
            manual_review.append({"sourceId": source_id, **checkpoint["documents"][source_id]})
            continue
        documents.append(result["document"])
        totals.update(result["metrics"])

    payload = {
        "batch": {
            "id": BATCH_ID,
            "selection": "deterministic-category-balanced-pipeline-validation",
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
        "batchId": BATCH_ID,
        "documentCount": len(documents),
        "bytes": sum(int(row["size_bytes"]) for row in selected),
        "pages": totals["pages"],
        "chunks": totals["chunks"],
        "tablePages": totals["tablePages"],
        "permissionScope": PERMISSION_SCOPE,
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
        "promotionReady": False,
    }
    atomic_json(output / "summary.json", summary)
    if manual_review:
        raise RuntimeError(
            f"{len(manual_review)} documents require manual review; candidate payload is incomplete"
        )
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the private 100-PDF corpus pilot payload")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--document-timeout-seconds", type=int, default=DEFAULT_DOCUMENT_TIMEOUT_SECONDS
    )
    parser.add_argument("--document-memory-mib", type=int, default=DEFAULT_DOCUMENT_MEMORY_MIB)
    return parser.parse_args()


def main() -> int:
    print(json.dumps(build(parse_args()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
