param(
    [string]$PGString = "",
    [switch]$Paste
)

$Consolidated = Join-Path $PSScriptRoot "consolidated"
$Migrations = Join-Path $PSScriptRoot "migrations"
$Output = Join-Path $PSScriptRoot "deploy.sql"

Write-Host "Creating deploy.sql from all 47 files..." -ForegroundColor Cyan

# Collect files in order
$files = @()
foreach ($f in "000_core_tables.sql","001_helper_functions.sql","002_atomic_rpcs.sql","003_rls_policies.sql","004_triggers_views_constraints.sql","005_data_migrations.sql") {
    $files += Join-Path $Consolidated $f
}
Get-ChildItem $Migrations -Filter *.sql | Sort-Object Name | ForEach-Object { $files += $_.FullName }

# Concatenate
Clear-Content $Output -Force
foreach ($f in $files) {
    $sep = "-- ===== $(Split-Path $f -Leaf) ====="
    Add-Content $Output $sep
    Get-Content $f | Add-Content $Output
    Add-Content $Output "`n"
}

Write-Host "✓ deploy.sql created ($((Get-Item $Output).Length / 1KB) KB)" -ForegroundColor Green

if ($Paste) {
    Write-Host "`nOpen: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new" -ForegroundColor Yellow
    Write-Host "Then paste the entire contents of deploy.sql and click RUN." -ForegroundColor Yellow
    Write-Host "(You may need to split into chunks if >200KB for the web editor)" -ForegroundColor Yellow
}
elseif ($PGString) {
    Write-Host "Running via psql..." -ForegroundColor Yellow
    & "psql" $PGString -f $Output -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -eq 0) { Write-Host "✓ Done!" -ForegroundColor Green }
    else { Write-Host "✗ Failed (exit $LASTEXITCODE)" -ForegroundColor Red }
}
else {
    Write-Host "`nUsage:" -ForegroundColor Cyan
    Write-Host "  1) Paste in Supabase SQL Editor:" -ForegroundColor White
    Write-Host "     .\deploy.ps1 -Paste" -ForegroundColor Green
    Write-Host "  2) Run via psql:" -ForegroundColor White
    Write-Host "     .\deploy.ps1 'postgresql://postgres:password@host:5432/postgres'" -ForegroundColor Green
}
