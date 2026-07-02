#!/bin/bash
# ═══════════════════════════════════════════════
# AutoPrint — Raspberry Pi Setup Script
# Run this on a fresh Raspberry Pi OS installation
# Usage: chmod +x setup.sh && sudo ./setup.sh
# ═══════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════╗"
echo "║  🖨️  AutoPrint — Pi Setup                ║"
echo "╚══════════════════════════════════════════╝"

# 1. System updates
echo "[1/6] Updating system..."
apt update && apt upgrade -y

# 2. Install CUPS (print server)
echo "[2/6] Installing CUPS print server..."
apt install -y cups
usermod -aG lpadmin pi
cupsctl --remote-any
systemctl enable cups
systemctl restart cups

# 3. Install common printer drivers
echo "[3/6] Installing printer drivers..."
apt install -y printer-driver-gutenprint printer-driver-hpcups

# 4. Install Node.js 20.x
echo "[4/6] Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 5. Install build tools for native modules (better-sqlite3)
echo "[5/6] Installing build tools..."
apt install -y build-essential python3

# 6. Verify installations
echo "[6/6] Verifying installations..."
echo "  CUPS:    $(cups-config --version 2>/dev/null || echo 'installed')"
echo "  Node.js: $(node --version)"
echo "  npm:     $(npm --version)"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅ Setup complete!                      ║"
echo "║                                          ║"
echo "║  Next steps:                             ║"
echo "║  1. Connect your printer via USB         ║"
echo "║  2. Open http://$(hostname -I | awk '{print $1}'):631    ║"
echo "║     in your browser to configure CUPS    ║"
echo "║  3. Add your printer in CUPS admin       ║"
echo "║  4. Note the printer name from CUPS      ║"
echo "║  5. Update .env with the printer name    ║"
echo "║  6. cd backend && npm install            ║"
echo "║  7. npm start                            ║"
echo "╚══════════════════════════════════════════╝"
