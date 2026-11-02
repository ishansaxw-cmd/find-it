param(
    [ValidateRange(1024, 65535)][int]$Port = 8080,
    [string]$Database = 'data/findit.db',
    [switch]$Empty,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not $SkipBuild -or -not (Test-Path '.build/findit-server.exe')) { & "$PSScriptRoot/build.ps1" }
$databasePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $Database))
New-Item -ItemType Directory -Force (Split-Path $databasePath) | Out-Null
$serverArgs = @($Port.ToString(), $databasePath)
if ($Empty) { $serverArgs += '--empty' }
& "$PSScriptRoot/.build/findit-server.exe" @serverArgs
if ($LASTEXITCODE -ne 0) { throw "FindIt server stopped with code $LASTEXITCODE." }