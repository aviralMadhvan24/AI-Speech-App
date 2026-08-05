# AWS EC2 Instance Management Script - softskills-production
#
# Usage:
#   .\scripts\aws_manage.ps1 start
#   .\scripts\aws_manage.ps1 stop
#   .\scripts\aws_manage.ps1 status
#   .\scripts\aws_manage.ps1 ssh
#   .\scripts\aws_manage.ps1 logs
#   .\scripts\aws_manage.ps1 restart
#   .\scripts\aws_manage.ps1 update
#
# Auth model: there is no .pem key on this machine. Access uses EC2 Instance
# Connect, which pushes a short-lived public key to the instance (valid ~60s
# for new connections), so a fresh key is pushed before every SSH call.
#
# Reverse proxy is Caddy (ports 80/443, auto TLS via nip.io) - NOT nginx.
# LiveKit + egress + redis run as Docker containers.

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("start", "stop", "status", "ssh", "logs", "restart", "update")]
    [string]$Action
)

$ErrorActionPreference = "Stop"

$INSTANCE_ID = "i-0b1cf8a2c1a05a01b"
$REGION      = "ap-south-1"
$AZ          = "ap-south-1b"
$OS_USER     = "ubuntu"
$ELASTIC_IP  = "15.207.25.230"          # eipalloc-0f6bcd58cd4bfd56f (stable across stop/start)
$PUBLIC_HOST = "15.207.25.230.nip.io"
$APP_DIR     = "/home/ubuntu/softskills2"
$SERVICE     = "softskills-backend"
$KEY_PATH    = Join-Path $env:TEMP "eic-key"

function Initialize-EicKey {
    if (-not (Test-Path "$KEY_PATH.pub")) {
        ssh-keygen -t ed25519 -N '""' -f $KEY_PATH -q | Out-Null
    }
}

function Push-EicKey {
    Initialize-EicKey
    aws ec2-instance-connect send-ssh-public-key `
        --instance-id $INSTANCE_ID `
        --instance-os-user $OS_USER `
        --ssh-public-key "file://$KEY_PATH.pub" `
        --availability-zone $AZ `
        --region $REGION | Out-Null
}

function Get-InstanceState {
    return (aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION `
            --query "Reservations[].Instances[].State.Name" --output text)
}

function Get-InstanceIP {
    return (aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION `
            --query "Reservations[].Instances[].PublicIpAddress" --output text)
}

function Invoke-Remote {
    param([string]$Command)
    Push-EicKey
    ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o LogLevel=ERROR `
        -o BatchMode=yes -o ConnectTimeout=15 "$OS_USER@$ELASTIC_IP" $Command
}

switch ($Action) {
    "start" {
        Write-Host "Starting instance..." -ForegroundColor Cyan
        aws ec2 start-instances --instance-ids $INSTANCE_ID --region $REGION | Out-Null
        aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $REGION
        Start-Sleep -Seconds 20
        Write-Host "Instance running. URL: https://$PUBLIC_HOST" -ForegroundColor Green
        Write-Host "Elastic IP is attached, so the address does not change." -ForegroundColor Gray
    }

    "stop" {
        Write-Host "Stopping instance..." -ForegroundColor Cyan
        aws ec2 stop-instances --instance-ids $INSTANCE_ID --region $REGION | Out-Null
        aws ec2 wait instance-stopped --instance-ids $INSTANCE_ID --region $REGION
        Write-Host "Instance stopped." -ForegroundColor Green
    }

    "status" {
        $state = Get-InstanceState
        Write-Host ""
        Write-Host "Instance : $INSTANCE_ID ($state)" -ForegroundColor Cyan
        Write-Host "Public IP: $(Get-InstanceIP)"
        Write-Host "URL      : https://$PUBLIC_HOST"
        if ($state -eq "running") {
            Write-Host ""
            Write-Host "Services:" -ForegroundColor Cyan
            Invoke-Remote "systemctl is-active $SERVICE caddy docker; echo '--- containers ---'; sudo docker ps --format '{{.Names}}: {{.Status}}'; echo '--- health ---'; curl -s -o /dev/null -w 'https=%{http_code}\n' https://$PUBLIC_HOST/health"
        }
    }

    "ssh" {
        Push-EicKey
        Write-Host "Connecting to $ELASTIC_IP..." -ForegroundColor Cyan
        ssh -i $KEY_PATH -o StrictHostKeyChecking=no -o LogLevel=ERROR "$OS_USER@$ELASTIC_IP"
    }

    "logs" {
        Write-Host "Backend logs (Ctrl+C to exit):" -ForegroundColor Cyan
        Invoke-Remote "sudo journalctl -u $SERVICE -f -n 50"
    }

    "restart" {
        Write-Host "Restarting backend..." -ForegroundColor Cyan
        Invoke-Remote "sudo systemctl restart $SERVICE; sleep 5; systemctl is-active $SERVICE"
        Write-Host "Done." -ForegroundColor Green
    }

    "update" {
        Write-Host "Deploying latest code from origin/main..." -ForegroundColor Cyan
        # tsbuildinfo files get rewritten by each build, so they are checked out
        # first to keep the tree clean enough for a hard reset.
        $deploy = @(
            "set -e",
            "cd $APP_DIR",
            "git rev-parse HEAD > /home/ubuntu/last-deploy-rollback.txt",
            "git checkout -- frontend/tsconfig.tsbuildinfo ss3/frontend/tsconfig.tsbuildinfo 2>/dev/null || true",
            'if [ -n "$(git status --porcelain)" ]; then git stash push -u -m "pre-deploy-$(date +%Y%m%d-%H%M%S)"; fi',
            "git fetch origin main",
            "git reset --hard origin/main",
            "./venv/bin/pip install -r requirements.txt -q",
            "cd $APP_DIR/frontend && npm install --no-audit --no-fund && npm run build",
            "if [ -f $APP_DIR/ss3/frontend/package.json ]; then cd $APP_DIR/ss3/frontend && npm install --no-audit --no-fund && npm run build; fi",
            "sudo systemctl restart $SERVICE",
            "sleep 6",
            "systemctl is-active $SERVICE",
            "curl -s -o /dev/null -w 'https=%{http_code}\n' https://$PUBLIC_HOST/health",
            "cd $APP_DIR && git log -1 --oneline"
        ) -join "; "

        Invoke-Remote $deploy
        Write-Host "Deployment complete: https://$PUBLIC_HOST" -ForegroundColor Green
    }
}
