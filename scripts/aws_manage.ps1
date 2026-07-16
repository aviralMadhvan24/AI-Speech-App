# AWS EC2 Instance Management Script
# Usage:
#   .\scripts\aws_manage.ps1 start
#   .\scripts\aws_manage.ps1 stop
#   .\scripts\aws_manage.ps1 status
#   .\scripts\aws_manage.ps1 ssh
#   .\scripts\aws_manage.ps1 logs
#   .\scripts\aws_manage.ps1 restart

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("start", "stop", "status", "ssh", "logs", "restart", "update")]
    [string]$Action
)

$INSTANCE_ID = "i-0b68ee4c75f83f414"
$REGION = "ap-south-1"
$KEY_PATH = "$env:USERPROFILE\.ssh\softskills-key.pem"
$ELASTIC_IP = "15.207.74.56"
$ELASTIC_IP_ALLOC = "eipalloc-080ecf39434bd2589"

function Get-InstanceState {
    return (aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION --query "Reservations[].Instances[].State.Name" --output text)
}

function Get-InstanceIP {
    return (aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION --query "Reservations[].Instances[].PublicIpAddress" --output text)
}

function Run-SSH {
    param([string]$Command)
    $ip = Get-InstanceIP
    ssh -i $KEY_PATH -o StrictHostKeyChecking=no ubuntu@$ip $Command
}

switch ($Action) {
    "start" {
        Write-Host "Starting instance..." -ForegroundColor Cyan
        aws ec2 start-instances --instance-ids $INSTANCE_ID --region $REGION | Out-Null
        Write-Host "Waiting for running state..." -ForegroundColor Yellow
        aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $REGION
        Start-Sleep -Seconds 20
        $ip = Get-InstanceIP
        Write-Host ""
        Write-Host "✓ Instance running!" -ForegroundColor Green
        Write-Host "  URL: http://$ip" -ForegroundColor Green
        Write-Host "  IP:  $ip" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "⚠ IMPORTANT: If IP changed, update Firebase authorized domains!" -ForegroundColor Yellow
    }
    "stop" {
        Write-Host "Stopping instance..." -ForegroundColor Cyan
        aws ec2 stop-instances --instance-ids $INSTANCE_ID --region $REGION | Out-Null
        aws ec2 wait instance-stopped --instance-ids $INSTANCE_ID --region $REGION
        Write-Host "✓ Instance stopped! Saving ~`$0.05/hour" -ForegroundColor Green
    }
    "status" {
        $state = Get-InstanceState
        $ip = Get-InstanceIP
        Write-Host ""
        Write-Host "Instance State: $state" -ForegroundColor Cyan
        if ($state -eq "running") {
            Write-Host "Public IP: $ip"
            Write-Host "URL: http://$ip"
            Write-Host ""
            Write-Host "Services:" -ForegroundColor Cyan
            Run-SSH "sudo systemctl is-active softskills-backend softskills-ss3 nginx"
        }
    }
    "ssh" {
        $ip = Get-InstanceIP
        Write-Host "Connecting to $ip..." -ForegroundColor Cyan
        ssh -i $KEY_PATH -o StrictHostKeyChecking=no ubuntu@$ip
    }
    "logs" {
        Write-Host "Backend logs (Ctrl+C to exit):" -ForegroundColor Cyan
        Run-SSH "sudo journalctl -u softskills-backend -f -n 50"
    }
    "restart" {
        Write-Host "Restarting services..." -ForegroundColor Cyan
        Run-SSH "sudo systemctl restart softskills-backend softskills-ss3"
        Start-Sleep -Seconds 3
        Write-Host "✓ Services restarted" -ForegroundColor Green
        Run-SSH "sudo systemctl is-active softskills-backend softskills-ss3"
    }
    "update" {
        Write-Host "Deploying latest code..." -ForegroundColor Cyan
        Run-SSH "cd ~/softskills && git fetch && git reset --hard origin/main && cd frontend && npm run build && cd .. && sudo systemctl restart softskills-backend softskills-ss3"
        Write-Host "✓ Deployment updated" -ForegroundColor Green
    }
}
