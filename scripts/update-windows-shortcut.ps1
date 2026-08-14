$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$shortcutName = "samuel" + [char]0x7684 + [char]0x5DE5 + [char]0x4F5C + [char]0x53F0 + ".lnk"
$batchName = [string]([char]0x542F) + [char]0x52A8 + [char]0x6728 + [char]0x5B50 + [char]0x5DE5 + [char]0x4F5C + [char]0x53F0 + ".bat"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) $shortcutName
$batchPath = Join-Path $projectRoot $batchName
$iconPath = Join-Path $projectRoot "public\assets\app\muzi-workspace-v2.ico"

if (-not (Test-Path -LiteralPath $batchPath)) {
  throw "Launcher not found: $batchPath"
}
if (-not (Test-Path -LiteralPath $iconPath)) {
  throw "Icon not found: $iconPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot "System32\cmd.exe"
$shortcut.Arguments = "/c `"$batchPath`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "Open samuel workspace"
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Save()

Write-Output "Updated desktop shortcut: $shortcutPath"
