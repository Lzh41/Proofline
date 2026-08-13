param(
  [string]$ExePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri\target\release\proofline.exe')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) {
  throw "EXE not found: $ExePath"
}

Add-Type -AssemblyName System.Drawing

$icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path -LiteralPath $ExePath).Path)
if (-not $icon) {
  throw "Could not extract the Windows icon from: $ExePath"
}

$bitmap = $icon.ToBitmap()
try {
  $orangePixels = 0
  $darkPixels = 0

  for ($x = 0; $x -lt $bitmap.Width; $x++) {
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
      $pixel = $bitmap.GetPixel($x, $y)
      if ($pixel.A -eq 0) {
        continue
      }

      if (
        $pixel.R -ge 150 -and
        $pixel.R -ge ($pixel.G + 30) -and
        $pixel.G -ge 50 -and
        $pixel.G -le 170 -and
        $pixel.B -le 150
      ) {
        $orangePixels++
      }

      if ($pixel.R -le 65 -and $pixel.G -le 65 -and $pixel.B -le 65) {
        $darkPixels++
      }
    }
  }

  if ($orangePixels -lt 20 -or $darkPixels -lt 20) {
    throw "Expected the orange-black diamond icon (orange pixels: $orangePixels, dark pixels: $darkPixels)."
  }

  Write-Host "Windows icon verified (orange pixels: $orangePixels, dark pixels: $darkPixels)."
} finally {
  $bitmap.Dispose()
  $icon.Dispose()
}
