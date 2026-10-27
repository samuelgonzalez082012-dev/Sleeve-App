$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$mainPath = Join-Path $root 'main.js'
$preloadPath = Join-Path $root 'preload.js'
$indexPath = Join-Path $root 'index.html'
$mainAppendPath = Join-Path $root 'spotdl-main-append.js.txt'
$preloadInsertPath = Join-Path $root 'spotdl-preload-insert.txt'
$uiJsPath = Join-Path $root 'spotdl-integration.js'
$uiCssPath = Join-Path $root 'spotdl-integration.css'

$required = @($mainPath, $preloadPath, $indexPath, $mainAppendPath, $preloadInsertPath, $uiJsPath, $uiCssPath)
foreach ($file in $required) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "Required file not found: $file`nExtract all integration files into the root of the Sleeve project, beside main.js and index.html."
  }
}

$main = [System.IO.File]::ReadAllText($mainPath)
$preload = [System.IO.File]::ReadAllText($preloadPath)
$index = [System.IO.File]::ReadAllText($indexPath)
$mainAppend = [System.IO.File]::ReadAllText($mainAppendPath)
$preloadInsert = [System.IO.File]::ReadAllText($preloadInsertPath)

# Refuse accidental double-installation before making any changes.
if ($main.Contains('SPOTDL_INTEGRATION_START') -or $main.Contains('spotDL download integration')) {
  throw 'spotDL integration appears to be installed already. No files were changed.'
}
if ($preload.Contains("ipcRenderer.invoke('spotdl:check')")) {
  throw 'spotDL preload bridge appears to be installed already. No files were changed.'
}
if ($index.Contains('spotdl-integration.js') -or $index.Contains('spotdl-integration.css')) {
  throw 'spotDL UI references already exist in index.html. No files were changed.'
}

# Use simple string checks here instead of regexes containing nested quote
# characters. This avoids PowerShell parser differences across Windows versions.
$hasElectronRequire = $main.Contains("require('electron')") -or $main.Contains('require("electron")')
$hasChildProcessRequire = $main.Contains("require('node:child_process')") -or
                          $main.Contains('require("node:child_process")') -or
                          $main.Contains("require('child_process')") -or
                          $main.Contains('require("child_process")')
$hasFsRequire = $main.Contains("require('node:fs')") -or $main.Contains('require("node:fs")') -or
                $main.Contains("require('fs')") -or $main.Contains('require("fs")')
$hasPathRequire = $main.Contains("require('node:path')") -or $main.Contains('require("node:path")') -or
                  $main.Contains("require('path')") -or $main.Contains('require("path")')
$hasRequiredSymbols = $main.Contains('ipcMain') -and $main.Contains('shell') -and
                      $main.Contains('spawn') -and $main.Contains('app.getPath')
if (-not ($hasElectronRequire -and $hasChildProcessRequire -and $hasFsRequire -and $hasPathRequire -and $hasRequiredSymbols)) {
  throw 'main.js is missing one or more required Electron, child_process, fs, or path imports/symbols. No files were changed. Keep your files unchanged and share this message for diagnosis.'
}

$preloadNeedlePattern = '(?m)^(?<indent>[ \t]*)getPathForFile:\s*\(file\)\s*=>\s*webUtils\.getPathForFile\(file\),[ \t]*$'
$preloadMatch = [regex]::Match($preload, $preloadNeedlePattern)
if (-not $preloadMatch.Success) {
  throw 'Could not find getPathForFile in preload.js. No files were changed. Keep your original files and share the top of preload.js for diagnosis.'
}
if (-not $index.Contains('</head>') -or -not $index.Contains('</body>')) {
  throw 'Could not find the HTML head/body closing tags in index.html. No files were changed.'
}

$newMain = $main.TrimEnd() + "`r`n`r`n" + $mainAppend.Trim() + "`r`n"
$newPreload = $preload.Insert($preloadMatch.Index, $preloadInsert.TrimEnd() + "`r`n" + $preloadMatch.Groups['indent'].Value)
$headAddition = '  <link rel="stylesheet" href="./spotdl-integration.css">' + "`r`n</head>"
$bodyAddition = '  <script src="./spotdl-integration.js"></script>' + "`r`n</body>"
$newIndex = $index.Replace('</head>', $headAddition)
$newIndex = $newIndex.Replace('</body>', $bodyAddition)

# Sanity-check the proposed text before saving anything.
if (-not $newMain.Contains("ipcMain.handle('spotdl:start'") -or
    -not $newPreload.Contains("checkSpotdl:") -or
    -not $newIndex.Contains('spotdl-integration.js') -or
    -not $newIndex.Contains('spotdl-integration.css')) {
  throw 'The proposed changes failed an internal consistency check. No files were changed.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $root (Join-Path 'backups' "spotdl-integration-$stamp")
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item -LiteralPath $mainPath -Destination (Join-Path $backupDir 'main.js')
Copy-Item -LiteralPath $preloadPath -Destination (Join-Path $backupDir 'preload.js')
Copy-Item -LiteralPath $indexPath -Destination (Join-Path $backupDir 'index.html')

try {
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($mainPath, $newMain, $utf8NoBom)
  [System.IO.File]::WriteAllText($preloadPath, $newPreload, $utf8NoBom)
  [System.IO.File]::WriteAllText($indexPath, $newIndex, $utf8NoBom)
} catch {
  Copy-Item -LiteralPath (Join-Path $backupDir 'main.js') -Destination $mainPath -Force
  Copy-Item -LiteralPath (Join-Path $backupDir 'preload.js') -Destination $preloadPath -Force
  Copy-Item -LiteralPath (Join-Path $backupDir 'index.html') -Destination $indexPath -Force
  throw "Installation failed; original files were restored. Details: $($_.Exception.Message)"
}

Write-Host ''
Write-Host 'spotDL integration installed.' -ForegroundColor Green
Write-Host "Backup saved to: $backupDir"
Write-Host 'Next: install spotDL (see SPOTDL-README.md), then restart Sleeve.'
