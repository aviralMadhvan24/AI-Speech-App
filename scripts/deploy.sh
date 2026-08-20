#!/bin/bash
# Deploy the Soft Skills platform to the production EC2 instance.
#
# TARGET (this script deploys to this instance only):
#   Instance : i-0b1cf8a2c1a05a01b  "softskills-production"  (t3.large)
#   Region   : ap-south-1           AWS account 102001485145
#   Address  : 15.207.25.230        https://15.207.25.230.nip.io
#
# Usage — from your machine:
#   ssh -i ~/.ssh/softskills-final-key.pem ubuntu@15.207.25.230 \
#       'bash /home/ubuntu/softskills2/scripts/deploy.sh'
#
# Usage — once you are on the box:
#   bash /home/ubuntu/softskills2/scripts/deploy.sh
#
# Options:
#   --remote NAME    git remote to pull from   (default: upstream-aviral)
#   --branch NAME    branch to deploy          (default: main)
#   --clean-install  force `npm ci` even when node_modules is present
#   --skip-frontend  backend only; skips the Vite build
#
# This is an UPDATE script, not a provisioning script. It deliberately never
# touches `.env`, `.firebase-admin.json`, the systemd units, or the Caddyfile —
# those are configured on the box and are not reproduced from the repo. See
# "Reference configuration" at the bottom of this file for their current
# contents if you ever need to rebuild the instance from scratch.

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════

APP_DIR="/home/ubuntu/softskills2"
BACKEND_SERVICE="softskills-backend"
SS3_SERVICE="softskills-ss3"
BACKEND_PORT=8000
SS3_PORT=8001
PUBLIC_URL="https://15.207.25.230.nip.io"

GIT_REMOTE="upstream-aviral"
GIT_BRANCH="main"
CLEAN_INSTALL=0
SKIP_FRONTEND=0

while [ $# -gt 0 ]; do
    case "$1" in
        --remote)        GIT_REMOTE="$2"; shift 2 ;;
        --branch)        GIT_BRANCH="$2"; shift 2 ;;
        --clean-install) CLEAN_INSTALL=1; shift ;;
        --skip-frontend) SKIP_FRONTEND=1; shift ;;
        -h|--help)       sed -n '2,28p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[!]${NC} $1"; }
log_err()  { echo -e "${RED}[✗]${NC} $1"; }

# ═══════════════════════════════════════════════════════════════════
# 1. Guard: refuse to run anywhere that is not the production box
# ═══════════════════════════════════════════════════════════════════
#
# Deploying into a half-matching host is how you end up with a second,
# parallel install. Verify the layout up front and bail out loudly.

log_info "Step 1/6: Verifying this is the production instance..."

if [ "$(id -u)" -eq 0 ]; then
    log_err "Do not run as root — the services run as the 'ubuntu' user."
    exit 1
fi

preflight_error=0
require_path() {
    if [ ! -e "$1" ]; then
        log_err "Missing $1 — $2"
        preflight_error=1
    fi
}

require_path "$APP_DIR"                     "expected the app checkout here"
require_path "$APP_DIR/venv/bin/python"     "backend virtualenv is not set up"
require_path "$APP_DIR/ss3/venv-ss3/bin/python" "ss3 virtualenv is not set up"
require_path "$APP_DIR/.env"                "backend environment file is missing"
require_path "/etc/systemd/system/${BACKEND_SERVICE}.service" "backend service is not installed"
require_path "/etc/systemd/system/${SS3_SERVICE}.service"     "ss3 service is not installed"

if ! systemctl list-unit-files caddy.service >/dev/null 2>&1; then
    log_err "Caddy is not installed — this host does not serve the app."
    preflight_error=1
fi

if [ "$preflight_error" -ne 0 ]; then
    log_err "This host does not look like softskills-production."
    log_err "This script only deploys to i-0b1cf8a2c1a05a01b (15.207.25.230)."
    log_err "It will not provision a new machine — set one up before deploying."
    exit 1
fi

log_ok "Host verified ($(hostname))"

