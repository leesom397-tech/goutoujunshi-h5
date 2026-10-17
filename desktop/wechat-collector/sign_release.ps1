<##
Sign a finished Windows collector release with Authenticode.

SmartScreen warnings are caused by an unsigned or low-reputation publisher;
there is no safe code-only switch that disables that warning.  This script is
deliberately opt-in and requires a certificate issued by a trusted CA (or
Microsoft Artifact Signing).  It never creates a self-signed certificate and
never changes Defender settings.

Example (certificate already installed in CurrentUser\\My):
  .\\sign_release.ps1 -ReleaseDir .\\dist\\1.2.4\\release -Thumbprint ABC...

Example (PFX supplied by CI secret):
  .\\sign_release.ps1 -ReleaseDir .\\dist\\1.2.4\\release `
      -PfxPath .\\signing\\chengzi.pfx -PfxPassword (Read-Host -AsSecureString)

Run this after building the collector EXE and launcher EXE, before publishing
the ZIP/manifest.  The manifest hashes are recomputed after signing.
##>

[CmdletBinding(DefaultParameterSetName = 'Store')]
param(
    [Parameter(Mandatory = $true)]
    [string] $ReleaseDir,

    [Parameter(ParameterSetName = 'Store', Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string] $Thumbprint,

    [Parameter(ParameterSetName = 'Pfx', Mandatory = $true)]
    [string] $PfxPath,

    [Parameter(ParameterSetName = 'Pfx', Mandatory = $true)]
    [Security.SecureString] $PfxPassword,

    [string] $TimestampServer = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
$release = (Resolve-Path -LiteralPath $ReleaseDir).Path
$manifestPath = Join-Path $release 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "找不到 manifest.json：$release" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
    throw '找不到 signtool.exe。请安装 Windows SDK，或在 CI 中提供 Microsoft Artifact Signing。'
}

$cert = $null
$pfxArgs = @()
if ($PSCmdlet.ParameterSetName -eq 'Store') {
    $normalized = $Thumbprint.Replace(' ', '').ToUpperInvariant()
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
        $_.Thumbprint -eq $normalized -and $_.HasPrivateKey
    } | Select-Object -First 1
    if (-not $cert) { throw "当前用户证书库中没有带私钥的证书：$normalized" }
    $pfxArgs = @('/sha1', $normalized)
} else {
    if (-not (Test-Path -LiteralPath $PfxPath -PathType Leaf)) { throw "找不到 PFX：$PfxPath" }
    $cert = Get-PfxCertificate -FilePath (Resolve-Path -LiteralPath $PfxPath)
    if (-not $cert) { throw '无法读取 PFX 证书。' }
    $pfxArgs = @('/f', (Resolve-Path -LiteralPath $PfxPath).Path, '/p', (New-Object PSCredential('x', $PfxPassword)).GetNetworkCredential().Password)
}

$targets = @(
    (Get-ChildItem -LiteralPath $release -Filter '*.exe' -File),
    (Get-ChildItem -LiteralPath (Join-Path $release '..') -Filter '*.exe' -File -ErrorAction SilentlyContinue)
) | Where-Object { $_ } | Sort-Object FullName -Unique
if (-not $targets) { throw '发布目录没有可签名的 EXE。' }
foreach ($target in $targets) {
    $arguments = @('sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', $TimestampServer, '/a') + $pfxArgs + @($target.FullName)
    & $signtool.Source @arguments
    if ($LASTEXITCODE -ne 0) { throw "签名失败：$($target.Name)" }
    & $signtool.Source verify '/pa' '/all' $target.FullName
    if ($LASTEXITCODE -ne 0) { throw "签名校验失败：$($target.Name)" }
}

# Signing changes the inner collector executable and the outer launcher.  The
# release manifest must therefore be rebuilt after signing; package_release.py
# also recreates the archive parts and bootstrap ZIP from these files.
$app = Join-Path (Join-Path $release '..') 'ChengziWeChatCollector'
$collector = Join-Path $app 'ChengziWeChatCollector.exe'
if (-not (Test-Path -LiteralPath $collector)) {
    Write-Host '未找到内层 collector EXE，跳过重新打包；请手动运行 package_release.py。'
} else {
    $hash = (Get-FileHash -LiteralPath $collector -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([string]$manifest.exeSha256 -ne $hash) {
        Write-Host '内层 EXE 已签名。请重新运行 package_release.py 和 build_launcher.py，再发布新的 manifest。'
    }
}
Write-Host '签名完成。下一步：重新 package_release.py → build_launcher.py → 上传新的 manifest、ZIP 和 parts。'
