param(
  [ValidateSet('dev', 'build', 'build-app')]
  [string]$Mode = 'dev'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsPath = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
  throw 'Visual Studio C++ x64 tools were not found.'
}

$processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
if (-not $processPath) {
  $processPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
}
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
if ($processPath) {
  [Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
}

Import-Module (Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation -DevCmdArguments '-no_logo -arch=x64 -host_arch=x64'

$rustBin = Join-Path $env:USERPROFILE '.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin'
$env:Path = "$rustBin;$env:USERPROFILE\.cargo\bin;$env:Path"
Set-Location $projectRoot

if ($Mode -eq 'build') {
  & npm.cmd run tauri:build
} elseif ($Mode -eq 'build-app') {
  & npm.cmd run tauri -- build --no-bundle
} else {
  & npm.cmd run tauri:dev
}

$commandExitCode = $LASTEXITCODE
if ($commandExitCode -ne 0) {
  exit $commandExitCode
}

if ($Mode -in @('build', 'build-app')) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify-windows-icon.ps1')
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

exit 0
