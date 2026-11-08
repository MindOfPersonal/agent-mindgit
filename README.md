# MindGit Agent — zelfstandige node-agent

Deze map bevat een **volledig zelfstandige agent** die via WebSocket met een
MindGit-server (de *coordinator*) praat. Je kunt hem op elke Linux-, macOS- of
Windows-machine zetten om daar repositories te **clonen, syncen, pullen, pushen,
branchen en aanmaken** vanuit het MindGit-dashboard.

Je hebt op de doel-machine **niet** het hele MindGit-project nodig: deze map is
compleet. Node.js 18+, Git en npm zijn voldoende.

---

## Status op deze machine

Deze kopie is al geconfigureerd en draait:

| | |
| --- | --- |
| Coordinator | `https://git.minddev.nl` |
| Node in dashboard | **vps** (platform `linux`) |
| Service | PM2-proces **MindGitAgent** |
| Configuratie | `.env` (bevat de node-key, staat in `.gitignore`) |
| Update-bron | `MindOfPersonal/agent-mindgit@master` |
| Auto-update | uit (versiecheck via `doctor`; zet `UPDATE_ENABLED=true` om bij te werken) |

Controleren of hij online is:

```bash
pm2 status MindGitAgent
pm2 logs MindGitAgent --lines 50
```

In het dashboard staat de node onder **Nodes** op 🟢 **Online**.

---

## Snel een *andere* server koppelen

### 1. Maak een node aan en haal de key op

In het dashboard: **Nodes → Node toevoegen**, geef een naam en platform, en
kopieer de getoonde **Node Key** (64 tekens; je ziet hem maar één keer).

Of vanaf de command line (handig als je de dashboard-knop niet wilt gebruiken):

```bash
./scripts/new-node.sh --server https://git.minddev.nl --user admin --name "webserver-2" --platform linux
```

Het script logt in met je dashboard-account, maakt de node aan en print de key
plus een kant-en-klaar installatiecommando.

### 2. Installeer de agent op de doel-server

**Optie A — één commando (Linux/macOS, aanbevolen)**

```bash
curl -fsSL https://git.minddev.nl/agent/scripts/install-linux.sh | sudo bash -s -- \
  --coordinator=https://git.minddev.nl \
  --node-key=JOUW_NODE_KEY
```

Het script installeert in `/opt/mindgit-agent`, zet een systemd-service op en
start die automatisch. Op macOS wordt een launchd-taak aangemaakt.

**Optie B — deze map kopiëren**

Kopieer de map (zonder `node_modules` en zonder `.env`!) naar de doel-server en
draai daar:

```bash
./scripts/connect.sh https://git.minddev.nl JOUW_NODE_KEY
```

Dat schrijft de `.env`, installeert de dependencies en draait `doctor`.

**Windows**

Download `https://git.minddev.nl/agent/scripts/install-windows.bat` en voer uit:

```bat
install-windows.bat --coordinator=https://git.minddev.nl --node-key=JOUW_NODE_KEY
```

### 3. Controleer de verbinding

```bash
node index.js doctor     # alles groen?
node index.js            # handmatig starten (of gebruik de service)
```

Daarna staat de node in het dashboard op **Online**. Wijs vervolgens repositories
toe via **Nodes → jouw node → Repository toewijzen** (kies pad, richting en
optioneel auto-sync).

---

## Handmatige installatie (zonder scripts)

```bash
# 1. Node.js 18+, Git en npm installeren (eenmalig)
node --version && git --version && npm --version

# 2. In deze map:
npm ci --omit=dev

# 3. Configuratie
cp .env.example .env
#    zet COORDINATOR_URL en NODE_KEY in .env

# 4. Controleren en starten
node index.js doctor
node index.js
```

---

## Configuratie (`.env`)

De belangrijkste variabelen:

| Variabele | Betekenis |
| --- | --- |
| `COORDINATOR_URL` | Adres van de MindGit-server zoals *deze* machine hem bereikt (standaard `https://git.minddev.nl`) |
| `NODE_KEY` | Node-key uit het dashboard (geheim) |
| `BROWSE_ROOTS` | Komma-gescheiden mappen die de mapbrowser mag tonen |
| `LOG_LEVEL` | `debug`, `info`, `warn` of `error` |
| `LOG_PRETTY` | `true` = leesbare logs, `false` = JSON (services) |
| `GIT_TIMEOUT` / `GIT_LONG_TIMEOUT` | Git-timeouts in ms |
| `HEARTBEAT_INTERVAL` | Heartbeat-interval in ms (standaard 30 s) |
| `RECONNECT_MAX_ATTEMPTS` | `0` = oneindig blijven herverbinden |
| `UPDATE_ENABLED` | Self-update aan/uit (standaard hier: uit) |
| `UPDATE_REPO` | GitHub-repo voor de versiecheck/self-update (standaard `MindOfPersonal/agent-mindgit`) |

