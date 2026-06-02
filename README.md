# Agent Oversight Portal

Real-time oversight dashboard for two collaborating AI agents (OpenClaw + Hermes). Routes events to a Telegram group for operator visibility.

## Overview

The portal ingests events from two AI agents, stores them durably, displays them live on a web dashboard, and automatically alerts a Telegram group when critical events occur.

```
Agent 1 (OpenClaw)  ─┐
                     ├─→ POST /api/events ─→ [Portal] ─→ Dashboard (SSE)
Agent 2 (Hermes)    ─┘                        ↓
                                    Alert Routing → Telegram Group
```

## Features

- **Event Ingestion API** — authenticated endpoint for agents to POST events
- **Real-time Dashboard** — live event stream with filters (agent, severity, type) and searchable history
- **Alert Routing** — automatic forwarding of warning/critical events to Telegram
- **Event Store** — durable SQLite storage of all events
- **Security** — token-based auth, bound to loopback by default, no secrets in repo

## Event Schema

All events conform to this canonical shape:

```json
{
  "id": "uuid",
  "timestamp": "ISO-8601",
  "agent": "openclaw | hermes",
  "type": "action | tool_call | task_start | task_end | decision | error | alert",
  "severity": "debug | info | warning | critical",
  "title": "short human-readable summary",
  "detail": "optional longer text or structured payload",
  "task_id": "optional correlation id linking related events",
  "metadata": { "free-form key/values" }
}
```

## API Contract

### `POST /api/events`

Ingest one event or a batch. Requires `Authorization: Bearer <PORTAL_INGEST_TOKEN>`.

```bash
curl -X POST http://127.0.0.1:8900/api/events \
  -H "Authorization: Bearer your-ingest-token" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "openclaw",
    "type": "task_start",
    "severity": "info",
    "title": "Started deployment task",
    "task_id": "deploy-abc123"
  }'
```

Response:
```json
{
  "id": "event-uuid",
  "timestamp": "2026-06-02T14:00:00Z",
  "stored": true
}
```

### `GET /api/events`

Query event history with filters.

```
GET /api/events?agent=openclaw&severity=warning&task_id=abc123&since=2026-06-02T12:00:00Z&limit=100
```

### `GET /api/stream`

Server-Sent Events endpoint. Dashboard subscribes to this for live events.

```
GET /api/stream
Content-Type: text/event-stream

data: {"id":"...","timestamp":"...","agent":"openclaw",...}

data: {"id":"...","timestamp":"...","agent":"hermes",...}
```

### `GET /`

Returns the dashboard UI.

### `GET /healthz`

Liveness probe for monitoring.

## Setup & Running

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
git clone https://github.com/EchoHex352/agentportal.git
cd agentportal
npm install
```

### Configuration

```bash
# Copy env template and fill with real values
cp .env.example .env

# Edit .env with your settings:
# - PORT (default 8900)
# - PORTAL_INGEST_TOKEN (your auth token for agents)
# - TELEGRAM_GROUP_ID (the group to send alerts to)
# - ALERT_MIN_SEVERITY (warning or critical)
```

### Running

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server will start on `http://127.0.0.1:8900` (bound to loopback by default).

## Agent Integration

Both agents (OpenClaw + Hermes) should POST to `/api/events` when:
- A task starts or completes
- A tool is called
- A decision is made
- An error or alert occurs

### Example: Emit an event from an agent

```bash
curl -X POST http://127.0.0.1:8900/api/events \
  -H "Authorization: Bearer $PORTAL_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "openclaw",
    "type": "tool_call",
    "severity": "info",
    "title": "Called GitHub API to push commit",
    "detail": "Pushed branch 'feature/test' to origin",
    "task_id": "build-portal-001",
    "metadata": {
      "tool": "git",
      "command": "push origin feature/test",
      "duration_ms": 2341
    }
  }'
```

## Telegram Alert Routing

Events at or above `ALERT_MIN_SEVERITY` (default: `warning`) are forwarded to the Telegram group.

### Configuration

Set in `.env`:
- `TELEGRAM_GROUP_ID` — the group to send alerts to (format: `-100XXXXXXXXXXXXX`)
- `ALERT_MIN_SEVERITY` — threshold (`warning` or `critical`)
- `ALERT_RATE_LIMIT` — max alerts per window (e.g., 10)
- `ALERT_RATE_WINDOW_SECS` — time window (e.g., 60)

### Alert Format

Alerts are formatted readably in Telegram:

```
🚨 CRITICAL | openclaw
Task: build-portal-001
Title: Deployment failed
Time: 2026-06-02T14:05:32Z
```

### Alert Routing Strategy

- **Option A (recommended):** Uses OpenClaw's built-in message tool via CLI (set `USE_OPENCLAW_CLI=true`)
- **Option B:** Posts directly to Telegram API (set `TELEGRAM_BOT_TOKEN` if Option A unavailable)

Rate limiting prevents alert spam:
- Tracks alerts in a rolling time window
- De-duplicates consecutive identical alerts
- Returns immediately if rate limit exceeded (no retry)

## Security

- ✅ No secrets committed to the repository
- ✅ All secrets come from environment variables (`.env` is ignored)
- ✅ API requires bearer token authentication
- ✅ Server bound to `127.0.0.1` by default (loopback only)
- ✅ Event content is escaped in the dashboard (no HTML injection)
- ✅ Input is validated and size-limited

### Exposing Remotely

If you need to access the portal from another host:

1. **Reverse proxy with TLS** (recommended):
   - Set up nginx/Caddy in front of the portal
   - Terminate TLS at the proxy
   - Port-forward to loopback

2. **SSH tunnel** (for development):
   ```bash
   ssh -L 8900:127.0.0.1:8900 user@host
   ```

## Repository Structure

```
agentportal/
├── server/
│   ├── index.js              # Express app + server setup
│   ├── api.js                # /api/events, /api/stream routes
│   ├── storage.js            # SQLite interaction (data layer)
│   └── alerts.js             # Telegram alert routing logic
├── public/
│   └── dashboard.html        # Single-page web UI (vanilla JS)
├── db/
│   └── schema.sql            # SQLite schema + migrations
├── package.json
├── .env.example              # Template (no secrets)
├── .gitignore
└── README.md
```

## Development Roadmap

- [x] Scaffold project structure
- [ ] Implement API + storage
- [ ] Build real-time dashboard (SSE)
- [ ] Implement alert routing
- [ ] Add filtering + search
- [ ] Write comprehensive README (you are here)
- [ ] Test with sample events

## Acceptance Criteria

- [ ] Repo created, no secrets committed
- [ ] `POST /api/events` validates and stores events
- [ ] Unauthenticated requests rejected
- [ ] Dashboard loads and streams events live via SSE
- [ ] Filters work (agent, severity, type, task_id)
- [ ] A `critical` event appears on dashboard **and** in Telegram group
- [ ] Alert rate limiting prevents spam
- [ ] README allows setup from `.env.example` alone

## License

ISC
