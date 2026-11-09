$ErrorActionPreference = 'Stop'

$runner = Join-Path $PSScriptRoot 'run-corpus-batch-1200.ps1'
Write-Output 'Starting the unattended 500-PDF batch with one bounded worker.'
Write-Output 'The launcher will wait for 3 GiB of free memory instead of failing immediately.'
& $runner -DocumentCount 500 -Workers 1 -FreeMemoryReserveMiB 1024 -MemoryWaitSeconds 7200
