# ============================================================
#  临时用：在电脑上启动服务器，手机连同一个 Wi-Fi 打开
#  双击运行；窗口不要关，用完按 Ctrl+C 或直接关窗口。
#  注意：这种方式手机必须和电脑在同一个 Wi-Fi，且电脑要开着。
# ============================================================
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
$node = @(
  (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source,
  (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
  'C:\Program Files\nodejs\node.exe'
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $node) {
  Write-Host '没找到 node，请改用「免费托管」方式（见 README.md）。' -ForegroundColor Red
  Read-Host '按回车关闭'
  exit 1
}
Write-Host '正在启动，下面的「局域网地址」用手机浏览器打开即可。' -ForegroundColor Cyan
Write-Host '（手机需与电脑在同一个 Wi-Fi）' -ForegroundColor DarkGray
Write-Host ''
& $node (Join-Path $root 'tools\serve.mjs') 8787