Zie `.env.example` voor de volledige lijst. Expliciete omgevingsvariabelen gaan
vóór op `.env`.

---

## Beheer

```bash
node index.js doctor      # diagnose: Node, Git, npm, .env, rechten, coordinator
node index.js config      # toon configuratie (geheimen geredigeerd)
node index.js update      # self-update-check (alleen bij UPDATE_ENABLED=true)
node index.js --version   # versie
```

Met PM2 (zoals op deze machine):

```bash
pm2 restart MindGitAgent
pm2 logs MindGitAgent --lines 100
pm2 stop MindGitAgent
pm2 delete MindGitAgent
pm2 start ecosystem.config.js
pm2 save
```

Met systemd (installatiescript):

```bash
sudo systemctl status mindgit-agent
sudo journalctl -u mindgit-agent -f
sudo systemctl restart mindgit-agent
```

---

## Hoe het werkt

1. De agent maakt **uitgaand** verbinding naar `ws(s)://COORDINATOR/agent` met
   de `X-Node-Key`-header. Je hoeft dus geen poort op de doel-machine te openen.
2. Hij stuurt platform, git-versie en capabilities mee en krijgt een node-id.
3. Elke 30 s gaat er een heartbeat naar de coordinator.
4. De coordinator stuurt taken (`sync_repo`, `clone_repo`, `get_status`, …) met
   een `correlationId`; de agent antwoordt met voortgang en resultaat.
5. GitHub-tokens komen **per taak** binnen en worden per git-commando als
   `http.extraHeader` meegegeven — nooit in de remote-URL of in de logs.

Read-only taken (status, branches, diff, browse) mogen naast een sync draaien;
muterende taken worden één voor één uitgevoerd.

---

## Mappenstructuur

```
index.js                 CLI-entry (start standaard de agent)
lib/agent-protocol.js    wire-protocol v1.0 (ook gebruikt door MindGit)
src/agent.js             verbinding, heartbeat, taakroutering, cancel
src/cli.js               CLI + doctor
src/config.js            zod-configuratie
src/logger.js            pino-logger met redactie
src/git/                 git-runner en repo-helpers
src/tasks/               één bestand per taaktype
src/update/updater.js    self-update met manifest + sha256
scripts/                 installatie- en hulpscripts
deploy/                  voorbeeld systemd/launchd-units
test/                    47 tests (node --test)
ecosystem.config.js      PM2-configuratie
```

---

## Problemen oplossen

| Symptoom | Oplossing |
| --- | --- |
| Node blijft ⚫ offline | Controleer `COORDINATOR_URL`, de firewall/server en of `NODE_KEY` exact klopt. |
| `Invalid node key` | Key klopt niet (spaties?) of de node is verwijderd. Maak een nieuwe node aan. |
| `connect ECONNREFUSED` | Server/poort niet bereikbaar vanaf de doel-machine. |
| Clone/sync: `Authentication failed` | Het gekoppelde GitHub-account heeft geen geldige token of geen toegang tot de repo. |
| Taak blijft **In wachtrij** | Node is offline of de server ziet hem nog niet (paar seconden wachten). |
| `Repository already exists at ...` | Op dat pad staat al een git-repo; kies een ander pad. |

Meer achtergrond staat in `README.upstream.md` en in de MindGit-docs
(`Docs/nodes.md`).

---

## Beveiliging

- De node-key wordt op de server alleen als SHA-256-hash opgeslagen.
- Tokens en de node-key worden in logs geredigeerd.
- De mapbrowser is beperkt tot `BROWSE_ROOTS` (met `../`-bescherming).
- Bewaar `.env` veilig: het bevat de node-key. Deel of commit hem nooit.
- Zet alleen vertrouwde code in een eventuele self-update-bron.

---

## Licentie

MIT — MindDevelopment.
