#!/bin/bash
# MindGit Agent v2 - Linux/macOS Installer
# Usage:
#   curl -fsSL http://SERVER:3000/agent/scripts/install-linux.sh | bash -s -- \
#     --coordinator=http://SERVER:3000 --node-key=JOUW_KEY
#   or: bash install-linux.sh [--system] [--user] [--dir=PATH] [--coordinator=URL] [--node-key=KEY]

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

print_header() {
    echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     MindGit Agent v2 - Installer         ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
    echo
}
print_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SYSTEM_INSTALL=false
DIR_GIVEN=false
COORDINATOR_URL="${COORDINATOR_URL:-}"
NODE_KEY="${NODE_KEY:-}"

if [[ $EUID -eq 0 ]]; then
    SYSTEM_INSTALL=true
    INSTALL_DIR="/opt/mindgit-agent"
    SERVICE_USER="mindgit-agent"
    SERVICE_GROUP="mindgit-agent"
else
    INSTALL_DIR="$HOME/.local/share/mindgit-agent"
    SERVICE_USER="$USER"
    SERVICE_GROUP="$(id -gn)"
fi

for arg in "$@"; do
    case $arg in
        --system)
            if [[ $EUID -ne 0 ]]; then print_error "System install requires root (sudo)"; exit 1; fi
            SYSTEM_INSTALL=true; INSTALL_DIR="/opt/mindgit-agent" ;;
        --user) SYSTEM_INSTALL=false; INSTALL_DIR="$HOME/.local/share/mindgit-agent" ;;
        --dir=*) DIR_GIVEN=true; INSTALL_DIR="${arg#*=}" ;;
        --coordinator=*) COORDINATOR_URL="${arg#*=}" ;;
        --node-key=*) NODE_KEY="${arg#*=}" ;;
        --help)
            echo "Usage: $0 [options]"
            echo "  --system          Install system-wide (requires sudo)"
            echo "  --user            Install for current user (default)"
            echo "  --dir=PATH        Custom install directory"
            echo "  --coordinator=URL Coordinator URL (e.g. http://server:3000)"
            echo "  --node-key=KEY    Node key from the MindGit dashboard"
            exit 0 ;;
    esac
done

print_header

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+"
    echo "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "  RHEL/Fedora:   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo dnf install -y nodejs"
    echo "  macOS:         brew install node"
    exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [[ $NODE_MAJOR -lt 18 ]]; then print_error "Node.js 18+ required. Current: $NODE_VERSION"; exit 1; fi
print_ok "Node.js $NODE_VERSION found"

if ! command -v git &> /dev/null; then print_error "Git is not installed. Please install Git"; exit 1; fi
print_ok "Git found"

if ! command -v npm &> /dev/null; then print_error "npm is not installed"; exit 1; fi
print_ok "npm found"

if [[ -t 0 ]]; then
    if [[ "$DIR_GIVEN" != true ]]; then
        read -rp "Install directory [default: $INSTALL_DIR]: " INPUT_DIR
        if [[ -n "$INPUT_DIR" ]]; then INSTALL_DIR="$INPUT_DIR"; fi
    fi
    if [[ -z "$COORDINATOR_URL" ]]; then
        read -rp "Coordinator URL [default: https://git.minddev.nl]: " COORDINATOR_URL
        COORDINATOR_URL="${COORDINATOR_URL:-https://git.minddev.nl}"
    fi
    if [[ -z "$NODE_KEY" ]]; then
        read -rp "Node key (from dashboard, Nodes > Add Node): " NODE_KEY
    fi
fi

