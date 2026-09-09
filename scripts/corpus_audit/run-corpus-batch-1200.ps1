param(
    [ValidateRange(1, 1200)]
    [int]$DocumentCount = 1200,
    [ValidateRange(0, 1217)]
    [int]$AttemptCount = 0,
    [ValidateRange(1, 2)]
    [int]$Workers = 2,
    [ValidateRange(512, 4096)]
    [int]$FreeMemoryReserveMiB = 2048,
    [ValidateRange(0, 115200)]
    [int]$MemoryWaitSeconds = 0,
    [string[]]$AdditionalExcludePayload = @(),
    [string[]]$RetrySummary = @(),
    [ValidateRange(2048, 4096)]
    [int]$RetryMemoryMiB = 4096,
    [ValidateRange(2048, 4096)]
    [int]$RetryPhysicalFloorMiB = 3072,
    [ValidateRange(4096, 16384)]
    [int]$RetryCommitFloorMiB = 5120,
    [ValidateRange(1, 32)]
    [int]$WallClockCeilingHours = 32
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($AttemptCount -eq 0) { $AttemptCount = $DocumentCount }
$batchId = "corpus-batch-$AttemptCount-v1"
$output = Join-Path $repo "private-build\corpus-batch-$AttemptCount-context"
$pilotPayload = Join-Path $repo 'private-build\corpus-pilot-100-context\payload\payload.json'
$state = Join-Path $repo "local-artifacts\corpus-batch-$AttemptCount-run-state.json"

function Remove-AbandonedPreflightContext {
    param([Parameter(Mandatory = $true)][string]$ContextPath)

    if (-not (Test-Path -LiteralPath $ContextPath)) {
        return
    }

    $expectedPath = [IO.Path]::GetFullPath((Join-Path $repo "private-build\corpus-batch-$AttemptCount-context"))
    $actualPath = [IO.Path]::GetFullPath($ContextPath)
    if (-not $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing preflight cleanup outside the exact disposable batch context: $actualPath"
    }

    $payloadRoot = Join-Path $actualPath 'payload'
    $checkpointPath = Join-Path $payloadRoot 'checkpoint.json'
    if (Test-Path -LiteralPath $checkpointPath) {
        return
    }

    foreach ($completedArtifact in @('payload.json', 'summary.json')) {
        if (Test-Path -LiteralPath (Join-Path $payloadRoot $completedArtifact)) {
            throw "Refusing to remove the existing batch context because $completedArtifact exists: $actualPath"
        }
    }

    $originalsPath = Join-Path $payloadRoot 'originals'
    if ((Test-Path -LiteralPath $originalsPath) -and
        @(Get-ChildItem -LiteralPath $originalsPath -File -Recurse).Count -gt 0) {
        throw "Refusing to remove the existing batch context because copied originals exist: $actualPath"
    }

    $progressPath = Join-Path $payloadRoot 'progress.json'
    if (Test-Path -LiteralPath $progressPath) {
        $progress = Get-Content -LiteralPath $progressPath -Raw | ConvertFrom-Json
        if ([int]$progress.completedDocuments -ne 0 -or [int]$progress.manualReviewDocuments -ne 0) {
            throw "Refusing to remove the existing batch context because its progress marker records completed work: $actualPath"
        }
    }

    $allowedFiles = @(
        'Dockerfile',
        'package-lock.json',
        'package.json',
        'payload\progress.json',
        'scripts\corpus_document_worker.py',
        'scripts\managed-identity.mjs',
        'scripts\ingestion\corpus-pilot-contract.mjs',
        'scripts\ingestion\index-parity.mjs',
        'scripts\ingestion\ingest-corpus-pilot.mjs'
    )
    $unexpectedFiles = @(
        Get-ChildItem -LiteralPath $actualPath -File -Recurse | ForEach-Object {
            $_.FullName.Substring($actualPath.Length + 1)
        } | Where-Object { $_ -notin $allowedFiles }
    )
    if ($unexpectedFiles.Count -gt 0) {
        throw "Refusing to remove the existing batch context because it contains unexpected files: $($unexpectedFiles -join ', ')"
    }

    Write-Output 'Removing an abandoned zero-progress preflight context from the prior memory-gate stop.'
    Remove-Item -LiteralPath $actualPath -Recurse -Force
}

if (-not (Test-Path -LiteralPath $pilotPayload)) {
    throw "The completed 100-document pilot payload is unavailable: $pilotPayload"
}

Remove-AbandonedPreflightContext -ContextPath $output

@{
    status = 'local_extraction_running'
    batchId = $batchId
    primaryDocumentCount = $DocumentCount
    attemptCount = $AttemptCount
    startedUtc = [DateTime]::UtcNow.ToString('o')
    wallClockCeilingHours = $WallClockCeilingHours
    workers = $Workers
    perDocumentMemoryMiB = 2048
    retryDocumentMemoryMiB = $RetryMemoryMiB
    retryPhysicalFloorMiB = $RetryPhysicalFloorMiB
    retryCommitFloorMiB = $RetryCommitFloorMiB
    perDocumentTimeoutSeconds = 600
    freeMemoryReserveMiB = $FreeMemoryReserveMiB
} | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8

try {
    $excludePayloads = @($pilotPayload) + @($AdditionalExcludePayload)
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'prepare-corpus-pilot-context.ps1') `
        -SourceRoot 'S:\z_Helmonic_iAcoustics' `
        -OutputRoot $output `
        -BatchId $batchId `
        -DocumentCount $DocumentCount `
        -ExcludePayload $excludePayloads `
        -RetrySummary $RetrySummary `
        -Workers $Workers `
        -FreeMemoryReserveMiB $FreeMemoryReserveMiB `
        -MemoryWaitSeconds $MemoryWaitSeconds `
        -RetryMemoryMiB $RetryMemoryMiB `
        -RetryPhysicalFloorMiB $RetryPhysicalFloorMiB `
        -RetryCommitFloorMiB $RetryCommitFloorMiB
    if ($LASTEXITCODE -ne 0) {
        throw "The $AttemptCount-attempt local extraction exited with code $LASTEXITCODE"
    }
    $run = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
    $run | Add-Member -NotePropertyName status -NotePropertyValue 'local_extraction_complete' -Force
    $run | Add-Member -NotePropertyName completedUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $run | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8
    Write-Output "The $AttemptCount-attempt local extraction and two-reader gate completed."
}
catch {
    $run = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
    $run | Add-Member -NotePropertyName status -NotePropertyValue 'local_extraction_failed' -Force
    $run | Add-Member -NotePropertyName failedUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $run | Add-Member -NotePropertyName error -NotePropertyValue $_.Exception.Message -Force
    $run | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8
    throw
}
