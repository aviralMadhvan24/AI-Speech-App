# Schedule automatic shutdown after N days
# Usage: .\scripts\schedule_shutdown.ps1 -Days 7

param(
    [int]$Days = 7
)

$INSTANCE_ID = "i-0b68ee4c75f83f414"
$shutdownTime = (Get-Date).AddDays($Days)

Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " Scheduled Shutdown" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Instance: $INSTANCE_ID"
Write-Host "Shutdown time: $shutdownTime"
Write-Host "Estimated cost until then: `$$([math]::Round($Days * 24 * 0.0464, 2))"
Write-Host ""

$confirm = Read-Host "Proceed? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Cancelled." -ForegroundColor Red
    exit
}

# Create a Windows Scheduled Task
$action = New-ScheduledTaskAction -Execute "aws" -Argument "ec2 stop-instances --instance-ids $INSTANCE_ID --region ap-south-1"
$trigger = New-ScheduledTaskTrigger -Once -At $shutdownTime
$settings = New-ScheduledTaskSettingsSet -Compatibility Win8

Register-ScheduledTask `
    -TaskName "softskills-auto-shutdown" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Auto-stop softskills EC2 instance" `
    -Force

Write-Host "✓ Shutdown scheduled for $shutdownTime" -ForegroundColor Green
Write-Host "  To cancel: Unregister-ScheduledTask -TaskName softskills-auto-shutdown -Confirm:`$false"
