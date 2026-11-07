#!/usr/bin/env bash
# MindGit Agent — koppel deze bestaande agent-map aan een coordinator.
#
# Gebruik:
#   ./scripts/connect.sh https://git.minddev.nl JOUW_NODE_KEY
#
# Het script:
#   1. schrijft/werkt COORDINATOR_URL en NODE_KEY bij in .env
#   2. installeert de productie-dependencies
#   3. draait `node index.js doctor`
#
# Daarna start je de agent met `node index.js`, PM2 of systemd.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Gebruik: $0 <coordinator-url> <node-key>" >&2
  echo "Voorbeeld: $0 https://git.minddev.nl 0123abcd..." >&2
  exit 1
fi

COORDINATOR="${1%/}"
NODE_KEY="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

command -v node >/dev/null 2>&1 || { echo "FOUT: Node.js 18+ is nodig." >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "FOUT: Git is nodig." >&2; exit 1; }

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
  # Vervang bestaande regels of voeg ze toe.
  if grep -q '^COORDINATOR_URL=' "$ENV_FILE"; then
    sed -i "s|^COORDINATOR_URL=.*|COORDINATOR_URL=$COORDINATOR|" "$ENV_FILE"
  else
    printf '\nCOORDINATOR_URL=%s\n' "$COORDINATOR" >> "$ENV_FILE"
  fi
  if grep -q '^NODE_KEY=' "$ENV_FILE"; then
    sed -i "s|^NODE_KEY=.*|NODE_KEY=$NODE_KEY|" "$ENV_FILE"
  else
    printf 'NODE_KEY=%s\n' "$NODE_KEY" >> "$ENV_FILE"
  fi
else
  cat > "$ENV_FILE" <<EOF
# MindGit Agent — configuratie
COORDINATOR_URL=$COORDINATOR
NODE_KEY=$NODE_KEY

LOG_LEVEL=info
LOG_PRETTY=true
GIT_TIMEOUT=15000
GIT_LONG_TIMEOUT=30000
GIT_MAX_RETRIES=2
HEARTBEAT_INTERVAL=30000
TASK_TIMEOUT=300000
RECONNECT_BASE_DELAY=5000
RECONNECT_MAX_ATTEMPTS=0

# Pas aan naar de mappen die de mapbrowser mag tonen:
# BROWSE_ROOTS=/home/user/projecten,/srv/repos

# Self-update (laat uit tenzij je een eigen, vertrouwde update-bron hebt)
UPDATE_ENABLED=false
EOF
fi
chmod 600 "$ENV_FILE"

cd "$ROOT"
if [[ -d "$ROOT/node_modules/ws" ]]; then
  echo "Dependencies zijn al aanwezig; npm install wordt overgeslagen."
else
  echo "Dependencies installeren..."
  npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent
fi

echo
node index.js doctor
echo
echo "Klaar. Start de agent met:"
echo "  node $ROOT/index.js"
echo "of met PM2:"
echo "  pm2 start $ROOT/ecosystem.config.js && pm2 save"
