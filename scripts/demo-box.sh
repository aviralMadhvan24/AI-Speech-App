#!/bin/bash
# Start and stop the production EC2 instance around a demo.
#
# TARGET (this script controls this instance only):
#   Instance : i-0b1cf8a2c1a05a01b  "softskills-production"  (t3.large)
#   Region   : ap-south-1           AWS account 102001485145
#   Address  : 15.207.25.230        https://15.207.25.230.nip.io
#
# Usage — from your machine (NOT from the box; stopping the box you are
# sitting on does not end well):
#   bash scripts/demo-box.sh start     # boot it, wait until /health answers
#   bash scripts/demo-box.sh stop      # shut it down, stop paying for compute
#   bash scripts/demo-box.sh status    # where is it now, and what is it costing
#
# Options:
#   --no-wait    return as soon as AWS accepts the call, without polling
#
# Why bother: running 24/7 costs ~$2.21/day. Stopped, the same box costs
# ~$0.21/day — the 30 GB volume plus the Elastic IP, which are billed whether
# it is on or not. On a $100 credit that is the difference between roughly
# four weeks of runway and roughly nine months.
#
# Nothing here touches the app. Every service on the box is set to come back
# by itself: softskills-backend, softskills-ss3 and caddy are systemd-enabled,
# and livekit-server, livekit-egress and redis are docker containers with a
# restart policy of "unless-stopped".

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

INSTANCE_ID="${DEMO_BOX_INSTANCE:-i-0b1cf8a2c1a05a01b}"
AWS_PROFILE_NAME="${DEMO_BOX_PROFILE:-softskills-prod}"
AWS_REGION_NAME="${DEMO_BOX_REGION:-ap-south-1}"
EXPECTED_ACCOUNT="102001485145"
EXPECTED_IP="15.207.25.230"
PUBLIC_URL="https://15.207.25.230.nip.io"

# The backend preloads the Whisper "small" model before it will answer
# /health, so the box is reachable well before the app is ready. Two minutes
# is comfortable; three is the point at which something is actually wrong.
HEALTH_TIMEOUT=180

WAIT=1

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[!]${NC} $1"; }
log_err()  { echo -e "${RED}[✗]${NC} $1"; }

aws_ec2() {
    aws ec2 "$@" --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME"
}

# ═══════════════════════════════════════════════════════════════════
# Arguments
# ═══════════════════════════════════════════════════════════════════

COMMAND=""
while [ $# -gt 0 ]; do
    case "$1" in
        start|stop|status) COMMAND="$1"; shift ;;
        --no-wait)         WAIT=0; shift ;;
        -h|--help)         sed -n '2,26p' "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

if [ -z "$COMMAND" ]; then
    log_err "Say what to do: start, stop, or status."
    echo "Try: bash scripts/demo-box.sh --help" >&2
    exit 2
fi

# ═══════════════════════════════════════════════════════════════════
# Guard: the default AWS profile is a DIFFERENT account
# ═══════════════════════════════════════════════════════════════════
#
# Getting this wrong does not fail cleanly — it goes looking for this
# instance id in the wrong account and reports that it does not exist, which
# reads like the box was deleted. Check the account number up front instead.

account="$(aws sts get-caller-identity \
    --profile "$AWS_PROFILE_NAME" --query Account --output text 2>/dev/null || echo "")"

if [ -z "$account" ]; then
    log_err "Could not authenticate with AWS profile '$AWS_PROFILE_NAME'."
    log_err "Check that the profile exists: aws configure list-profiles"
    exit 1
fi

if [ "$account" != "$EXPECTED_ACCOUNT" ]; then
    log_err "Profile '$AWS_PROFILE_NAME' is account $account, not $EXPECTED_ACCOUNT."
    log_err "That is the wrong account — refusing to touch anything."
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════

instance_state() {
    aws_ec2 describe-instances --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || echo "unknown"
}

instance_ip() {
    aws_ec2 describe-instances --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' --output text 2>/dev/null || echo "None"
}

health_ok() {
    curl -fsS --max-time 8 "$PUBLIC_URL/health" >/dev/null 2>&1
}

# Warn if the TLS certificate is close to expiry. Caddy renews it about 30
# days out, but only while the box is running — if it spends that whole month
# switched off, the renewal never happens and HTTPS breaks. It does recover on
# the next boot, but not fast enough to save a demo.
check_cert() {
    local not_after now_s end_s days_left
    not_after="$(echo | openssl s_client -connect "${EXPECTED_IP}.nip.io:443" \
        -servername "${EXPECTED_IP}.nip.io" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)" || return 0
    [ -n "$not_after" ] || return 0

    end_s="$(date -d "$not_after" +%s 2>/dev/null || echo 0)"
    [ "$end_s" -gt 0 ] || return 0
    now_s="$(date +%s)"
    days_left=$(( (end_s - now_s) / 86400 ))

    if [ "$days_left" -le 21 ]; then
        log_warn "TLS certificate expires in $days_left days ($not_after)."
        log_warn "Leave the box up for an hour or so — Caddy only renews while it is running."
    fi
}

