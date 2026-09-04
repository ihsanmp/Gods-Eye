<#
  God's Eye View - desktop launcher.

  Starts the app's own server, then opens it in a chromeless browser window so
  it behaves like an installed application rather than a tab.

  Why a server at all: this app's backend IS the Vite dev server. All 21 API
  proxies in vite.config.js broker the secret-bearing providers (OpenAI,
  AISStream, TomTom, FIRMS, OpenSky) and only 9 of them also register
  configurePreviewServer - so a static `vite build` output would come up with
  most live layers dead. `vite` in dev mode is the only mode where the whole
  application exists.

  The window is a real browser in --app mode against a DEDICATED profile
  directory: no tab strip, no address bar, its own taskbar entry, and closing it
  never touches the user's own browsing session.

  Run by GodsEyeView.vbs (which hides the console). Safe to run directly for
  troubleshooting - pass -Verbose to watch it work.
#>

[CmdletBinding()]
param(
  # Matches the port the project's own docs and dev scripts use.
  [int]$Port = 4173,
  # Seconds to wait for the server to answer before giving up.
  [int]$StartupTimeoutSec = 90
)

$ErrorActionPreference = 'Stop'

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $AppDir
$LogFile = Join-Path $AppDir 'launcher.log'
$ServerOutLog = Join-Path $AppDir 'server.log'
$ServerErrLog = Join-Path $AppDir 'server.err.log'
$ProfileDir = Join-Path $AppDir 'browser-profile'
$IconPath = Join-Path $AppDir 'GodsEyeView.ico'
$Url = "http://localhost:$Port/"

function Write-Log {
  param([string]$Message)
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $LogFile -Value $line -Encoding utf8
  Write-Verbose $Message
}

