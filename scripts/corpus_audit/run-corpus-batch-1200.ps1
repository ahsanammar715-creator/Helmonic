$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$output = Join-Path $repo 'private-build\corpus-batch-1200-context'
$pilotPayload = Join-Path $repo 'private-build\corpus-pilot-100-context\payload\payload.json'
$state = Join-Path $repo 'local-artifacts\corpus-batch-1200-run-state.json'

if (-not (Test-Path -LiteralPath $pilotPayload)) {
    throw "The completed 100-document pilot payload is unavailable: $pilotPayload"
}

@{
    status = 'local_extraction_running'
    batchId = 'corpus-batch-1200-v1'
    documentCount = 1200
    startedUtc = [DateTime]::UtcNow.ToString('o')
    wallClockCeilingHours = 32
    workers = 2
    perDocumentMemoryMiB = 2048
    perDocumentTimeoutSeconds = 600
    freeMemoryReserveMiB = 2048
} | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8

try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'prepare-corpus-pilot-context.ps1') `
        -SourceRoot 'S:\z_Helmonic_iAcoustics' `
        -OutputRoot $output `
        -BatchId 'corpus-batch-1200-v1' `
        -DocumentCount 1200 `
        -ExcludePayload $pilotPayload `
        -Workers 2 `
        -FreeMemoryReserveMiB 2048
    if ($LASTEXITCODE -ne 0) {
        throw "The 1,200-document local extraction exited with code $LASTEXITCODE"
    }
    $run = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
    $run | Add-Member -NotePropertyName status -NotePropertyValue 'local_extraction_complete' -Force
    $run | Add-Member -NotePropertyName completedUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $run | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8
    Write-Output 'The 1,200-document local extraction and two-reader gate completed.'
}
catch {
    $run = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
    $run | Add-Member -NotePropertyName status -NotePropertyValue 'local_extraction_failed' -Force
    $run | Add-Member -NotePropertyName failedUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $run | Add-Member -NotePropertyName error -NotePropertyValue $_.Exception.Message -Force
    $run | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8
    throw
}
