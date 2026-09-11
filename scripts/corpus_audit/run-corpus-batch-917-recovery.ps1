$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$python = 'C:\Users\Alessandro.Saccarola\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$basePayload = Join-Path $repo 'private-build\corpus-batch-917-context\payload'
$priorSummary = Join-Path $repo 'private-build\corpus-batch-500-context\payload\summary.json'
$manifest = Join-Path $repo 'local-artifacts\corpus-ingestion-manifest\full-ingestion-manifest.jsonl'
$recovery = Join-Path $repo 'private-build\corpus-batch-917-recovery-context'
$state = Join-Path $repo 'local-artifacts\corpus-batch-917-recovery-state.json'

foreach ($required in @($python, $basePayload, $priorSummary, $manifest)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required recovery input is unavailable: $required"
    }
}

@{
    status = 'recovery_running'
    startedUtc = [DateTime]::UtcNow.ToString('o')
    source = 'retained-hash-checked-staged-originals'
    azureCalls = 0
    scope = '27-first-4g;5-bounded-low-memory;1-extended-timeout;3-no-text-not-retried'
} | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8

try {
    & $python (Join-Path $PSScriptRoot 'recover_corpus_batch_917.py') `
        --base-payload-dir $basePayload `
        --prior-summary $priorSummary `
        --manifest $manifest `
        --recovery-output $recovery `
        --memory-wait-seconds 7200
    if ($LASTEXITCODE -ne 0) {
        throw "Corpus batch 917 recovery exited with code $LASTEXITCODE"
    }
    $report = Get-Content -LiteralPath (Join-Path $recovery 'recovery-report.json') -Raw | ConvertFrom-Json
    @{
        status = 'recovery_complete'
        completedUtc = [DateTime]::UtcNow.ToString('o')
        source = 'retained-hash-checked-staged-originals'
        azureCalls = 0
        report = $report
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $state -Encoding UTF8
    Write-Output "Recovery complete: $($report.finalAcceptedDocuments) accepted, $($report.finalQuarantineDocuments) quarantined."
}
catch {
    @{
        status = 'recovery_failed'
        failedUtc = [DateTime]::UtcNow.ToString('o')
        source = 'retained-hash-checked-staged-originals'
        azureCalls = 0
        error = $_.Exception.Message
    } | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8
    throw
}
