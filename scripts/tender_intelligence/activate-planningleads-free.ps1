[CmdletBinding()]
param(
    [switch]$FromClipboard
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$envFile = Join-Path $repoRoot ".env.local"
$verificationScript = Join-Path $PSScriptRoot "verify-planningleads-connection.mjs"

$keyPointer = [IntPtr]::Zero
try {
    if ($FromClipboard) {
        $plainKey = [string](Get-Clipboard -Raw)
        $plainKey = $plainKey.Trim()
        Write-Host "Read the copied PlanningLeads key from the clipboard; its value will not be displayed."
    } else {
        $secureKey = Read-Host "Type the free PlanningLeads API key (input stays hidden)" -AsSecureString
        $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    }
    if ([string]::IsNullOrWhiteSpace($plainKey) -or $plainKey.Length -lt 20 -or $plainKey -match "\s") {
        throw "The API key appears empty, truncated, or contains spaces. Nothing was saved."
    }

    $env:PLANNINGLEADS_API_KEY = $plainKey
    $env:PLANNINGLEADS_API_ENDPOINT = "https://planningleads.ie/api/v1"
    & node --experimental-strip-types $verificationScript
    if ($LASTEXITCODE -ne 0) {
        throw "The key did not pass the live read-only connection proof. Nothing was saved."
    }

    $lines = if (Test-Path -LiteralPath $envFile) {
        @(Get-Content -LiteralPath $envFile)
    } else {
        @()
    }
    $settings = [ordered]@{
        HELMONIC_PLANNINGLEADS_ENABLED = "true"
        PLANNINGLEADS_API_ENDPOINT = "https://planningleads.ie/api/v1"
        PLANNINGLEADS_API_KEY = $plainKey
        HELMONIC_PLANNINGLEADS_PAGE_SIZE = "100"
        HELMONIC_PLANNINGLEADS_CACHE_HOURS = "12"
    }
    foreach ($name in $settings.Keys) {
        $escapedName = [Regex]::Escape($name)
        $lines = @($lines | Where-Object { $_ -notmatch "^$escapedName\s*=" })
    }
    if ($lines.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($lines[-1])) {
        $lines += ""
    }
    $lines += "# Optional free PlanningLeads discovery connector"
    foreach ($entry in $settings.GetEnumerator()) {
        $lines += "$($entry.Key)=$($entry.Value)"
    }

    $temporaryFile = "$envFile.new"
    [IO.File]::WriteAllLines($temporaryFile, [string[]]$lines, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryFile -Destination $envFile -Force
    Write-Host "PlanningLeads is enabled locally and the bounded live proof passed."
} finally {
    $env:PLANNINGLEADS_API_KEY = $null
    if ($keyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    Remove-Variable plainKey -ErrorAction SilentlyContinue
}
