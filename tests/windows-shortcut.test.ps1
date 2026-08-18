$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$shortcutName = "samuel" + [char]0x7684 + [char]0x5DE5 + [char]0x4F5C + [char]0x53F0 + ".lnk"
$batchName = [string]([char]0x542F) + [char]0x52A8 + [char]0x6728 + [char]0x5B50 + [char]0x5DE5 + [char]0x4F5C + [char]0x53F0 + ".bat"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) $shortcutName
$batchPath = Join-Path $projectRoot $batchName
$iconPath = Join-Path $projectRoot "public\assets\app\muzi-workspace-v2.ico"

if (-not (Test-Path -LiteralPath $shortcutPath)) {
  throw "Desktop shortcut not found: $shortcutPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$expectedTarget = Join-Path $env:SystemRoot "System32\cmd.exe"
$expectedArguments = "/c `"$batchPath`""
$expectedIcon = "$iconPath,0"

if ($shortcut.TargetPath -ne $expectedTarget) {
  throw "Unexpected target: $($shortcut.TargetPath)"
}
if ($shortcut.Arguments -ne $expectedArguments) {
  throw "Unexpected arguments: $($shortcut.Arguments)"
}
if ($shortcut.WorkingDirectory -ne $projectRoot) {
  throw "Unexpected working directory: $($shortcut.WorkingDirectory)"
}
if ($shortcut.IconLocation -ne $expectedIcon) {
  throw "Unexpected icon location: $($shortcut.IconLocation)"
}

Write-Output "Desktop shortcut target, arguments, working directory, and icon are correct."
