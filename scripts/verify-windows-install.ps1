# A disposable per-user NSIS installation, never the developer's installation.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot "../apps/desktop/release/Capsule-$env:CAPSULE_WINDOWS_VERSION-x64-setup.exe"
if (-not (Test-Path -LiteralPath $installer)) { throw "Installer not found: $installer" }
$installDir = Join-Path ([System.IO.Path]::GetTempPath()) ("capsule-install-" + [guid]::NewGuid().ToString())
$install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Installer exited $($install.ExitCode)" }
try {
  $env:CAPSULE_SMOKE_EXECUTABLE = Join-Path $installDir 'Capsule.exe'
  node (Join-Path $PSScriptRoot 'smoke-test.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Installed Windows app failed its startup test' }
} finally {
  Remove-Item Env:CAPSULE_SMOKE_EXECUTABLE -ErrorAction SilentlyContinue
  $uninstaller = Join-Path $installDir 'Uninstall Capsule.exe'
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Installer did not create an uninstaller' }
  # _?= keeps NSIS in this process so -Wait covers the actual uninstall.
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installDir") -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited $($uninstall.ExitCode)" }
  if (Test-Path -LiteralPath (Join-Path $installDir 'Capsule.exe')) { throw 'Uninstall left the app executable behind' }
}
