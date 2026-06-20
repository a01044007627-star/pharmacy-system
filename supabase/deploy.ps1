param(
    [string]$PGString = "",
    [switch]$Paste
)

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$Builder = Join-Path $ProjectRoot "scripts/build-supabase-deploy.mjs"
$Output = Join-Path $PSScriptRoot "deploy.sql"

Write-Host "Building the ordered Supabase deployment bundle..." -ForegroundColor Cyan
Push-Location $ProjectRoot
try {
    & node $Builder
    if ($LASTEXITCODE -ne 0) { throw "Database bundle build failed (exit $LASTEXITCODE)." }
}
finally {
    Pop-Location
}

Write-Host "deploy.sql is ready ($([math]::Round((Get-Item $Output).Length / 1KB, 1)) KB)." -ForegroundColor Green

if ($Paste) {
    Write-Host "`nOpen the Supabase SQL Editor, paste supabase/deploy.sql, then run it." -ForegroundColor Yellow
}
elseif ($PGString) {
    Write-Host "Running via psql..." -ForegroundColor Yellow
    & psql $PGString -f $Output -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -eq 0) { Write-Host "Database deployment completed." -ForegroundColor Green }
    else { throw "psql failed (exit $LASTEXITCODE)." }
}
else {
    Write-Host "`nUsage:" -ForegroundColor Cyan
    Write-Host "  .\deploy.ps1 -Paste" -ForegroundColor White
    Write-Host "  .\deploy.ps1 -PGString 'postgresql://postgres:password@host:5432/postgres'" -ForegroundColor White
}