# ═══════════════════════════════════════════════════════════════════
# start
# ═══════════════════════════════════════════════════════════════════

cmd_start() {
    local state ip started elapsed
    state="$(instance_state)"

    case "$state" in
        running)
            log_ok "Already running."
            ;;
        stopped)
            log_info "Starting $INSTANCE_ID..."
            aws_ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
            if [ "$WAIT" -eq 0 ]; then
                log_ok "Start requested. Give it about two minutes."
                return 0
            fi
            log_info "Waiting for the instance to boot..."
            aws_ec2 wait instance-running --instance-ids "$INSTANCE_ID"
            log_ok "Instance is running."
            ;;
        pending)
            log_info "Already booting — waiting."
            aws_ec2 wait instance-running --instance-ids "$INSTANCE_ID"
            ;;
        stopping)
            log_err "It is mid-shutdown. Wait for that to finish, then start it again."
            exit 1
            ;;
        *)
            log_err "Instance is '$state' — not something this script should act on."
            exit 1
            ;;
    esac

    # livekit-server is launched with "--node-ip 15.207.25.230" baked into its
    # container arguments. If the address ever came back different, the site
    # would load perfectly and every debate would fail to connect — a silent
    # half-failure that looks like an app bug. Check it before demoing.
    ip="$(instance_ip)"
    if [ "$ip" != "$EXPECTED_IP" ]; then
        log_err "Public IP is $ip, expected $EXPECTED_IP."
        log_err "The Elastic IP has come detached. WebRTC (debates, GD) will fail until it"
        log_err "is reattached, even though the rest of the site will look fine."
        exit 1
    fi
    log_ok "Elastic IP still attached ($ip)."

    if [ "$WAIT" -eq 0 ]; then
        return 0
    fi

    log_info "Waiting for the app (the backend preloads Whisper before it answers)..."
    started="$(date +%s)"
    while true; do
        if health_ok; then
            elapsed=$(( $(date +%s) - started ))
            log_ok "Healthy after ${elapsed}s — $PUBLIC_URL"
            break
        fi
        if [ $(( $(date +%s) - started )) -ge "$HEALTH_TIMEOUT" ]; then
            log_err "No healthy response after ${HEALTH_TIMEOUT}s."
            log_err "Look at the box: ssh -i ~/.ssh/softskills-final-key.pem ubuntu@$EXPECTED_IP"
            log_err "  sudo systemctl status softskills-backend"
            log_err "  sudo journalctl -u softskills-backend -n 50"
            exit 1
        fi
        sleep 5
    done

    check_cert

    echo ""
    log_warn "Costing ~\$2.21/day while it runs. Run 'bash scripts/demo-box.sh stop' when you are done."
}

# ═══════════════════════════════════════════════════════════════════
# stop
# ═══════════════════════════════════════════════════════════════════

cmd_stop() {
    local state
    state="$(instance_state)"

    case "$state" in
        stopped)
            log_ok "Already stopped. Nothing to do."
            return 0
            ;;
        stopping)
            log_info "Already shutting down — waiting."
            ;;
        running)
            log_info "Stopping $INSTANCE_ID..."
            aws_ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null
            ;;
        *)
            log_err "Instance is '$state' — not something this script should act on."
            exit 1
            ;;
    esac

    if [ "$WAIT" -eq 0 ]; then
        log_ok "Stop requested."
        return 0
    fi

    aws_ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"
    log_ok "Stopped."

    echo ""
    log_info "Now costing ~\$0.21/day (30 GB volume + Elastic IP), down from ~\$2.21/day."
    log_info "Everything on the box restarts by itself next time. Nothing was lost."
}

# ═══════════════════════════════════════════════════════════════════
# status
# ═══════════════════════════════════════════════════════════════════

cmd_status() {
    local state ip
    state="$(instance_state)"
    ip="$(instance_ip)"

    echo ""
    echo "  Instance   $INSTANCE_ID  (account $account, $AWS_REGION_NAME)"
    echo "  State      $state"

    case "$state" in
        running)
            echo "  Address    $ip"
            if [ "$ip" != "$EXPECTED_IP" ]; then
                echo ""
                log_err "Expected $EXPECTED_IP — the Elastic IP is detached and WebRTC will fail."
            fi
            if health_ok; then
                echo "  App        healthy — $PUBLIC_URL"
            else
                echo "  App        not answering /health (still booting, or broken)"
            fi
            echo "  Cost       ~\$2.21/day while it stays up"
            echo ""
            check_cert
            ;;
        stopped)
            echo "  App        offline"
            echo "  Cost       ~\$0.21/day (30 GB volume + Elastic IP, billed either way)"
            echo ""
            echo "  Start it with: bash scripts/demo-box.sh start"
            echo "  (from PowerShell: .\\scripts\\demo-box.ps1 start)"
            echo ""
            ;;
        *)
            echo "  App        unknown — the instance is mid-transition"
            echo ""
            ;;
    esac
}

case "$COMMAND" in
    start)  cmd_start ;;
    stop)   cmd_stop ;;
    status) cmd_status ;;
esac
