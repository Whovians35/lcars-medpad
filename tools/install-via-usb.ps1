# ============================================================
#  一键装到安卓手机（数据线方式，不需要任何账号）
#
#  用法：右键本文件 →「使用 PowerShell 运行」
#        或在终端里执行：powershell -ExecutionPolicy Bypass -File tools\install-via-usb.ps1
#
#  它做四件事：
#   1) 需要的话自动下载 adb（约 8MB，只下一次）
#   2) 启动本机小服务器
#   3) 用 adb reverse 把手机的 localhost:8787 接到电脑上
#   4) 在手机浏览器里打开，之后点「添加到主屏幕」
#
#  装好并离线缓存之后，拔掉数据线、关掉电脑，手机照样能用。
# ============================================================
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
$port = 8787
$tools = Join-Path $root 'tools'
$ptDir = Join-Path $tools 'platform-tools'
$adb = Join-Path $ptDir 'adb.exe'

function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m) { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Die($m) { Write-Host $m -ForegroundColor Red; Read-Host '按回车关闭'; exit 1 }

Write-Host ''
Write-Host '  LCARS 用药助手 · 装到安卓手机' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------'
Write-Host ''

# ---------- 1. 找 node ----------
Info '[1/5] 查找 node...'
$nodeCandidates = @(
  (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source,
  (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
  'C:\Program Files\nodejs\node.exe'
) | Where-Object { $_ -and (Test-Path $_) }
if (-not $nodeCandidates) { Die ' 没有找到 node，无法启动服务器。请改用「免费托管」方式（见 README.md）。' }
$node = $nodeCandidates[0]
Ok ("     node: " + $node)

# ---------- 2. 准备 adb ----------
Info '[2/5] 准备 adb...'
$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
if ($adbCmd -and -not (Test-Path $adb)) { $adb = $adbCmd.Source }
if (-not (Test-Path $adb)) {
  $zip = Join-Path $tools 'platform-tools.zip'
  $js = @'
const https = require("https"), fs = require("fs");
const url = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";
const out = process.argv[1];
const f = fs.createWriteStream(out);
https.get(url, res => {
  if (res.statusCode !== 200) { console.error("HTTP " + res.statusCode); process.exit(1); }
  let got = 0;
  res.on("data", d => { got += d.length; process.stdout.write("\r     downloading " + (got / 1048576).toFixed(1) + " MB"); });
  res.pipe(f);
  f.on("finish", () => { console.log("\r     downloaded " + (got / 1048576).toFixed(1) + " MB"); process.exit(0); });
}).on("error", e => { console.error("download failed: " + e.message); process.exit(1); });
'@
  Warn '     本机还没有 adb，正在下载官方 platform-tools（约 8MB）...'
  & $node -e $js $zip
  if ($LASTEXITCODE -ne 0) {
    Warn '     下载失败。可以手动下载后解压到 tools\platform-tools\：'
    Warn '     https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
    Read-Host '按回车关闭'
    exit 1
  }
  Expand-Archive -Path $zip -DestinationPath $tools -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path $adb)) { Die ' 解压后没找到 adb.exe，请检查 tools\platform-tools\ 目录。' }
Ok '     adb 就绪'

# ---------- 3. 启动服务器 ----------
Info "[3/5] 启动本机服务器（端口 $port）..."
$srv = Start-Process -FilePath $node -ArgumentList @((Join-Path $tools 'serve.mjs'), "$port") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
if ($srv.HasExited) { Die ' 服务器没能启动（端口可能被占用）。换个端口：node tools\serve.mjs 8790' }
Ok '     服务器已启动'

try {
  # ---------- 4. 等手机 ----------
  Info '[4/5] 等待手机连接...'
  Write-Host '     请确认手机上已做这两件事：'
  Write-Host '       1. 设置 → 关于手机 → 连点「版本号」7 次，打开开发者选项'
  Write-Host '       2. 开发者选项 → 打开「USB 调试」，然后插上数据线'
  Write-Host ''
  & $adb start-server 2>&1 | Out-Null
  $seen = $false
  for ($i = 0; $i -lt 90; $i++) {
    $lines = & $adb devices 2>&1
    $dev = $lines | Where-Object { $_ -match '\tdevice$' }
    $unauth = $lines | Where-Object { $_ -match 'unauthorized' }
    if ($unauth) {
      Warn '     手机已连上，但还没授权。请在手机屏幕上点「允许」（勾选「始终允许」）。'
      Start-Sleep -Seconds 2
      continue
    }
    if ($dev) { $seen = $true; break }
    if ($i -eq 0) { Write-Host '     （等待中，插上数据线后会自动继续...）' }
    Start-Sleep -Seconds 1
  }
  if (-not $seen) {
    Warn '     没有检测到已授权的手机。'
    Warn '     常见原因：没开 USB 调试 / 数据线只能充电 / 手机弹窗没点「允许」。'
    Read-Host '按回车关闭'
    exit 1
  }
  Ok '     手机已连接'

  # ---------- 5. 接到手机 + 打开 ----------
  Info "[5/5] 建立通道并在手机上打开..."
  & $adb reverse --remove-all 2>&1 | Out-Null
  & $adb reverse "tcp:$port" "tcp:$port" 2>&1 | Out-Null
  $rev = & $adb reverse --list 2>&1
  if (-not ($rev -match "tcp:$port")) { Warn '     通道建立失败，可以改用「免费托管」方式。' }
  else { Ok "     localhost:$port 已接到电脑" }

  & $adb shell am start -a android.intent.action.VIEW -d "http://localhost:$port/" 2>&1 | Out-Null
  Ok '     已在手机上打开。若没自动跳出浏览器，请手动打开 Chrome，输入：' 
  Write-Host "        http://localhost:$port/" -ForegroundColor White
  Write-Host ''
  Write-Host '  接下来在手机上：' -ForegroundColor Yellow
  Write-Host '    1. 等页面出现 LCARS 界面（第一次要加载几秒）'
  Write-Host '    2. 点浏览器右上角菜单 →「添加到主屏幕 / 安装应用」'
  Write-Host '    3. 从桌面图标打开一次，等 3 秒（让离线缓存落盘）'
  Write-Host '    4. 之后就可以拔掉数据线、关掉电脑了 —— 完全离线可用'
  Write-Host ''
  Write-Host '  注意：Chrome 的「添加到主屏幕」在 http://localhost 下才允许安装，' -ForegroundColor DarkGray
  Write-Host '        用别的手机/别的电脑时 IP 会变，所以推荐始终用数据线这一步。' -ForegroundColor DarkGray
  Write-Host ''
  Read-Host '  在手机上装好之后，回到这里按回车关闭服务器'
}
finally {
  if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
  try { & $adb kill-server 2>&1 | Out-Null } catch {}
  Write-Host '  已关闭。手机里的 App 不受影响。' -ForegroundColor Green
  Start-Sleep -Seconds 1
}
