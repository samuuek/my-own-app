$ErrorActionPreference = 'SilentlyContinue'
$projectPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$siteUrl = 'http://127.0.0.1:5173/#today'

function Test-SiyuUrl([string]$url) {
    try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

$frontendReady = Test-SiyuUrl 'http://127.0.0.1:5173/'
$backendReady = Test-SiyuUrl 'http://127.0.0.1:8787/api/health'

if (-not $frontendReady -and -not $backendReady) {
    Start-Process -FilePath 'npm.cmd' `
        -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1') `
        -WorkingDirectory $projectPath `
        -WindowStyle Hidden
} elseif (-not $backendReady) {
    Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev:server') -WorkingDirectory $projectPath -WindowStyle Hidden
} elseif (-not $frontendReady) {
    Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev:frontend', '--', '--host', '127.0.0.1') -WorkingDirectory $projectPath -WindowStyle Hidden
}

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ((Test-SiyuUrl 'http://127.0.0.1:5173/') -and (Test-SiyuUrl 'http://127.0.0.1:8787/api/health')) { break }
    Start-Sleep -Milliseconds 500
}

Start-Process $siteUrl