# ═══════════════════════════════════════════════════════════════════
# 2. Pull the code
# ═══════════════════════════════════════════════════════════════════

log_info "Step 2/6: Pulling ${GIT_REMOTE}/${GIT_BRANCH}..."
cd "$APP_DIR"

if ! git remote get-url "$GIT_REMOTE" >/dev/null 2>&1; then
    log_err "Git remote '${GIT_REMOTE}' is not configured. Available:"
    git remote -v >&2
    exit 1
fi

# Vite rewrites these on every build, so they are always dirty and would
# block the merge. They are generated output — safe to discard. The glob
# covers the tsconfig.node.* variants too, which a build also touches.
git checkout -- '*.tsbuildinfo' 2>/dev/null || true

if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    log_err "Uncommitted changes on the box would be overwritten:"
    git status --short >&2
    log_err "Commit, stash, or discard them before deploying."
    exit 1
fi

BEFORE="$(git rev-parse --short HEAD)"
GIT_TERMINAL_PROMPT=0 git fetch "$GIT_REMOTE" "$GIT_BRANCH"

# --ff-only: a deploy should fast-forward. A merge commit created here would
# mean the box has history the remote does not, which needs a human.
if ! git merge --ff-only "${GIT_REMOTE}/${GIT_BRANCH}"; then
    log_err "Cannot fast-forward to ${GIT_REMOTE}/${GIT_BRANCH}."
    log_err "The box has diverged from the remote — resolve this by hand."
    exit 1
fi

AFTER="$(git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
    log_ok "Already up to date at ${AFTER}"
else
    log_ok "Updated ${BEFORE} → ${AFTER}"
fi

# ═══════════════════════════════════════════════════════════════════
# 3. Python dependencies
# ═══════════════════════════════════════════════════════════════════

log_info "Step 3/6: Installing Python dependencies..."
"$APP_DIR/venv/bin/pip" install --no-cache-dir -q -r "$APP_DIR/requirements.txt"
log_ok "Backend dependencies ready ($("$APP_DIR/venv/bin/python" --version))"

# ss3 has its own virtualenv (mediapipe/opencv pins conflict with the backend).
if [ -f "$APP_DIR/ss3/requirements.txt" ]; then
    "$APP_DIR/ss3/venv-ss3/bin/pip" install --no-cache-dir -q -r "$APP_DIR/ss3/requirements.txt"
    log_ok "ss3 dependencies ready"
fi

# ═══════════════════════════════════════════════════════════════════
# 4. Frontend build
# ═══════════════════════════════════════════════════════════════════

if [ "$SKIP_FRONTEND" -eq 1 ]; then
    log_warn "Step 4/6: Skipping frontend build (--skip-frontend)"
else
    log_info "Step 4/6: Building frontend..."
    cd "$APP_DIR/frontend"

    if [ "$CLEAN_INSTALL" -eq 1 ] || [ ! -d node_modules ]; then
        log_info "Installing npm packages (npm ci)..."
        npm ci
    fi

    # Caddy serves frontend/dist straight off disk, so a failed build here
    # must abort the deploy rather than leave a stale bundle live.
    npm run build
    log_ok "Frontend built to frontend/dist/"
    cd "$APP_DIR"
fi

# ═══════════════════════════════════════════════════════════════════
# 5. Restart services
# ═══════════════════════════════════════════════════════════════════

log_info "Step 5/6: Restarting services..."
sudo systemctl restart "$SS3_SERVICE" "$BACKEND_SERVICE"

for service in "$BACKEND_SERVICE" "$SS3_SERVICE"; do
    if systemctl is-active --quiet "$service"; then
        log_ok "$service is active"
    else
        log_err "$service failed to start:"
        sudo journalctl -u "$service" -n 30 --no-pager >&2
        exit 1
    fi
done

# ═══════════════════════════════════════════════════════════════════
# 6. Health checks
# ═══════════════════════════════════════════════════════════════════
#
# The backend preloads the Whisper model on startup (~15s), during which the
# port is not yet accepting connections. An immediate curl failing is normal,
# so poll rather than treating the first refusal as a deploy failure.

log_info "Step 6/6: Waiting for the backend to come up..."

