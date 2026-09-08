<#
  Install Map Monitoring as a desktop application for the current user.

  Creates a Desktop shortcut, a Start Menu entry, and a registry record so the
  app appears in Settings > Apps > Installed apps with a working Uninstall
  button. Everything is written under HKCU and the user profile, so no
  administrator rights are needed and nothing outside this account is touched.

  The app itself is not copied anywhere: it runs from this checkout, because it
  needs the repo (node_modules, .env, config/) to work at all. Uninstalling
  removes the shortcuts and the registry entry, never the source.

    powershell -ExecutionPolicy Bypass -File app\install.ps1
#>

[CmdletBinding()]
param(
  # Skip the Desktop shortcut if only a Start Menu entry is wanted.
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = 'Stop'

$AppName = "Map Monitoring"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $AppDir
$Target = Join-Path $AppDir 'MapMonitoring.vbs'
$IconPath = Join-Path $AppDir 'MapMonitoring.ico'
$RegistryKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MapMonitoring'

<#
  What the previous name left behind.

  An installation made before the rename put "God's Eye View" shortcuts on the
  Desktop and in the Start Menu, and its own key under Uninstall\GodsEyeView.
  Installing under the new name does not touch any of that, so without this the
  machine ends up with two icons that launch the same app and an entry in
  Settings > Apps whose uninstaller points at a script that no longer exists.

  Removed here rather than left to the old uninstaller, because by the time
  someone notices the duplicate they have usually already replaced the folder
  the old uninstaller lived in.
#>
$LegacyAppName = "God's Eye View"
$LegacyRegistryKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\GodsEyeView'
$legacyLinks = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$LegacyAppName.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$LegacyAppName.lnk")
)
foreach ($legacy in $legacyLinks) {
  if (Test-Path $legacy) {
    Remove-Item $legacy -Force -ErrorAction SilentlyContinue
    Write-Host "  dihapus (nama lama): $legacy"
  }
}
if (Test-Path $LegacyRegistryKey) {
  Remove-Item $LegacyRegistryKey -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host '  dihapus (nama lama): entri Settings > Apps'
}

if (-not (Test-Path $Target)) { throw "Missing launcher: $Target" }

# The icon is generated rather than committed, so build it on demand.
if (-not (Test-Path $IconPath)) {
  Write-Host 'Membuat ikon aplikasi...'
  Push-Location $Root
  try { & node (Join-Path $AppDir 'make-icon.mjs') | Out-Null }
  finally { Pop-Location }
}

function New-AppShortcut {
  param([string]$LinkPath)
  $parent = Split-Path -Parent $LinkPath
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($LinkPath)
  # wscript.exe (not cscript) so the VBS wrapper runs without a console host.
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $shortcut.Arguments = """$Target"""
  $shortcut.WorkingDirectory = $Root
  $shortcut.IconLocation = "$IconPath,0"
  $shortcut.Description = 'Konsol intelijen geospasial real-time - globe 3D, data langsung, kendali suara'
  $shortcut.WindowStyle = 7  # start minimised; the app window is a separate process
  $shortcut.Save()
  Write-Host "  $LinkPath"
}

Write-Host "Memasang $AppName..." -ForegroundColor Cyan

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-AppShortcut -LinkPath (Join-Path $startMenu "$AppName.lnk")

if (-not $NoDesktopShortcut) {
  # [Environment]::GetFolderPath honours a redirected (OneDrive) Desktop, which
  # a hardcoded $env:USERPROFILE\Desktop would miss.
  $desktop = [Environment]::GetFolderPath('Desktop')
  New-AppShortcut -LinkPath (Join-Path $desktop "$AppName.lnk")
}

# Registry record - this is what makes it a listed, uninstallable app rather
# than a loose shortcut.
if (-not (Test-Path $RegistryKey)) { New-Item -Path $RegistryKey -Force | Out-Null }
$uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $AppDir 'uninstall.ps1')`""
$version = '0.1.0'
try {
  $pkg = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
  if ($pkg.version) { $version = $pkg.version }
} catch { }

Set-ItemProperty -Path $RegistryKey -Name 'DisplayName'     -Value $AppName
Set-ItemProperty -Path $RegistryKey -Name 'DisplayVersion'  -Value $version
Set-ItemProperty -Path $RegistryKey -Name 'DisplayIcon'     -Value $IconPath
Set-ItemProperty -Path $RegistryKey -Name 'Publisher'       -Value 'Bilawal Sidhu (MIT)'
Set-ItemProperty -Path $RegistryKey -Name 'InstallLocation' -Value $Root
Set-ItemProperty -Path $RegistryKey -Name 'UninstallString' -Value $uninstallCommand
Set-ItemProperty -Path $RegistryKey -Name 'NoModify'        -Value 1 -Type DWord
Set-ItemProperty -Path $RegistryKey -Name 'NoRepair'        -Value 1 -Type DWord

Write-Host ''
Write-Host "$AppName terpasang." -ForegroundColor Green
Write-Host 'Buka lewat ikon Desktop, menu Start, atau cari "Map Monitoring".'
Write-Host "Copot pemasangan: app\uninstall.ps1 (atau Settings > Apps)."
