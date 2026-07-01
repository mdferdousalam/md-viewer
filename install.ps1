# Markdown Viewer installer for Windows.
#
#   irm https://raw.githubusercontent.com/mdferdousalam/md-viewer/main/install.ps1 | iex
#
# Downloads the latest release installer from GitHub and runs it silently.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # much faster Invoke-WebRequest downloads

# Ensure TLS 1.2 on older Windows PowerShell 5.x.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$repo = 'mdferdousalam/md-viewer'
$headers = @{ 'User-Agent' = 'md-viewer-installer' }

Write-Host ""
Write-Host "Installing Markdown Viewer" -ForegroundColor White
Write-Host ""

Write-Host "  Looking up the latest release..." -ForegroundColor Cyan
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers

$asset = $release.assets | Where-Object { $_.name -like 'Markdown-Viewer-Setup-*.exe' } | Select-Object -First 1
if (-not $asset) { throw "No Windows installer found in release $($release.tag_name)." }

Write-Host "  Latest version: $($release.tag_name)" -ForegroundColor Green

$dest = Join-Path $env:TEMP $asset.name
Write-Host "  Downloading $($asset.name)..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -Headers $headers

Write-Host "  Running the installer..." -ForegroundColor Cyan
# NSIS silent install. Drop '/S' to run the interactive installer instead.
Start-Process -FilePath $dest -ArgumentList '/S' -Wait
Remove-Item $dest -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  Installed Markdown Viewer $($release.tag_name)." -ForegroundColor Green
Write-Host "  Launch it from the Start Menu or the desktop shortcut."
Write-Host ""
