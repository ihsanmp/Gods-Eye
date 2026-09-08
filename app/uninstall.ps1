<#
  Remove the Map Monitoring desktop installation.

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

$AppName = "Map Monitoring"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RegistryKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MapMonitoring'

# Both names. An installation made before the rename is still an installation of
# this app, and someone uninstalling expects the machine clean afterwards — not
# a leftover icon under a name they no longer recognise.
$LegacyAppName = "God's Eye View"
$LegacyRegistryKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\GodsEyeView'

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$links = @(
  (Join-Path $desktop "$AppName.lnk"),
  (Join-Path $startMenu "$AppName.lnk"),
  (Join-Path $desktop "$LegacyAppName.lnk"),
  (Join-Path $startMenu "$LegacyAppName.lnk")
)

Write-Host "Mencopot $AppName..." -ForegroundColor Cyan

foreach ($link in $links) {
  if (Test-Path $link) {
    Remove-Item $link -Force
    Write-Host "  dihapus: $link"
  }
}

foreach ($key in @($RegistryKey, $LegacyRegistryKey)) {
  if (Test-Path $key) {
    Remove-Item $key -Recurse -Force
    Write-Host '  dihapus: entri Settings > Apps'
  }
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
