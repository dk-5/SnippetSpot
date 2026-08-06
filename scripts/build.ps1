<#
.SYNOPSIS
    Build/develop/test wrapper for SnippetSpot.

.DESCRIPTION
    Convenience wrapper around the standard npm/cargo commands.

    -Task dev     : run the app in development mode (hot reload)   [default]
    -Task test    : run TS unit tests (vitest) and Rust unit tests (cargo test)
    -Task check   : typecheck (tsc --noEmit) + cargo check
    -Task build   : production bundle (NSIS installer + release exe)

.EXAMPLE
    .\scripts\build.ps1
    .\scripts\build.ps1 -Task test
    .\scripts\build.ps1 -Task build
#>

param(
    [ValidateSet("dev", "test", "check", "build")]
    [string]$Task = "dev"
)

# Keep going when native tools write to stderr; verify via $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot

# Make cargo available even in a fresh shell
$env:Path += ";$env:USERPROFILE\.cargo\bin"

function Run-Checked {
    param([string]$Label, [scriptblock]$Command)
    Write-Host "==> $Label" -ForegroundColor Cyan
    Push-Location $root
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

switch ($Task) {
    "dev" {
        Run-Checked "npm run tauri dev" { npm run tauri dev }
    }
    "test" {
        Run-Checked "vitest (TS unit tests)" { npx vitest run }
        Run-Checked "cargo test (Rust unit tests)" { Push-Location (Join-Path $root "src-tauri"); cargo test }
    }
    "check" {
        Run-Checked "tsc --noEmit" { npx tsc --noEmit }
        Run-Checked "cargo check" { Push-Location (Join-Path $root "src-tauri"); cargo check }
    }
    "build" {
        Run-Checked "npm run tauri build (production)" { npm run tauri build }

        $setup = Join-Path $root "src-tauri\target\release\bundle\nsis"
        Write-Host "`nBundle:" -ForegroundColor Green
        if (Test-Path $setup) { Get-ChildItem $setup | Select-Object Name, Length }
    }
}
