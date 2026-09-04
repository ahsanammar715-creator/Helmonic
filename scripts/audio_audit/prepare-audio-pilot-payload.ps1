[CmdletBinding()]
param(
  [string] $SourceRoot = "S:\z_Helmonic_iAcoustics",
  [string] $PilotManifest = "local-artifacts\audio-ingestion-pilot\audio-pilot-manifest.jsonl",
  [string] $OutputRoot = "private-build\audio-pilot-context"
)

$ErrorActionPreference = "Stop"
$expectedCount = 12
$maximumBytes = 536870912

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$manifestPath = Join-Path $repositoryRoot $PilotManifest
$outputPath = Join-Path $repositoryRoot $OutputRoot
if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
  throw "Source root is unavailable: $SourceRoot"
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Pilot manifest is unavailable: $manifestPath"
}
if (Test-Path -LiteralPath $outputPath) {
  throw "Private pilot output already exists; inspect or remove it deliberately before rerunning: $outputPath"
}

$pilot = @(Get-Content -LiteralPath $manifestPath | ForEach-Object { $_ | ConvertFrom-Json })
if ($pilot.Count -ne $expectedCount) {
  throw "Expected exactly $expectedCount pilot documents, found $($pilot.Count)"
}
$declaredBytes = ($pilot | Measure-Object -Property size_bytes -Sum).Sum
if ($declaredBytes -gt $maximumBytes) {
  throw "Pilot exceeds the $maximumBytes-byte ceiling"
}
if (@($pilot | Where-Object { $_.promotion_state -ne "pilot_only" -or $_.content_processing -ne "none" }).Count) {
  throw "Every audio item must remain pilot_only with content processing disabled"
}

$payloadPath = Join-Path $outputPath "payload"
$originals = Join-Path $payloadPath "originals"
New-Item -ItemType Directory -Path $originals -Force | Out-Null
$documents = @()
foreach ($item in $pilot) {
  if ($item.source_id -notmatch '^src-[0-9a-f]{24}$') {
    throw "Invalid source ID in pilot manifest"
  }
  $relativePath = $item.relative_path -replace '/', '\\'
  $source = Join-Path $SourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Pilot source is unavailable: $source"
  }

  $before = Get-Item -LiteralPath $source
  if ($before.Length -ne $item.size_bytes) {
    throw "Source size changed since audit: $($item.relative_path)"
  }
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  $localName = "$($item.source_id).wav"
  $destination = Join-Path $originals $localName
  Copy-Item -LiteralPath $source -Destination $destination
  $copiedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne $copiedHash) {
    throw "Staged copy hash mismatch: $($item.relative_path)"
  }
  $after = Get-Item -LiteralPath $source
  if ($before.Length -ne $after.Length -or $before.LastWriteTimeUtc.Ticks -ne $after.LastWriteTimeUtc.Ticks) {
    throw "Source changed while staging: $($item.relative_path)"
  }

  $documents += [ordered]@{
    source_id = $item.source_id
    relative_path = $item.relative_path
    local_name = $localName
    blob_name = $item.blob_name
    size_bytes = [long]$item.size_bytes
    sha256 = $sourceHash
    permission_scope = $item.permission_scope
    citation_namespace = $item.citation_namespace
    duration_seconds = [double]$item.duration_seconds
    format_tag = [int]$item.format_tag
    channels = [int]$item.channels
    sample_rate_hz = [int]$item.sample_rate_hz
    measurement_companion = [bool]$item.measurement_companion
    pdf_companion = [bool]$item.pdf_companion
    text_companion = [bool]$item.text_companion
    speech_filename_hint = [bool]$item.speech_filename_hint
    playback_strategy = $item.playback_strategy
    content_processing = "none"
    promotion_state = "pilot_only"
  }
}

$payload = [ordered]@{
  payload_version = 1
  pilot_id = "audio-pilot-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))"
  generated_utc = (Get-Date).ToUniversalTime().ToString("o")
  source_was_not_modified = $true
  content_processing = "none"
  documents = $documents
}
$json = $payload | ConvertTo-Json -Depth 8
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $payloadPath "payload.json"), $json, $utf8WithoutBom)

New-Item -ItemType Directory -Path (Join-Path $outputPath "scripts\audio_ingestion") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputPath "scripts") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repositoryRoot "package.json") -Destination $outputPath
Copy-Item -LiteralPath (Join-Path $repositoryRoot "package-lock.json") -Destination $outputPath
Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\managed-identity.mjs") -Destination (Join-Path $outputPath "scripts")
Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\audio_ingestion\audio-pilot-contract.mjs") -Destination (Join-Path $outputPath "scripts\audio_ingestion")
Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\audio_ingestion\upload-audio-pilot.mjs") -Destination (Join-Path $outputPath "scripts\audio_ingestion")
Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\audio_ingestion\Dockerfile.audio-pilot") -Destination (Join-Path $outputPath "Dockerfile")

[pscustomobject]@{
  PilotId = $payload.pilot_id
  Documents = $documents.Count
  Bytes = $declaredBytes
  SourceModified = $false
  PrivateBuildContext = $outputPath
}
