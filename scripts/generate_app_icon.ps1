Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot "..\build"
$outputPath = Join-Path $outputDirectory "icon.png"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 1024, 1024
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$backgroundPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$backgroundPath.AddArc(0, 0, 352, 352, 180, 90)
$backgroundPath.AddArc(672, 0, 352, 352, 270, 90)
$backgroundPath.AddArc(672, 672, 352, 352, 0, 90)
$backgroundPath.AddArc(0, 672, 352, 352, 90, 90)
$backgroundPath.CloseFigure()
$backgroundBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#1b2533"))
$graphics.FillPath($backgroundBrush, $backgroundPath)

$framePen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#58b781")), 64
$framePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$graphics.DrawRectangle($framePen, 216, 318, 592, 388)

$primaryPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#f4f7f9")), 54
$primaryPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$primaryPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($primaryPen, 348, 604, 676, 604)

$accentPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#58b781")), 46
$accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($accentPen, 392, 466, 632, 466)

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$accentPen.Dispose()
$primaryPen.Dispose()
$framePen.Dispose()
$backgroundBrush.Dispose()
$backgroundPath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output $outputPath
