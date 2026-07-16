# Deployment Info

## 🌐 URLs

### Production (HTTPS - Recommended)
- **App:** https://15-207-74-56.nip.io
- **API Docs:** https://15-207-74-56.nip.io/docs
- **Health:** https://15-207-74-56.nip.io/health

### HTTP (Fallback - Limited features)
- **App:** http://15.207.74.56
- **Note:** Microphone-based features (Cruise Control, Interview, Recording) won't work on HTTP

## 🔒 Firebase Setup

**IMPORTANT:** Add these domains to Firebase Authorized Domains:

Firebase Console → Authentication → Settings → Authorized domains

Add:
- `15-207-74-56.nip.io`
- `15.207.74.56`

## 🖥️ Infrastructure

| Component | Details |
|-----------|---------|
| Instance | i-0b68ee4c75f83f414 (t3.medium) |
| Region | ap-south-1 (Mumbai) |
| Elastic IP | 15.207.74.56 |
| Domain | 15-207-74-56.nip.io (free via nip.io) |
| HTTPS | Let's Encrypt (auto-renews) |
| Reverse Proxy | Nginx |

## 🎯 Services

| Service | Port | Status Command |
|---------|------|----------------|
| FastAPI Backend | 8080 | `sudo systemctl status softskills-backend` |
| ss3 Gesture | 8001 | `sudo systemctl status softskills-ss3` |
| Nginx | 80/443 | `sudo systemctl status nginx` |

## 💰 Cost

- **Rate:** ~$0.05/hour = $1.20/day = $8.40/week
- **HTTPS:** FREE (Let's Encrypt)
- **Elastic IP:** FREE (attached to running instance)
- **Domain (nip.io):** FREE

## 🛠️ Management

From your PC:
```powershell
# Status
.\scripts\aws_manage.ps1 status

# Stop (save money)
.\scripts\aws_manage.ps1 stop

# Start
.\scripts\aws_manage.ps1 start

# View logs
.\scripts\aws_manage.ps1 logs

# Deploy new code
.\scripts\aws_manage.ps1 update
```

## ✅ Working Features

- ✅ Pronunciation Practice
- ✅ 1v1 Battle (WebSocket)
- ✅ Group Debate (with content scoring)
- ✅ Group Discussion (Push-to-Talk)
- ✅ Voice Cruise Control ⭐ (now works with HTTPS!)
- ✅ Interview Studio ⭐ (now works with HTTPS!)
- ✅ Admin Panel (all 8 tabs)
- ✅ CSV Exports
