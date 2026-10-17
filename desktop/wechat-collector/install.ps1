$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$expectedVersion = '{{VERSION}}'
if ($expectedVersion -eq '{{VERSION}}') { $expectedVersion = [string]$manifest.version }
if ($manifest.version -ne $expectedVersion) { throw 'Unsupported package version.' }
$versionRegex = '{{VERSION_REGEX}}'
if ($versionRegex -eq '{{VERSION_REGEX}}') { $versionRegex = [regex]::Escape([string]$manifest.version) }
$requiredFree = [Math]::Max([int64]$manifest.bytes * 4, 1GB)
$candidates = @()
if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA 'Chengzi\WechatCollector' }
if ($env:TEMP) { $candidates += Join-Path $env:TEMP 'Chengzi\WechatCollector' }
foreach ($drive in [IO.DriveInfo]::GetDrives()) {
    if ($drive.DriveType -eq 'Fixed' -and $drive.IsReady) {
        $candidates += Join-Path $drive.RootDirectory.FullName ('Chengzi\WechatCollector\' + $env:USERNAME)
    }
}
$base = $null
foreach ($candidate in ($candidates | Select-Object -Unique)) {
    try {
        $path = [IO.Path]::GetFullPath($candidate)
        $existingExe = Join-Path $path (Join-Path $manifest.version 'ChengziWeChatCollector\ChengziWeChatCollector.exe')
        if ((Test-Path -LiteralPath $existingExe) -and
            (Get-FileHash -LiteralPath $existingExe -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.exeSha256) {
            $base = $path
            break
        }
        $disk = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($path))
        if (-not $disk.IsReady -or $disk.AvailableFreeSpace -lt $requiredFree) { continue }
        New-Item -ItemType Directory -Force -Path $path | Out-Null
        $probe = Join-Path $path ([IO.Path]::GetRandomFileName())
        [IO.File]::WriteAllText($probe, '')
        Remove-Item -LiteralPath $probe -Force
        $base = $path
        break
    } catch { continue }
}
if (-not $base) { throw '安装至少需要 1 GB 可用空间。请释放空间后重试，或将 ZIP 移到有空间的磁盘。' }
$runtimeTemp = Join-Path $base 'temp'
New-Item -ItemType Directory -Force -Path $runtimeTemp | Out-Null
$env:TEMP = $runtimeTemp
$env:TMP = $runtimeTemp
$env:CHENGZI_VOICE_DATA_DIR = Join-Path $base 'voice'
Write-Host ('安装位置：' + $base)
$install = [IO.Path]::GetFullPath((Join-Path $base $manifest.version))
if (-not $install.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation path.' }
New-Item -ItemType Directory -Force -Path $install | Out-Null
$exe = Join-Path $install 'ChengziWeChatCollector\ChengziWeChatCollector.exe'
if (Test-Path -LiteralPath $exe) {
    $existingHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($existingHash -ne $manifest.exeSha256) {
        Write-Host '检测到上次安装不完整，正在清理后重新下载。'
        Remove-Item -LiteralPath $install -Recurse -Force
        New-Item -ItemType Directory -Force -Path $install | Out-Null
    }
}
if (-not (Test-Path -LiteralPath $exe)) {
    $archive = Join-Path $install 'collector.zip'
    $archiveReady = (Test-Path -LiteralPath $archive) -and
        ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.sha256)
    if (-not $archiveReady) {
        Write-Host '正在下载成子电脑微信采集助手（无需安装 Python）。'
        $output = [IO.File]::Open($archive, [IO.FileMode]::Create, [IO.FileAccess]::Write)
        try {
            $partNumber = 0
            foreach ($part in $manifest.parts) {
                $partNumber++
                if ($part.name -notmatch ('^chengzi-wechat-collector-' + $versionRegex + '\.part[0-9]{2}\.bin$')) { throw 'Invalid part name.' }
                if ($part.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid checksum.' }
                $target = Join-Path $install $part.name
                $url = 'https://coach.lovetalk.love/downloads/' + $part.name
                Write-Host ("正在下载第 {0}/{1} 部分..." -f $partNumber, $manifest.parts.Count)
                Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $target -TimeoutSec 120
                $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($hash -ne $part.sha256) { throw 'Download verification failed. Please retry from the official website.' }
                Write-Host '校验通过。'
                $input = [IO.File]::OpenRead($target)
                try { $input.CopyTo($output) } finally { $input.Dispose() }
                Remove-Item -LiteralPath $target -Force
            }
        } finally { $output.Dispose() }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Package verification failed.' }
    } else { Write-Host '正在使用已校验的安装包。' }
    Expand-Archive -LiteralPath $archive -DestinationPath $install -Force
}
if (-not (Test-Path -LiteralPath $exe)) { throw 'Collector executable missing.' }
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.exeSha256) { throw 'Executable verification failed. Re-download the official package.' }
if (Test-Path -LiteralPath (Join-Path $install 'collector.zip')) { Remove-Item -LiteralPath (Join-Path $install 'collector.zip') -Force }
$process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Normal -PassThru
Start-Sleep -Milliseconds 800
if ($process.HasExited -and $process.ExitCode -ne 0) { throw ("助手启动后立即退出（错误码 {0}）。请把这个错误码发回。" -f $process.ExitCode) }
Write-Host '助手已启动。请在新窗口点击「打开网页并连接」。'

