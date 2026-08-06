<#
.SYNOPSIS
    Installs the toolchain needed to build SnippetSpot on Windows:
    Rust (rustup) + Visual Studio 2022 Build Tools (C++ workload + Windows SDK).

.DESCRIPTION
    Idempotent: checks what is already installed and installs only what's missing.
    The VS Build Tools install requires elevation -- accept the UAC prompt.

.EXAMPLE
    .\scripts\setup.ps1
#>

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Info($msg) { Write-Host "    $msg" -ForegroundColor Gray }
function Write-Ok($msg) { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-WarnMsg($msg) { Write-Host "    WARN: $msg" -ForegroundColor Yellow }

# --- 1. Rust ----------------------------------------------------------------

Write-Step "Checking Rust toolchain"
$env:Path += ";$env:USERPROFILE\.cargo\bin"
$cargoOk = Get-Command cargo -ErrorAction SilentlyContinue

if ($cargoOk) {
    $ver = & cargo --version 2>$null
    Write-Ok "$ver"
} else {
    Write-Info "Rust not found. Installing rustup via winget..."
    & winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "rustup install failed (exit $LASTEXITCODE)" }
    $env:Path += ";$env:USERPROFILE\.cargo\bin"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "cargo still not on PATH after install" }
    Write-Ok "cargo installed: $(& cargo --version)"
}

# --- 2. Visual Studio Build Tools (MSVC + Windows SDK) ----------------------

Write-Step "Checking Visual Studio Build Tools (C++ workload)"
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vcInstalled = $false
if (Test-Path $vswhere) {
    $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    $vcInstalled = [bool]($path -and (Test-Path $path))
}
if ($vcInstalled) {
    Write-Ok "MSVC C++ tools present"
} else {
    Write-Info "Installing VS 2022 Build Tools with the C++ workload (this downloads ~3 GB, needs a UAC prompt)..."
    $override = '--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart'
    & winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
        --accept-package-agreements --accept-source-agreements `
        --override $override
    if ($LASTEXITCODE -ne 0) { throw "VS Build Tools install failed (exit $LASTEXITCODE)" }
    Write-Ok "VS Build Tools installed"
}

# --- 3. Windows SDK verification -------------------------------------------

Write-Step "Verifying Windows SDK libraries (kernel32.lib)"
$sdkLib = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\Lib" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
$kernel32 = if ($sdkLib) { Join-Path $sdkLib.FullName "um\x64\kernel32.lib" } else { $null }

if ($kernel32 -and (Test-Path $kernel32)) {
    Write-Ok "Windows SDK found ($($sdkLib.Name))"
} else {
    Write-WarnMsg "Windows SDK incomplete -- running the VS installer to repair the SDK (accept the UAC prompt)"
    $setup = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
    $vsPath = if ($vcInstalled) { $path } else { "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" }
    $modArgs = @('modify', '--installPath', "`"$vsPath`"",
        '--add', 'Microsoft.VisualStudio.Workload.VCTools', '--includeRecommended',
        '--passive', '--norestart')
    & $setup $modArgs
    if ($LASTEXITCODE -ne 0) { throw "VS installer repair failed (exit $LASTEXITCODE)" }
    if (-not (Test-Path $kernel32)) { Write-WarnMsg "Still no kernel32.lib -- restart and re-run setup.ps1" }
    else { Write-Ok "Windows SDK ready" }
}

# --- 4. Final check ---------------------------------------------------------

Write-Step "Final check"
& cargo --version
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "cargo missing" }
Write-Host "`nToolchain ready. Next: npm install  &&  npm run tauri dev" -ForegroundColor Green
