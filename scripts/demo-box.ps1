# PowerShell wrapper for scripts/demo-box.sh.
#
#   .\scripts\demo-box.ps1 start
#   .\scripts\demo-box.ps1 stop
#   .\scripts\demo-box.ps1 status
#
# Why this exists: in PowerShell, plain `bash` resolves to C:\Windows\System32\bash.exe,
# which is WSL — not Git Bash. If the WSL distro is missing or broken you get
# "Failed to attach disk ... ext4.vhdx", which looks like a problem with the
# script but is nothing to do with it. This finds the real Git Bash and hands off.

$ErrorActionPreference = "Stop"

$candidates = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files (x86)\Git\bin\bash.exe",
    "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
)

# Also derive it from git itself, which covers non-standard install locations:
# <root>\cmd\git.exe sits two levels below <root>\bin\bash.exe.
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
    $gitRoot = Split-Path (Split-Path $gitCmd.Source -Parent) -Parent
    $candidates += (Join-Path $gitRoot "bin\bash.exe")
}

$bash = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $bash) {
    Write-Error "Could not find Git Bash. Install Git for Windows, or run the script from a Git Bash prompt: bash scripts/demo-box.sh $args"
    exit 1
}

$script = Join-Path $PSScriptRoot "demo-box.sh"

& $bash $script @args
exit $LASTEXITCODE
