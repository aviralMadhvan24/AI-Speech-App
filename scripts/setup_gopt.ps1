param(
    [string]$TargetDir = "models/pronunciation/gopt"
)

$ErrorActionPreference = "Stop"

$targetPath = Resolve-Path -Path "." | ForEach-Object {
    Join-Path $_ $TargetDir
}

$parentPath = Split-Path -Parent $targetPath

if (!(Test-Path $parentPath)) {
    New-Item -ItemType Directory -Path $parentPath | Out-Null
}

if (Test-Path $targetPath) {
    Write-Host "GOPT already exists at $targetPath"
} else {
    git clone https://github.com/YuanGongND/gopt.git $targetPath
}

Write-Host ""
Write-Host "Next manual steps:"
Write-Host "1. Follow FREE_PRONUNCIATION_ARCHITECTURE.md."
Write-Host "2. Install GOPT dependencies in a compatible environment."
Write-Host "3. Prepare Kaldi GOP features for each analyzed WAV."
Write-Host "4. Place feature files under temp/gopt_features as:"
Write-Host "   <processed_audio_stem>_feat.npy"
Write-Host "   <processed_audio_stem>_phn.npy"
Write-Host ""
Write-Host "Then set:"
Write-Host "PRONUNCIATION_PROVIDER=local_acoustic"
