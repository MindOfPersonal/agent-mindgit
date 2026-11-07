#!/usr/bin/env bash
# MindGit — maak een nieuwe node aan op de coordinator en print de node-key.
#
# Gebruik:
#   ./scripts/new-node.sh --server https://git.minddev.nl --user admin --name "webserver-2"
#
# Opties:
#   --server URL      Coordinator (default: https://git.minddev.nl)
#   --user USER       Dashboard-gebruiker (verplicht)
#   --name NAME       Naam van de node (default: hostname van deze machine)
#   --platform P      linux | windows | macos | unknown (default: linux)
#   --password PASS   Wachtwoord (anders wordt er veilig omgevraagd)
#   --token TOKEN     Bestaand API-bearer-token i.p.v. gebruikersnaam/wachtwoord
#
# De node-key wordt maar één keer getoond. Bewaar hem goed.

set -euo pipefail

SERVER="https://git.minddev.nl"
USERNAME=""
NAME="$(hostname 2>/dev/null || echo node)"
PLATFORM="linux"
PASSWORD=""
TOKEN=""

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) SERVER="${2:?}"; shift 2 ;;
    --user) USERNAME="${2:?}"; shift 2 ;;
    --name) NAME="${2:?}"; shift 2 ;;
    --platform) PLATFORM="${2:?}"; shift 2 ;;
    --password) PASSWORD="${2:?}"; shift 2 ;;
    --token) TOKEN="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Onbekende optie: $1" >&2; usage; exit 1 ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "FOUT: Node.js is nodig (voor JSON-verwerking)." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FOUT: curl is nodig." >&2; exit 1; }

SERVER="${SERVER%/}"

json() {
  node -e 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2],name:process.argv[3],platform:process.argv[4]}))' "$@"
}

DID_LOGIN=false
if [[ -z "$TOKEN" ]]; then
  if [[ -z "$USERNAME" ]]; then
    read -rp "Dashboard-gebruiker: " USERNAME
  fi

  if [[ -z "$PASSWORD" ]]; then
    read -rsp "Wachtwoord voor $USERNAME: " PASSWORD
    echo
  fi

  LOGIN_BODY=$(json "$USERNAME" "$PASSWORD" "" "")
  LOGIN_RESP=$(curl -sS -X POST "$SERVER/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$LOGIN_BODY" || true)

  TOKEN=$(node -e '
    let r; try { r = JSON.parse(process.argv[1]); } catch { console.error("Geen geldig antwoord van de server."); process.exit(1); }
    if (!r.success || !r.data || !r.data.token) { console.error("Inloggen mislukt: " + (r.error || "onbekende fout")); process.exit(1); }
    process.stdout.write(r.data.token);
  ' "$LOGIN_RESP") || exit 1
  DID_LOGIN=true
fi

CREATE_BODY=$(json "" "" "$NAME" "$PLATFORM")
CREATE_RESP=$(curl -sS -X POST "$SERVER/api/nodes" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$CREATE_BODY" || true)

# Alleen een token dat we zelf hebben aangemaakt direct intrekken.
if [[ "$DID_LOGIN" == true ]]; then
  curl -sS -X POST "$SERVER/api/auth/logout" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
fi

node -e '
  let r; try { r = JSON.parse(process.argv[1]); } catch { console.error("Geen geldig antwoord van de server."); process.exit(1); }
  if (!r.success || !r.data) { console.error("Node aanmaken mislukt: " + (r.error || "onbekende fout")); process.exit(1); }
  const n = r.data;
  console.log("");
  console.log("Node aangemaakt:");
  console.log("  id        " + n.id);
  console.log("  naam      " + n.name);
  console.log("  platform  " + n.platform);
  console.log("  node-key  " + n.nodeKey);
  console.log("");
  console.log("Bewaar de key goed — hij wordt maar één keer getoond.");
  console.log("");
  console.log("Installeer de agent op die server met:");
  console.log("  curl -fsSL " + process.argv[2] + "/agent/scripts/install-linux.sh | sudo bash -s -- \\");
  console.log("    --coordinator=" + process.argv[2] + " --node-key=" + n.nodeKey);
' "$CREATE_RESP" "$SERVER"
