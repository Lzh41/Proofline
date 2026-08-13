$ErrorActionPreference = 'Stop'

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio Installer was not found.'
}

$vsPath = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
  throw 'Visual Studio C++ x64 tools were not found.'
}

$devShell = Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
$processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
if (-not $processPath) {
  $processPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
}
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
if ($processPath) {
  [Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
}

Import-Module $devShell
Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation -DevCmdArguments '-no_logo -arch=x64 -host_arch=x64'

$rustBin = Join-Path $env:USERPROFILE '.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin'
$cargo = Join-Path $rustBin 'cargo.exe'
if (-not (Test-Path -LiteralPath $cargo)) {
  throw 'Rust stable-msvc was not found.'
}

$env:Path = "$rustBin;$env:USERPROFILE\.cargo\bin;$env:Path"
& $cargo @args
exit $LASTEXITCODE
