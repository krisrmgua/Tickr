# Install Tickr on Windows (run from a normal PowerShell)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install Node.js LTS first."
}

npm install
npm run pack:win

$Setup = Get-ChildItem -Path (Join-Path $Root "release") -Filter "Tickr*.exe" -Recurse |
  Where-Object { $_.Name -notmatch "uninstall" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Setup) {
  throw "Installer not found under release/"
}

# Close a running copy so the installer can replace it.
Get-Process -Name "Tickr" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Launching $($Setup.FullName)"
Start-Process -FilePath $Setup.FullName -Wait
Write-Host "Tickr installer finished. The tray icon should appear after launch."
