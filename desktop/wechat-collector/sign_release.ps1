<#
Prepare a NEW Windows release with a trusted Authenticode certificate.
Order: sign collector -> package signed payload -> build launcher -> sign launcher
-> verify both files -> write final checksums and signature.json.

This script never publishes files, creates a certificate, or changes Windows
trust settings. Use a fresh version directory; do not replace published assets.
Example:
  .\sign_release.ps1 -ReleaseDir .\dist\NEW_VERSION\release -Thumbprint ABC...
#>
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
    [string] $PythonPath = (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'),
    [string] $TimestampServer = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$release = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ReleaseDir)
$app = Join-Path (Split-Path -Parent $release) 'ChengziWeChatCollector'
$collector = Join-Path $app 'ChengziWeChatCollector.exe'
if (-not (Test-Path -LiteralPath $collector -PathType Leaf)) {
    throw "Build the collector first: $collector"
}
$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) { throw 'signtool.exe was not found. Install the Windows SDK on the release machine.' }
$python = Get-Command $PythonPath -ErrorAction SilentlyContinue
if (-not $python) { throw "Build Python was not found: $PythonPath" }
$signCommand = $signtool.Name
if ($signtool.CommandType -eq 'Application') { $signCommand = $signtool.Source }
$pythonCommand = $python.Name
if ($python.CommandType -eq 'Application') { $pythonCommand = $python.Source }

$keyArgs = @()
if ($PSCmdlet.ParameterSetName -eq 'Store') {
    $normalized = $Thumbprint.ToUpperInvariant()
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
        $_.Thumbprint -eq $normalized -and $_.HasPrivateKey
    } | Select-Object -First 1
    if (-not $cert) { throw "The CurrentUser certificate store has no private key for $normalized." }
    $keyArgs = @('/sha1', $normalized)
} else {
    if (-not (Test-Path -LiteralPath $PfxPath -PathType Leaf)) { throw "PFX was not found: $PfxPath" }
    # Do not call Get-PfxCertificate here: Windows PowerShell would ask for the
    # password again. SignTool validates the key and the trust chain below.
    $keyArgs = @('/f', (Resolve-Path -LiteralPath $PfxPath).Path, '/p',
        (New-Object PSCredential('signing', $PfxPassword)).GetNetworkCredential().Password)
}

function Assert-SignedFile([string] $Path) {
    & $signCommand verify '/pa' '/all' '/tw' $Path | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $Path" }
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or -not $signature.TimeStamperCertificate) {
        throw "A trusted, timestamped signature is required: $Path"
    }
    return $signature
}

function Set-ReleaseSignature([string] $Path) {
    & $signCommand sign '/fd' 'SHA256' '/td' 'SHA256' '/tr' $TimestampServer '/a' @keyArgs $Path | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Signing failed: $Path" }
    $null = Assert-SignedFile $Path
}

# Reject a completed release before signing so this cannot rewrite its files.
if (Test-Path -LiteralPath $release) {
    $existing = Get-ChildItem -LiteralPath $release -Filter 'ChengziWeChatCollector-Setup-*.exe' -File
    if ($existing) { throw 'This directory already contains a launcher. Use a fresh version/build directory; never replace a published release.' }
}
$null = New-Item -ItemType Directory -Path $release -Force
try {
    Set-ReleaseSignature $collector
    & $pythonCommand (Join-Path $PSScriptRoot 'package_release.py') '--app' $app '--require-signed'
    if ($LASTEXITCODE -ne 0) { throw 'Packaging the signed collector failed.' }
    $manifestPath = Join-Path $release 'manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.authenticode -ne 'signed') { throw 'The packaged collector signature was not verified.' }
    $collectorHash = (Get-FileHash -LiteralPath $collector -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($collectorHash -ne [string]$manifest.exeSha256) { throw 'Collector hash changed after packaging.' }

    & $pythonCommand (Join-Path $PSScriptRoot 'build_launcher.py') '--manifest' $manifestPath
    if ($LASTEXITCODE -ne 0) { throw 'Building the pinned-manifest launcher failed.' }
    $launcher = Join-Path $release ("ChengziWeChatCollector-Setup-{0}.exe" -f $manifest.version)
    $checksum = [IO.Path]::ChangeExtension($launcher, '.sha256.txt')
    # build_launcher writes a checksum for its unsigned output. Remove that
    # intermediate checksum before signing, including on a signing failure.
    if (Test-Path -LiteralPath $checksum) { Remove-Item -LiteralPath $checksum }
    Set-ReleaseSignature $launcher

    $innerSignature = Assert-SignedFile $collector
    $outerSignature = Assert-SignedFile $launcher
    if ($innerSignature.SignerCertificate.Thumbprint -ne $outerSignature.SignerCertificate.Thumbprint) {
        throw 'The collector and launcher were signed by different certificates.'
    }
    if ((Get-FileHash -LiteralPath $collector -Algorithm SHA256).Hash.ToLowerInvariant() -ne $collectorHash) {
        throw 'The signed collector changed after packaging.'
    }
    $launcherHash = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($checksum, "$launcherHash  $([IO.Path]::GetFileName($launcher))`n", [Text.Encoding]::ASCII)
    $proof = [ordered]@{
        version = $manifest.version
        authenticode = 'signed'
        publisher = $outerSignature.SignerCertificate.Subject
        certificateThumbprint = $outerSignature.SignerCertificate.Thumbprint
        collectorSha256 = $collectorHash
        installerSha256 = $launcherHash
        installerBytes = (Get-Item -LiteralPath $launcher).Length
    }
    [IO.File]::WriteAllText((Join-Path $release 'signature.json'), ($proof | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Signed release verified. Publish these exact files under a new version and pin their final SHA-256 values. Do not rebuild the launcher after signing.'
} finally {
    $keyArgs = @()
}
