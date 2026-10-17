param([switch]$Languages,[string]$ImagePath,[string]$Language="zh-Hans-CN")
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$bitmap = $null
$stream = $null
$failureCode = "OCR_UNAVAILABLE"
try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 $null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
 $null = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
 $items = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { @{tag=$_.LanguageTag;displayName=$_.DisplayName} })
 if ($Languages) {
  @{ok=$true;languages=$items;maxImageDimension=[Windows.Media.Ocr.OcrEngine]::MaxImageDimension} | ConvertTo-Json -Depth 8 -Compress
  exit 0
 }
 $failureCode = "OCR_LANGUAGE_UNAVAILABLE"
 $selected = @($items | Where-Object { $_.tag -ieq $Language })
 if ($selected.Count -eq 0) { throw "The requested OCR language is not installed." }
 $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language($selected[0].tag)))
 if ($null -eq $engine) { throw "The requested OCR engine could not be created." }
 $failureCode = "OCR_DECODE_FAILED"
 $null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
 $null = [Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
 $null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
 $null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
 $asTask = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like "IAsyncOperation*"
 })[0]
 function Await-Result($operation,[Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null,@($operation))
  if (-not $task.Wait(15000)) { throw "The Windows OCR operation timed out." }
  return $task.Result
 }
 $file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
 $stream = Await-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
 $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 if ($decoder.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $decoder.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) {
  $failureCode = "OCR_IMAGE_TOO_LARGE"
  throw "The supplied image exceeds the Windows OCR size limit."
 }
 $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
 $failureCode = "OCR_RECOGNITION_FAILED"
 $result = Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
 $lines = @()
 foreach ($line in $result.Lines) {
  $words = @()
  $left = [double]::PositiveInfinity
  $top = [double]::PositiveInfinity
  $right = 0.0
  $bottom = 0.0
  foreach ($word in $line.Words) {
   $rect = $word.BoundingRect
   $words += @{text=$word.Text;bbox=@{x=[double]$rect.X;y=[double]$rect.Y;width=[double]$rect.Width;height=[double]$rect.Height}}
   $left = [Math]::Min($left,$rect.X)
   $top = [Math]::Min($top,$rect.Y)
   $right = [Math]::Max($right,$rect.X+$rect.Width)
   $bottom = [Math]::Max($bottom,$rect.Y+$rect.Height)
  }
  if ($words.Count -gt 0) { $lines += @{text=$line.Text;bbox=@{x=$left;y=$top;width=$right-$left;height=$bottom-$top};words=$words} }
 }
 @{ok=$true;text=$result.Text;language=$engine.RecognizerLanguage.LanguageTag;textAngle=$result.TextAngle;width=[int]$bitmap.PixelWidth;height=[int]$bitmap.PixelHeight;lines=$lines} | ConvertTo-Json -Depth 12 -Compress
} catch {
 @{ok=$false;error=@{code=$failureCode;message=$_.Exception.Message}} | ConvertTo-Json -Depth 5 -Compress
 exit 1
} finally {
 if ($null -ne $bitmap) { $bitmap.Dispose() }
 if ($null -ne $stream) { $stream.Dispose() }
}
