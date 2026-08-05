#!/bin/bash
# Set up the ss3 gesture-analysis microservice as a systemd unit on EC2.
#
# Interview Studio proxies POST /interview/analyze to this service via
# CSA_SERVICE_URL (default http://127.0.0.1:8001). Without it running, the
# feature returns "502 Bad Gateway - Could not reach gesture-analysis service".
#
# The service is bound to 127.0.0.1 on purpose: only the local backend calls it,
# so it must not be reachable from the internet. Caddy is not involved.
#
# Idempotent - safe to re-run. Usage:  bash scripts/setup_ss3_service.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/softskills2}"
SS3_DIR="$APP_DIR/ss3"
VENV_DIR="$SS3_DIR/venv-ss3"
SERVICE_NAME="softskills-ss3"
PORT=8001

echo "### 1/5 pre-flight"
[ -d "$SS3_DIR" ] || { echo "ss3 dir not found at $SS3_DIR"; exit 1; }

# MediaPipe needs >=3.10,<3.13. Prefer 3.11, fall back to 3.10.
PY=""
for candidate in python3.12 python3.11 python3.10; do
  if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
done
[ -n "$PY" ] || { echo "No Python 3.10-3.12 found; mediapipe cannot be installed."; exit 1; }
echo "using $PY ($($PY --version 2>&1))"

echo "### 2/5 virtualenv"
if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PY" -m venv "$VENV_DIR"
  echo "created $VENV_DIR"
else
  echo "reusing $VENV_DIR"
fi

echo "### 3/5 dependencies (mediapipe + opencv, a few hundred MB)"
"$VENV_DIR/bin/pip" install --upgrade pip -q
# Editable install so `backend.main` resolves from pyproject.toml.
"$VENV_DIR/bin/pip" install -e "$SS3_DIR" -q
echo "installed: $("$VENV_DIR/bin/pip" list 2>/dev/null | wc -l) packages"

echo "### 4/5 systemd unit"
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<EOF
[Unit]
Description=SoftSkills ss3 Gesture Analysis Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$SS3_DIR
ExecStart=$VENV_DIR/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port $PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
sudo systemctl restart "$SERVICE_NAME"
sleep 6

echo "### 5/5 verify"
systemctl is-active "$SERVICE_NAME" || true
curl -s -o /dev/null -w "ss3_root=%{http_code}\n" "http://127.0.0.1:$PORT/" || true

# The main backend caches nothing, but restart it so a failed proxy attempt is
# not what the next request sees.
sudo systemctl restart softskills-backend
sleep 5
systemctl is-active softskills-backend || true

echo ""
echo "ss3_root=200 means the service is up."
echo "ss3_root=000 means nothing is listening on $PORT - check the logs:"
echo "  sudo journalctl -u $SERVICE_NAME -n 50 --no-pager"