backend_ok=0
for attempt in $(seq 1 12); do
    if curl -sf --max-time 5 "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; then
        backend_ok=1
        log_ok "Backend healthy on :${BACKEND_PORT} (after ~$((attempt * 5))s)"
        break
    fi
    sleep 5
done

if [ "$backend_ok" -ne 1 ]; then
    log_err "Backend never became healthy on :${BACKEND_PORT}"
    sudo journalctl -u "$BACKEND_SERVICE" -n 30 --no-pager >&2
    exit 1
fi

if curl -sf --max-time 5 "http://127.0.0.1:${SS3_PORT}/" >/dev/null 2>&1 \
   || curl -s --max-time 5 -o /dev/null "http://127.0.0.1:${SS3_PORT}/"; then
    log_ok "ss3 responding on :${SS3_PORT}"
else
    log_warn "ss3 not responding on :${SS3_PORT} — Interview Studio gestures may fail"
fi

if curl -sf --max-time 10 "${PUBLIC_URL}/health" >/dev/null 2>&1; then
    log_ok "Public endpoint healthy"
else
    log_warn "Could not reach ${PUBLIC_URL}/health from the box (check Caddy)"
fi

echo ""
log_ok "Deployment complete — ${BEFORE} → ${AFTER}"
echo ""
echo "  App:      ${PUBLIC_URL}"
echo "  Logs:     sudo journalctl -u ${BACKEND_SERVICE} -f"
echo "  Restart:  sudo systemctl restart ${BACKEND_SERVICE}"
echo ""

# ═══════════════════════════════════════════════════════════════════
# Reference configuration (NOT applied by this script)
# ═══════════════════════════════════════════════════════════════════
#
# Recorded so the instance can be rebuilt if it is ever lost. These files are
# owned by the box; this script only reads the code, never rewrites config.
#
# ── /etc/systemd/system/softskills-backend.service ──
#   [Unit]
#   Description=SoftSkills Backend API
#   After=network.target
#   [Service]
#   Type=simple
#   User=ubuntu
#   WorkingDirectory=/home/ubuntu/softskills2
#   ExecStart=/home/ubuntu/softskills2/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
#   Restart=always
#   RestartSec=5
#   EnvironmentFile=/home/ubuntu/softskills2/.env
#   [Install]
#   WantedBy=multi-user.target
#
# ── /etc/systemd/system/softskills-ss3.service ──
#   [Unit]
#   Description=SoftSkills ss3 Gesture Analysis Service
#   After=network.target
#   [Service]
#   Type=simple
#   User=ubuntu
#   WorkingDirectory=/home/ubuntu/softskills2/ss3
#   ExecStart=/home/ubuntu/softskills2/ss3/venv-ss3/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
#   Restart=always
#   RestartSec=5
#   [Install]
#   WantedBy=multi-user.target
#
# ── /etc/caddy/Caddyfile ──
#   15.207.25.230.nip.io {
#       handle /livekit-ws/* {
#           uri strip_prefix /livekit-ws
#           reverse_proxy localhost:7880
#       }
#       handle /ss3/* {
#           root * /home/ubuntu/softskills2/ss3/frontend/dist
#           uri strip_prefix /ss3
#           try_files {path} /index.html
#           file_server
#       }
#       handle /assets/* {
#           root * /home/ubuntu/softskills2/frontend/dist
#           file_server
#       }
#       # A new API prefix missing from this list does not 404 — it falls
#       # through to the SPA handler below and returns index.html with a 200,
#       # so the client sees HTML where it expected JSON. Add the prefix here
#       # whenever a router gains one.
#       @backend {
#           path /admin* /analyze* /attempts* /auth* /battle* /buddy* /debate* /gd* /health* /interview* /potd* /profile* /livekit* /uploads* /outputs* /ws* /docs* /redoc* /openapi.json
#       }
#       handle @backend {
#           reverse_proxy localhost:8000
#       }
#       handle {
#           root * /home/ubuntu/softskills2/frontend/dist
#           try_files {path} /index.html
#           file_server
#       }
#   }