# The console is hidden, so a fatal problem has to surface somewhere the user
# will actually see it. Anything that stops the app from starting ends here.
function Stop-WithMessage {
  param([string]$Message)
  Write-Log "FATAL: $Message"
  # The splash is TopMost, so it would sit over the error dialog and hide the
  # one thing the user needs to read.
  if ($script:splash) { Close-Splash $script:splash; $script:splash = $null }
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "$Message`n`nDetail lengkap: $LogFile",
    "God's Eye View",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

function Test-PortOpen {
  param([int]$TestPort)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $TestPort, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(250)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-ServerReady {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# Chrome first (its Cesium/WebGL path is the one the project develops against),
# Edge as the always-present Windows fallback.
function Find-Browser {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

<#
  Splash while the server boots.

  Cold start is a few seconds and the launcher is deliberately invisible, so
  without this the icon is clicked and nothing happens at all - which reads as a
  failed launch and invites a second click. The splash is the app saying "heard
  you". It is best-effort by design: any failure here returns $null and the
  launch continues unaffected, because a decoration must never be able to stop
  the application from starting.
#>
function New-Splash {
  param([string]$IconFile)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.Size = New-Object System.Drawing.Size(380, 132)
    # Same ground the app itself paints, so the splash reads as its first frame
    # rather than as a separate dialog.
    $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#0C1316')
    $form.TopMost = $true
    $form.ShowInTaskbar = $false

    if (Test-Path $IconFile) {
      $picture = New-Object System.Windows.Forms.PictureBox
      $picture.Image = ([System.Drawing.Icon]::new($IconFile, 48, 48)).ToBitmap()
      $picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
      $picture.Location = New-Object System.Drawing.Point(28, 40)
      $picture.Size = New-Object System.Drawing.Size(48, 48)
      $picture.BackColor = [System.Drawing.Color]::Transparent
      $form.Controls.Add($picture)
    }

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "GOD'S EYE VIEW"
    $title.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
    $title.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#DCE7EA')
    $title.Location = New-Object System.Drawing.Point(96, 40)
    $title.Size = New-Object System.Drawing.Size(260, 26)
    $title.BackColor = [System.Drawing.Color]::Transparent
    $form.Controls.Add($title)

    $status = New-Object System.Windows.Forms.Label
    $status.Text = 'Menyalakan sistem...'
    $status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    # The app's own cyan, so the one moving element on screen is recognisably it.
    $status.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#5FD1E4')
    $status.Location = New-Object System.Drawing.Point(98, 68)
    $status.Size = New-Object System.Drawing.Size(260, 20)
    $status.BackColor = [System.Drawing.Color]::Transparent
    $form.Controls.Add($status)

    $form.Show()
    $form.Refresh()
    return [pscustomobject]@{ Form = $form; Status = $status }
  } catch {
    Write-Log "splash unavailable: $($_.Exception.Message)"
    return $null
  }
}

# DoEvents is what actually paints it: the wait loop below never returns to a
# message pump of its own, so without this the window would render as a white
# rectangle.
function Update-Splash {
  param($Splash, [string]$Text)
  if (-not $Splash) { return }
  try {
    if ($Text) { $Splash.Status.Text = $Text }
    [System.Windows.Forms.Application]::DoEvents()
  } catch { }
}

function Close-Splash {
  param($Splash)
  if (-not $Splash) { return }
  try { $Splash.Form.Close(); $Splash.Form.Dispose() } catch { }
}

Write-Log "--- launch requested (port $Port) ---"

# --- preflight -------------------------------------------------------------

$viteBin = Join-Path $Root 'node_modules\vite\bin\vite.js'
if (-not (Test-Path $viteBin)) {
  Stop-WithMessage "Dependensi belum terpasang.`n`nJalankan 'npm install' di $Root lalu coba lagi."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Stop-WithMessage "Node.js tidak ditemukan di PATH.`n`nPasang Node.js lalu coba lagi."
}
Write-Log "node: $($node.Source)"

$envFile = Join-Path $Root '.env'
if (-not (Test-Path $envFile)) {
  Stop-WithMessage "Berkas .env tidak ada di $Root.`n`nSalin .env.example menjadi .env dan isi GOOGLE_MAPS_API_KEY."
}
if (-not (Select-String -Path $envFile -Pattern '^\s*GOOGLE_MAPS_API_KEY\s*=\s*\S' -Quiet)) {
  Stop-WithMessage "GOOGLE_MAPS_API_KEY belum diisi di .env.`n`nGlobe 3D tidak bisa dimuat tanpa kunci itu."
}

$browser = Find-Browser
if (-not $browser) {
  Stop-WithMessage "Chrome atau Edge tidak ditemukan.`n`nSalah satunya diperlukan untuk jendela aplikasi."
}
Write-Log "browser: $browser"

# --- server ----------------------------------------------------------------

# Reuse a server that is already up. Double-clicking the icon twice should raise
# a second window against one server, not fight over the port.
$serverProcess = $null
$startedServer = $false
$splash = $null

if (Test-PortOpen -TestPort $Port) {
  Write-Log "port $Port already in use - reusing the running server"
} else {
  # Only on a cold start. Reusing a live server reaches the window almost
  # immediately, and a splash that flashes for 200 ms is worse than none.
  $splash = New-Splash -IconFile $IconPath
  Write-Log "starting vite dev server"
  # Vite is started directly rather than through `npm run dev` so there is one
  # process to wait on and one process tree to stop. vite.config.js loads .env
  # itself, so nothing is lost by skipping npm.
  $serverProcess = Start-Process -FilePath $node.Source `
    -ArgumentList @("`"$viteBin`"", '--host', 'localhost', '--port', "$Port") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ServerOutLog `
    -RedirectStandardError $ServerErrLog `
    -PassThru
  $startedServer = $true
  Write-Log "server pid $($serverProcess.Id)"
}

try {
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($startedServer -and $serverProcess.HasExited) {
      $tail = ''
      if (Test-Path $ServerErrLog) { $tail = (Get-Content $ServerErrLog -Tail 8) -join "`n" }
      Stop-WithMessage "Server berhenti saat memulai.`n`n$tail"
    }
    if (Test-ServerReady) { $ready = $true; break }
    # Two phases, because they fail for different reasons and the wait is worth
    # naming: the port opening means Vite booted, the first 200 means the app is
    # actually servable.
    if (Test-PortOpen -TestPort $Port) { Update-Splash $splash 'Menyiapkan globe...' }
    else { Update-Splash $splash 'Menyalakan sistem...' }
    Start-Sleep -Milliseconds 250
  }

  if (-not $ready) {
    Stop-WithMessage "Server tidak merespons dalam $StartupTimeoutSec detik di $Url."
  }
  Write-Log "server ready at $Url"
  Update-Splash $splash 'Membuka jendela...'

  # --- window --------------------------------------------------------------

  if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
  }

  # A dedicated --user-data-dir is what makes this its own application: separate
  # taskbar entry and window state, and quitting it cannot close the user's
  # ordinary browser windows.
  $browserArgs = @(
    "--app=$Url",
    "--user-data-dir=`"$ProfileDir`"",
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter'
  )

  Write-Log "opening application window"
  $window = Start-Process -FilePath $browser -ArgumentList $browserArgs -PassThru
  # Hold the splash across Chrome's own start-up so the screen never goes empty
  # between the two. Pumped, not slept, so it stays painted rather than freezing.
  $handover = (Get-Date).AddSeconds(2.5)
  while ((Get-Date) -lt $handover -and -not $window.HasExited) {
    Update-Splash $splash
    Start-Sleep -Milliseconds 100
  }
  Close-Splash $splash
  $splash = $null

  $window.WaitForExit()
  Write-Log "window closed"
}
finally {
  # A splash still up here means the launch failed on a path that skipped the
  # handover; leaving it would strand a borderless TopMost window on screen with
  # no way to close it.
  Close-Splash $splash

  # Only stop what this launcher started. A server that was already running
  # belongs to another window (or to `npm run dev` in a terminal).
  if ($startedServer -and $serverProcess -and -not $serverProcess.HasExited) {
    Write-Log "stopping server pid $($serverProcess.Id)"
    # /T because Vite may hold child processes; /F because it has no console to
    # receive a graceful signal.
    Start-Process -FilePath 'taskkill.exe' `
      -ArgumentList @('/PID', $serverProcess.Id, '/T', '/F') `
      -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue
  }
  Write-Log "--- session ended ---"
}
