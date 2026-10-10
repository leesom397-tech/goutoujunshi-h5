param([switch]$SkipCompile)
$ErrorActionPreference='Stop'
$czProject=(Resolve-Path 'miniapp').Path
$czOutput=Join-Path (Get-Location).Path 'outputs/design-refresh'
$czChecks=[System.Collections.Generic.List[object]]::new()
function Invoke-CzIde([string]$czTool,[string[]]$czArguments) {
  $czRaw=(& wechatide -c Codex $czTool @czArguments 2>&1 | Out-String)
  $czIndex=$czRaw.IndexOf('{')
  if ($czIndex -lt 0) { throw "No JSON result for $czTool" }
  $czValue=$czRaw.Substring($czIndex) | ConvertFrom-Json
  if (!$czValue.ok -or !$czValue.result.success) { throw "$czTool failed: $($czValue.message) $($czValue.result.error)" }
  return $czValue.result
}
$czPages=@('home','quick','social-profile','chat','voice','report','archive','person-new','account')
if (!$SkipCompile) {
  foreach ($czPage in $czPages) {
    foreach ($czKind in @('wxml','wxss')) {
      $null=Invoke-CzIde "compile_$czKind" @('--project',$czProject,'--file-path',"pages/$czPage/index.$czKind")
      $czChecks.Add(@{check="compile $czPage $czKind";passed=$true})
    }
    Write-Output "Compiled $czPage"
  }
}
foreach ($czPage in $czPages) {
  $null=Invoke-CzIde 'automation_navigate' @('--project',$czProject,'--action','reLaunch','--url',"/pages/$czPage/index")
  $czFile=Join-Path $czOutput "miniapp-daylight-$czPage.png"
  $null=Invoke-CzIde 'simulator_screenshot' @('--project',$czProject,'--path',$czFile,'--optimize','false','--wait','1')
  $czRoute=Invoke-CzIde 'automation_runtime_info' @('--project',$czProject,'--action','currentPage')
  if ($czRoute.currentPage.path -ne "pages/$czPage/index") { throw "Wrong page for $czPage" }
  $czChecks.Add(@{check="actual runtime $czPage";passed=$true;screenshot=$czFile})
  Write-Output "Captured $czPage"
}
@{checkedAt=[DateTime]::UtcNow.ToString('o');nativeSimulator=$true;paidModelCalls=$false;checks=$czChecks} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $czOutput 'miniapp-daylight-qa.json') -Encoding utf8
Write-Output "PASS: $($czChecks.Count) native compile and page checks."
