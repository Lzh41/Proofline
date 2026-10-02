# 刷新 Proofline 快捷方式：开始菜单 + G 盘「1桌面应用」
#
# 用法（任选其一）：
#   1) 资源管理器里右键本文件 →「使用 PowerShell 运行」
#   2) powershell -ExecutionPolicy Bypass -File .\scripts\refresh-proofline-shortcuts.ps1
#
# 说明：两个快捷方式指向的都是构建产物 G:\Codex\xiti\src-tauri\target\release\proofline.exe，
# 重新打包后 exe 会被就地覆盖，因此快捷方式无需改路径；本脚本用于强制刷新目标、
# 图标与工作目录（解决图标缓存陈旧、属性缺失等问题），或改为指向安装包部署的副本。

$ErrorActionPreference = 'Stop'

$target = 'G:\Codex\xiti\src-tauri\target\release\proofline.exe'
$workDir = 'G:\Codex\xiti\src-tauri\target\release'
$shortcuts = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Proofline.lnk'),
  'G:\1桌面应用\Proofline.lnk',
  'G:\Codex\1桌面应用\Proofline.lnk'
)

if (-not (Test-Path $target)) { throw "找不到构建产物：$target" }

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $shortcuts) {
  if (-not (Test-Path $path)) {
    Write-Host "跳过（文件不存在）：$path"
    continue
  }
  $link = $shell.CreateShortcut($path)
  $before = $link.TargetPath
  $link.TargetPath = $target
  # 已有工作目录时保持原样，避免改变应用的相对路径解析行为
  if (-not $link.WorkingDirectory) { $link.WorkingDirectory = $workDir }
  $link.IconLocation = "$target,0"
  if (-not $link.Description) { $link.Description = 'Proofline 学习工作台' }
  $link.Save()
  Write-Host "已更新：$path"
  Write-Host "   目标：$before  ->  $target"
}

Write-Host '完成：快捷方式已刷新到最新构建产物。'
