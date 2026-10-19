$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:UV_HTTP_RETRIES = '0'
uv sync --cache-dir .uv-cache --system-certs
if ($LASTEXITCODE -ne 0) { throw 'Python dependency setup failed. Stop and inspect the error above.' }
Push-Location frontend
try {
    npm ci --cache ../.npm-cache --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency setup failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Output 'Ready. Double-click Start.cmd to launch.'
