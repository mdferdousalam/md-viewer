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

# CLI shim so scripts and agents can run `md-viewer <subcommand>`
# (e.g. `md-viewer export notes.md --to pdf`). Best-effort; never fails install.
try {
  $exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Filter 'Markdown Viewer.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) {
    $shimDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'  # on PATH by default
    if (-not (Test-Path $shimDir)) { New-Item -ItemType Directory -Path $shimDir -Force | Out-Null }
    Set-Content -Path (Join-Path $shimDir 'md-viewer.cmd') -Value "@echo off`r`n`"$($exe.FullName)`" %*" -Encoding ascii
    Write-Host "  From a terminal or scripts:  md-viewer <file>" -ForegroundColor Green
  }
} catch {}
Write-Host ""
