<#
  Remove the God's Eye View desktop installation.

  Deletes the shortcuts and the Settings > Apps registry entry. The source
  checkout, .env, and the browser profile are deliberately left alone - this
  reverses install.ps1, it does not delete the project.

    powershell -ExecutionPolicy Bypass -File app\uninstall.ps1
#>

[CmdletBinding()]
param(
  # Also delete the app window's saved browser profile (window size, zoom,
  # microphone permission for the voice feature).
  [switch]$RemoveProfile
)

$ErrorActionPreference = 'Stop'

$AppName = "God's Eye View"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RegistryKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\GodsEyeView'

$links = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName.lnk")
)

Write-Host "Mencopot $AppName..." -ForegroundColor Cyan

foreach ($link in $links) {
  if (Test-Path $link) {
    Remove-Item $link -Force
    Write-Host "  dihapus: $link"
  }
}

if (Test-Path $RegistryKey) {
  Remove-Item $RegistryKey -Recurse -Force
  Write-Host '  dihapus: entri Settings > Apps'
}

if ($RemoveProfile) {
  $profileDir = Join-Path $AppDir 'browser-profile'
  if (Test-Path $profileDir) {
    Remove-Item $profileDir -Recurse -Force
    Write-Host '  dihapus: profil jendela aplikasi'
  }
}

Write-Host ''
Write-Host 'Selesai. Kode sumber di D:\gods-eye-view tidak disentuh.' -ForegroundColor Green
