# One-shot TomiLite installer for DSH plugin users.
# Downloads the latest TomiLite release from GitHub, installs silently
# (NSIS /S), and starts the app so the plugin's tools can reach it.
# If TomiLite is already running on :3192, the script does nothing.
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\install-tomilite.ps1
# One-liner from the README:
#   powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/xxwj225-James/tomilite-dsh-plugin/main/scripts/install-tomilite.ps1 | iex"

$ErrorActionPreference = 'Stop'
$Repo = 'xxwj225-James/tomilite'
$ProgressPreference = 'SilentlyContinue'   # speed up Invoke-WebRequest

Write-Host "== TomiLite installer ==" -ForegroundColor Cyan

# 0. Already running? Nothing to do.
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3192/api/system.currentVersion' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
  if ($r.StatusCode -eq 200) {
    Write-Host "TomiLite is already running on :3192 — nothing to install." -ForegroundColor Green
    exit 0
  }
} catch { }

# 1. Resolve the latest release installer URL via the GitHub API
Write-Host "[1/4] Checking latest TomiLite release..."
$api = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
  -Headers @{ 'User-Agent' = 'tomilite-dsh-plugin-installer' }
$exe = $api.assets | Where-Object { $_.name -match '^TomiLite-Setup-.*\.exe$' } | Select-Object -First 1
if (-not $exe) { throw "No installer asset found in latest release ($($api.tag_name))" }
Write-Host "    latest: $($api.tag_name) — $($exe.name)"

# 2. Download
$tmp = Join-Path $env:TEMP $exe.name
Write-Host "[2/4] Downloading $($exe.name)..."
Invoke-WebRequest -Uri $exe.browser_download_url -OutFile $tmp

# 3. Silent install (NSIS /S; installer is per-machine=false so no admin needed)
Write-Host "[3/4] Installing..."
Start-Process -FilePath $tmp -ArgumentList '/S' -Wait

# 4. Launch TomiLite
Write-Host "[4/4] Starting TomiLite..."
$app = Join-Path $env:LOCALAPPDATA 'Programs\TomiLite\TomiLite.exe'
if (-not (Test-Path $app)) {
  $app = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter 'TomiLite.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $app) { throw "TomiLite.exe not found after install — please start it manually." }
Start-Process $app

Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Host "Done! TomiLite is running. Your DSH agent can now use the tomilite_* tools." -ForegroundColor Green
