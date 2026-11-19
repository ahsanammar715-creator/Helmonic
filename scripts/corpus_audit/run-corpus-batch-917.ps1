$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runner = Join-Path $PSScriptRoot 'run-corpus-batch-1200.ps1'
$batch500Root = Join-Path $repo 'private-build\corpus-batch-500-context\payload'
$batch500Payload = Join-Path $batch500Root 'payload.json'
$batch500Summary = Join-Path $batch500Root 'summary.json'

foreach ($required in @($batch500Payload, $batch500Summary)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "The verified 500-PDF batch evidence is unavailable: $required"
    }
}

$summary = Get-Content -LiteralPath $batch500Summary -Raw | ConvertFrom-Json
$memoryRetries = @(
    $summary.manualReview | Where-Object { $_.execution.reason -eq 'memory_limit' }
)
$otherRetries = @(
    $summary.manualReview | Where-Object { $_.execution.reason -ne 'memory_limit' }
)
if ($memoryRetries.Count -ne 15 -or $otherRetries.Count -ne 2) {
    throw "Expected exactly 15 memory retries and 2 other retries; found $($memoryRetries.Count) and $($otherRetries.Count)"
}

Write-Output 'Starting the approved 917-attempt PDF batch.'
Write-Output 'Scope: 900 untouched PDFs, 15 exclusive 4 GiB retries, and 2 no-text retries.'
Write-Output 'One ordinary worker; 4 GiB retries run alone with the approved pagefile-aware gate.'

& $runner `
    -DocumentCount 900 `
    -AttemptCount 917 `
    -Workers 1 `
    -FreeMemoryReserveMiB 1024 `
    -MemoryWaitSeconds 7200 `
    -AdditionalExcludePayload $batch500Payload `
    -RetrySummary $batch500Summary `
    -RetryMemoryMiB 4096 `
    -RetryPhysicalFloorMiB 3072 `
    -RetryCommitFloorMiB 5120 `
    -WallClockCeilingHours 15

if ($LASTEXITCODE -ne 0) {
    throw "The approved 917-attempt local gate exited with code $LASTEXITCODE"
}
