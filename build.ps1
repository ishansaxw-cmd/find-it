param([switch]$Test)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$dependencies = Join-Path $PSScriptRoot '.build/deps'
New-Item -ItemType Directory -Force $dependencies | Out-Null

function Get-SourceArchive($Name, $Url, $Directory) {
    $target = Join-Path $dependencies $Directory
    if (-not (Test-Path $target)) {
        Write-Host "Downloading $Name..."
        $archive = Join-Path $dependencies "$Name.zip"
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $archive
        Expand-Archive -Path $archive -DestinationPath $dependencies -Force
        Remove-Item $archive
    }
    return $target
}

$sqlite = Get-SourceArchive 'sqlite-3.50.4' 'https://sqlite.org/2025/sqlite-amalgamation-3500400.zip' 'sqlite-amalgamation-3500400'
$json = Get-SourceArchive 'cJSON-1.7.19' 'https://github.com/DaveGamble/cJSON/archive/refs/tags/v1.7.19.zip' 'cJSON-1.7.19'
$http = Get-SourceArchive 'civetweb-1.16' 'https://github.com/civetweb/civetweb/archive/refs/tags/v1.16.zip' 'civetweb-1.16'
$compiler = (Get-Command gcc -ErrorAction Stop).Source
$includes = @('-Ic', "-I$sqlite", "-I$json", "-I$http/include")
$flags = @('-std=c99', '-O2', '-DNO_SSL', '-DNO_CGI', '-DNO_CACHING', '-DCJSON_HIDE_SYMBOLS', '-DCJSON_NESTING_LIMIT=32')

function Compile-Object($Source, $Output, [switch]$ProjectCode) {
    $warnings = @()
    if ($ProjectCode) { $warnings = @('-Wall', '-Wextra', '-Werror', '-pedantic') }
    if (-not (Test-Path $Output) -or (Get-Item $Source).LastWriteTime -gt (Get-Item $Output).LastWriteTime -or $ProjectCode) {
        & $compiler @flags @warnings @includes -c $Source -o $Output
        if ($LASTEXITCODE -ne 0) { throw "Compilation failed: $Source" }
    }
}

Compile-Object "$sqlite/sqlite3.c" '.build/sqlite3.o'
Compile-Object "$json/cJSON.c" '.build/cJSON.o'
Compile-Object 'c/findit.c' '.build/findit.o' -ProjectCode
Compile-Object 'c/database.c' '.build/database.o' -ProjectCode

if ($Test) {
    Compile-Object 'c/test_database.c' '.build/test_database.o' -ProjectCode
    & $compiler '.build/findit.o' '.build/database.o' '.build/test_database.o' '.build/sqlite3.o' '.build/cJSON.o' -o '.build/test-database.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Database test link failed.' }
    $testDatabase = Join-Path $env:TEMP ("findit-test-" + [guid]::NewGuid().ToString() + '.db')
    & '.build/test-database.exe' $testDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Database tests failed.' }
} else {
    Compile-Object "$http/src/civetweb.c" '.build/civetweb.o'
    Compile-Object 'c/server.c' '.build/server.o' -ProjectCode
    & $compiler '.build/findit.o' '.build/database.o' '.build/server.o' '.build/sqlite3.o' '.build/cJSON.o' '.build/civetweb.o' -lws2_32 -o '.build/findit-server.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Server link failed. Stop any running server before rebuilding.' }
    Write-Host 'Built .build/findit-server.exe'
}