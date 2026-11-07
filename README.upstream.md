# MindGit Agent v2

De **agent** laat MindGit repositories synchroniseren op een andere machine (Windows,
Linux of macOS). Hij praat via WebSocket met je MindGit-server (de **coordinator**) en
voert git-taken uit: clonen, syncen, pullen, pushen, branches, status, diffs en meer.

Deze v2 is een **drop-in vervanger** voor de oude agent: hij spreekt exact hetzelfde
protocol (v1.0), dus je hoeft de MindGit-server niet aan te passen. Daarbovenop is hij
uitgebreider, robuuster en beter te beheren.

---

## Nieuw in v2

| Onderdeel | v1 | v2 |
| --- | --- | --- |
| Configuratie | losse env-checks | [`zod`](https://zod.dev)-validatie met duidelijke fouten |
| Logging | `console.log` | gestructureerde [`pino`](https://getpino.io)-logs, optioneel pretty/bestand |
| Geheimen | handmatig | automatische redactie van tokens en node-key in **alle** logs |
| Git-uitvoering | `spawnSync` | async `spawn` met timeout, **annuleren** (AbortController) en retry |
| Verbinding | vaste reconnect | exponentiële backoff + jitter, ping/pong keepalive |
| Taken | 1 tegelijk | read-only queries draaien **naast** een sync; mutaties geserialiseerd |
| Self-update | vaste bestandslijst | **manifest met sha256**, atomaire writes, rollback, optionele `npm install` |
| CLI | alleen starten | `start`, `doctor`, `config`, `update`, `--version` |
| Capabilities | geen | agent meldt versie/platform/features aan de coordinator |
| Tests | geen | 33 tests (`node --test`), incl. end-to-end protocol-test |

---

## Vereisten

- **Node.js 18+**
- **Git** (in je `PATH`)
- **npm** (voor installatie en auto-update)
- Netwerktoegang tot je MindGit-server (de agent maakt *uitgaand* verbinding)

---

## Installatie

### Snel (Linux/macOS)

```bash
curl -fsSL http://JOUW-SERVER:3000/agent/scripts/install-linux.sh | bash -s -- \
  --coordinator=http://JOUW-SERVER:3000 \
  --node-key=JOUW_NODE_KEY
```

Het script installeert dependencies, maakt een `.env`, en zet optioneel een
systemd-service (Linux) of launchd-taak (macOS) op.

### Windows

Download `http://JOUW-SERVER:3000/agent/scripts/install-windows.bat` en voer het uit:

```bat
install-windows.bat --coordinator=http://JOUW-SERVER:3000 --node-key=JOUW_NODE_KEY
```

Je kunt kiezen uit een Windows-service (via [nssm](https://nssm.cc/)), een geplande
taak bij aanmelding, of handmatig starten.

### Handmatig

```bash
git clone https://github.com/MindOfPersonal/Mindgit-agent.git
cd Mindgit-agent
npm install --omit=dev
cp .env.example .env      # vul COORDINATOR_URL en NODE_KEY in
node index.js doctor      # controleer alles
node index.js             # start de agent
```

---

## Configuratie (`.env`)

De volledige lijst staat in [`.env.example`](.env.example). De belangrijkste:

```env
COORDINATOR_URL=http://localhost:3000
NODE_KEY=je-node-key-uit-het-dashboard

LOG_LEVEL=info
GIT_TIMEOUT=15000
GIT_LONG_TIMEOUT=30000
GIT_MAX_RETRIES=2

BROWSE_ROOTS=/home/user/projecten,/srv/repos

UPDATE_ENABLED=true
UPDATE_REPO=MindOfPersonal/Mindgit-agent
UPDATE_BRANCH=master
UPDATE_INTERVAL=3600000
UPDATE_VERIFY=true
```

- **`COORDINATOR_URL`** — adres van je MindGit-server zoals *deze* machine die bereikt.
- **`NODE_KEY`** — de node-key uit het dashboard (Nodes → Node toevoegen). Wordt maar
  één keer getoond.
- **`BROWSE_ROOTS`** — mappen die de map-browser in het dashboard mag tonen. Leeg =
  de home-map van de gebruiker.
- **`RECONNECT_MAX_ATTEMPTS`** — `0` (default) betekent oneindig blijven proberen.

Expliciete omgevingsvariabelen hebben **voorrang** op `.env`.

---

## CLI

```bash
node index.js                 # start de agent (ook: node index.js start)
node index.js doctor          # controleer Node, Git, npm, .env, rechten, coordinator
node index.js config          # toon de gevalideerde configuratie (geheimen geredigeerd)
node index.js update          # forceer een self-update-check
node index.js --version       # toon de agent-versie
```

`doctor` is de snelste manier om een probleem te vinden:

```
[ OK ] Agent-versie — 2.0.7 (protocol 1.0)
[ OK ] Node.js — v22.23.2
[ OK ] Git — git version 2.43.0
[ OK ] Configuratie — coordinator http://server:3000
[ OK ] Coordinator bereikbaar — http://server:3000 (HTTP 200)
[ OK ] WebSocket-endpoint — ws://server:3000/agent
```

### Console

Standaard schrijft de agent **JSON** naar stdout (ideaal voor systemd/journald).
Op een terminal (of met `LOG_PRETTY=true`) krijg je een leesbare weergave:

```
  ╭────────────────────────────────────────╮
  │ MindGit Agent v2.0.7                   │
  │ coordinator  http://server:3000        │
  │ platform     linux/x64 · node v22.23.2 │
  ╰────────────────────────────────────────╯

02:06:14 INFO  Verbonden met coordinator
02:06:14 INFO  Geregistreerd als node "Mijn PC" (id 3)
02:07:02 INFO  Taak klaar: sync "cambuur" (repo 59) — Merged 2 commits, Pushed 1 commits
```

- Routinematige read-only queries (dashboard-poll) staan op **debug** en zijn dus
  onzichtbaar op het standaard `info`-niveau. Zet `LOG_LEVEL=debug` om ze te zien.
- `NO_COLOR=1` schakelt kleur uit; `LOG_FILE` schrijft daarnaast JSON naar een bestand.
- Vriendelijke foutmeldingen: `Taak mislukt: sync "cambuur" (repo 59) — Repository niet gevonden op GitHub`.

---

## Hoe het werkt

1. De agent verbindt naar `ws(s)://COORDINATOR/agent` met de `X-Node-Key`-header.
2. Hij stuurt `agent_info` (platform, git-versie, capabilities) en ontvangt zijn node-id.
3. Elke 30 s stuurt hij een heartbeat; de server houdt `last_seen` bij.
4. De coordinator stuurt taken (`sync_repo`, `get_status`, …) met een `correlationId`.
5. De agent antwoordt met `task_started` / `task_progress` / `task_completed` of
   `task_failed`, en bij conflicten met `conflict_detected`.

Read-only taken (`get_status`, `get_branches`, `get_repo_data`, `get_commit`,
`get_diff`, `browse_dir`) mogen naast een lopende sync draaien. Muterende taken
(`sync`, `clone`, `create`, `fetch`, `pull`, `push`, `switch_branch`,
`resolve_conflict`) worden één voor één uitgevoerd; een tweede krijgt
`Agent busy with another task`.

GitHub-tokens komen **per taak** binnen en worden per git-commando als
`http.extraHeader` meegegeven — nooit in de remote-URL of in de logs.

### Mappenstructuur

```
index.js                 CLI-entry (start standaard de agent)
lib/agent-protocol.js    wire-protocol v1.0 (ook gebruikt door MindGit)
src/
  agent.js               verbinding, heartbeat, taakroutering, cancel
  cli.js                 commander-CLI + doctor
  config.js              zod-configuratie
  logger.js              pino-logger met redactie
  redact.js              geheimen onherkenbaar maken
  version.js             versievergelijking
  git/runner.js          git spawn met timeout/abort/retry
  git/repo.js            git-helpers (clone/status/branch/…)
  tasks/                 één bestand per taaktype
  update/updater.js      self-update met manifest + hashes
scripts/                 installatiescripts + manifest-generator
deploy/                  voorbeeld systemd/launchd-units
test/                    node --test suites
```

---

## Auto-update

De agent werkt zichzelf bij vanuit de publieke repo
[`MindOfPersonal/Mindgit-agent`](https://github.com/MindOfPersonal/Mindgit-agent).

1. Bij de start (na 10 s) en daarna elk uur haalt hij `package.json` op.
2. Is de remote-versie hoger, dan leest hij `update-manifest.json` (sha256 per bestand).
3. Elk bestand wordt gedownload, **geverifieerd** en atomisch weggeschreven.
4. Bij een fout worden alle wijzigingen teruggedraaid (`.bak`-backups).
5. Is `package.json` gewijzigd, dan draait de agent best-effort `npm install`.
6. De agent stopt (exitcode 1); de **service** (systemd/nssm/launchd/PM2) start hem
   automatisch opnieuw met de nieuwe code.

> **Let op:** draait de agent handmatig (`node index.js`) zonder supervisor, dan
> stopt hij na een update en moet je hem zelf opnieuw starten. Gebruik voor
> automatische updates altijd de service uit het installatiescript.

### Een update uitbrengen (checklist)

1. Pas de code aan in deze repo.
2. **Verhoog `version`** in `package.json` (hoger dan wat de nodes draaien,
   bijv. `2.0.0` → `2.0.1`). Zonder versieverhoging ziet de agent géén update.
3. Draai `npm run manifest` → werkt `update-manifest.json` bij (sha256 per bestand).
4. Draai `npm test` (alles groen).
5. `git add -A && git commit && git push` naar `MindOfPersonal/Mindgit-agent`
   (branch `master`).
6. De nodes pakken het vanzelf op (bij hun volgende check), of forceer het op een
   node met `node index.js update` en herstart de service.

> Zet alleen vertrouwde code in de repo — de agent voert die uit. Vergeet stap 2 en 3
> niet: zonder nieuwe versie of manifest gebeurt er niets.

### Migreren van v1 naar v2

De **oude v1-agent** kan zichzelf niet in één keer naar v2 bijwerken: v1 kopieert
alleen `index.js`, `package.json`, `package-lock.json` en `lib/agent-protocol.js`,
installeert geen nieuwe dependencies en kent de `src/`-map niet. Doe daarom op elke
bestaande v1-machine **eenmalig** een herinstallatie:

```bash
# Linux/macOS: pak het nieuwe agent-pakket over de installatiemap en herstart
curl -fsSL http://JOUW-SERVER:3000/agent/download -o /tmp/agent.tgz
tar -xzf /tmp/agent.tgz -C ~/.local/share/mindgit-agent
cd ~/.local/share/mindgit-agent && npm install --omit=dev
# herstart de service (systemd: sudo systemctl restart mindgit-agent)
```

Of gebruik het installatiescript opnieuw (het werkt de map bij en houdt `.env`).

Daarna werkt de v2-agent en gaan **alle volgende updates automatisch via deze
repo** (`MindOfPersonal/Mindgit-agent`).

---

## Beveiliging

- De node-key wordt alleen als SHA-256-hash opgeslagen op de server.
- Tokens en de node-key worden geredigeerd in logs en foutmeldingen.
- `browse_dir` is beperkt tot `BROWSE_ROOTS` (met bescherming tegen `../`-traversal).
- De `.env` bevat je node-key: bewaar het veilig (staat in `.gitignore`).

---

## Ontwikkelen

```bash
npm install
npm test          # 33 tests, waaronder een end-to-end protocol-test
npm run doctor
```

## Protocol-compatibiliteit

`lib/agent-protocol.js` is de bron van waarheid voor het wire-protocol en wordt
óók door het hoofdproject MindGit gebruikt (`require('../agent/lib/agent-protocol')`).
`PROTOCOL_VERSION` is en blijft `1.0`. Voeg alleen nieuwe dingen toe; verander nooit
bestaande berichtnamen of -waarden.

## Licentie

MIT — MindDevelopment.