print_info "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" 2>/dev/null)" 2>/dev/null && pwd || echo '')"

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../index.js" ]; then
    AGENT_DIR="$(dirname "$SCRIPT_DIR")"
    print_info "Copying agent files from $AGENT_DIR..."
    cp -r "$AGENT_DIR"/* "$INSTALL_DIR"/
    print_ok "Files copied"
else
    if [ -z "$COORDINATOR_URL" ]; then
        print_error "COORDINATOR_URL is verplicht bij een piped install."
        print_info "Voorbeeld: curl -fsSL http://server:3000/agent/scripts/install-linux.sh | bash -s -- --coordinator=http://server:3000 --node-key=JOUW_KEY"
        exit 1
    fi
    print_info "Downloading agent package from $COORDINATOR_URL/agent/download ..."
    TGZ=/tmp/mindgit-agent.tar.gz
    ok=false
    for attempt in 1 2 3; do
        rm -f "$TGZ"
        curl -fsSL "$COORDINATOR_URL/agent/download" -o "$TGZ" || true
        if [ -s "$TGZ" ] && tar -tzf "$TGZ" >/dev/null 2>&1; then ok=true; break; fi
        print_warn "Download ongeldig (poging $attempt/3)."
        sleep 2
    done
    if [ "$ok" != true ]; then
        print_error "Kon een geldig agent-pakket niet downloaden van $COORDINATOR_URL."
        rm -f "$TGZ"
        exit 1
    fi
    tar -xzf "$TGZ" -C "$INSTALL_DIR"
    rm -f "$TGZ"
    print_ok "Agent package downloaded and extracted"
fi

print_info "Installing npm dependencies..."
cd "$INSTALL_DIR"
npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent
print_ok "Dependencies installed"

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    print_info "Creating .env template..."
    cat > "$INSTALL_DIR/.env" << EOF
# MindGit Agent v2 configuration
# Values from the MindGit dashboard (Nodes > Add Node).

COORDINATOR_URL=${COORDINATOR_URL:-https://git.minddev.nl}
NODE_KEY=${NODE_KEY:-your-node-key-from-dashboard}

# Optional
LOG_LEVEL=info
GIT_TIMEOUT=15000
GIT_LONG_TIMEOUT=30000
GIT_MAX_RETRIES=2

# Mappen die de dashboard-mapbrowser op deze machine mag tonen.
# Leeg = home-map van de gebruiker.
# BROWSE_ROOTS=/home/user/projecten,/srv/repos

# Auto-update staat standaard uit. Zet dit alleen aan als je een eigen,
# vertrouwde update-bron hebt (de agent voert die code uit).
UPDATE_ENABLED=false
UPDATE_REPO=MindOfPersonal/agent-mindgit
UPDATE_BRANCH=master
UPDATE_INTERVAL=3600000
UPDATE_VERIFY=true
EOF
    print_ok ".env template created at $INSTALL_DIR/.env"
fi

if [[ "$SYSTEM_INSTALL" == true ]]; then
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd --system --no-create-home --shell /bin/false "$SERVICE_USER" 2>/dev/null || true
    fi
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    chmod 750 "$INSTALL_DIR"
    chmod 640 "$INSTALL_DIR/.env"
else
    chmod 700 "$INSTALL_DIR"
    chmod 600 "$INSTALL_DIR/.env"
fi

if [[ "$(uname)" == "Linux" ]]; then
    print_info "Installing systemd service..."
    cat > /etc/systemd/system/mindgit-agent.service << EOF
[Unit]
Description=MindGit Distributed Repository Sync Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$(command -v node) $INSTALL_DIR/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mindgit-agent

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable mindgit-agent || true
    print_ok "Systemd service installed and enabled"
    print_info "Start: sudo systemctl start mindgit-agent"
    print_info "Logs:  sudo journalctl -u mindgit-agent -f"

elif [[ "$(uname)" == "Darwin" ]]; then
    PLIST_DIR="$HOME/Library/LaunchAgents"
    if [[ "$SYSTEM_INSTALL" == true ]]; then PLIST_DIR="/Library/LaunchDaemons"; fi
    mkdir -p "$PLIST_DIR"
    PLIST_FILE="$PLIST_DIR/com.mindgit.agent.plist"
    print_info "Installing launchd service..."
    cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.mindgit.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(command -v node)</string>
        <string>$INSTALL_DIR/index.js</string>
    </array>
    <key>WorkingDirectory</key><string>$INSTALL_DIR</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$INSTALL_DIR/agent.log</string>
    <key>StandardErrorPath</key><string>$INSTALL_DIR/agent.error.log</string>
</dict>
</plist>
EOF
    if [[ "$SYSTEM_INSTALL" == true ]]; then
        sudo launchctl load "$PLIST_FILE" || true
        sudo launchctl start com.mindgit.agent || true
    else
        launchctl load "$PLIST_FILE" || true
        launchctl start com.mindgit.agent || true
    fi
    print_ok "Launchd service installed"
else
    print_warn "No systemd/launchd detected. Manual start required."
fi

echo
echo -e "${GREEN}Installation complete.${NC}"
echo "Next steps:"
echo "1. Edit $INSTALL_DIR/.env with your coordinator URL and node key"
echo "2. Verify: $INSTALL_DIR/index.js doctor  (or: node $INSTALL_DIR/index.js doctor)"
echo "3. Start the agent"
echo
