$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '1.0.1') { throw 'Unsupported package version.' }
$base = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Chengzi\WechatCollector'))
$install = [IO.Path]::GetFullPath((Join-Path $base $manifest.version))
if (-not $install.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation path.' }
New-Item -ItemType Directory -Force -Path $install | Out-Null
$exe = Join-Path $install 'ChengziWeChatCollector\ChengziWeChatCollector.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host 'Downloading Chengzi WeChat Collector. Python is not required.'
    $archive = Join-Path $install 'collector.zip'
    $output = [IO.File]::Open($archive, [IO.FileMode]::Create, [IO.FileAccess]::Write)
    try {
        foreach ($part in $manifest.parts) {
            if ($part.name -notmatch '^chengzi-wechat-collector-1\.0\.1\.part[0-9]{2}\.bin$') { throw 'Invalid part name.' }
            if ($part.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid checksum.' }
            $target = Join-Path $install $part.name
            $url = 'https://coach.lovetalk.love/downloads/' + $part.name
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $target
            $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hash -ne $part.sha256) { throw 'Download verification failed. Please retry from the official website.' }
            $input = [IO.File]::OpenRead($target)
            try { $input.CopyTo($output) } finally { $input.Dispose() }
        }
    } finally { $output.Dispose() }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Package verification failed.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $install -Force
}
if (-not (Test-Path -LiteralPath $exe)) { throw 'Collector executable missing.' }
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.exeSha256) { throw 'Executable verification failed. Re-download the official package.' }
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Normal
