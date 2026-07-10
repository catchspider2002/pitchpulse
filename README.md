# PitchPulse - Live Match Commentary Widget

An embeddable widget that turns TxLINE's live World Cup feed into punchy AI commentary - every goal, card, and odds swing - on any website with a single `<script>` tag. Submitted to the Superteam × TxODDS World Cup Hackathon - Consumer & Fan Experiences track.

**Stack:** Cloudflare Workers + **Durable Objects** (poll + WebSocket fan-out) + Claude + static assets. No Container.

- **Live:** https://pitchpulse.wc26hackathon.com
- **GitHub:** https://github.com/catchspider2002/pitchpulse
- **Demo video:** https://youtu.be/qanHN9W0J_c
- **TxLINE endpoints used:** `POST /auth/guest/start`, `GET /api/fixtures/snapshot`, `GET /api/scores/snapshot/{fixtureId}`, `GET /api/odds/snapshot/{fixtureId}`

## Embed

```html
<div id="pitchpulse" data-match="FIXTURE_ID"></div>
<script src="https://pitchpulse.wc26hackathon.com/pitchpulse.js"></script>
```

The widget is self-contained (no framework), derives the backend from its own script URL, catches up via REST, then streams live over WebSocket. Respects `prefers-color-scheme: dark`.

## How it works

- **MatchRoom Durable Object** (`src/matchRoom.ts`): one per fixture. An ~15s alarm polls TxLINE scores + odds, detects new events (goals, cards, kickoff/half/full time, ≥8pp odds shifts), asks **DeepInfra** (`zai-org/GLM-5.2`) for a one-sentence call, caches the last 20, and broadcasts to every embedded widget over WebSocket. Stops when idle / at full time.
- **Commentary** (`src/commentary.ts`): DeepInfra LLM one-liner with a deterministic fallback if no key.
- **Worker** (`src/worker.ts`): `/api/matches`, `/api/widget/:id` (REST catch-up), `/api/events/:id` (WS), `/api/mock-event/:id` (demo), and serves the landing page + `/pitchpulse.js`.

## Setup & deploy

```bash
npm install
wrangler login
wrangler secret put TXLINE_API_KEY
wrangler secret put DEEPINFRA_API_KEY   # optional; deterministic fallback without it
npm run deploy
```

No D1 - event state lives in the Durable Object.

## Demo

1. Open the landing page, pick a match (the live widget mounts), and copy the embed snippet.
2. Click **Goal / Red card / Odds shift** to fire a demo event - commentary appears in the widget within a second (across any page embedding that match).
3. Paste the snippet into a blank HTML file to prove the one-tag embed works - the judge "wow" moment.

For a real in-play match, the Durable Object generates commentary automatically as events happen.

## Notes / limitations (hackathon scope)

- Events are detected from goal/card counts + phase + odds shifts; player names/minutes aren't in the snapshot, so commentary is moment-based (the demo `mock-event` shows the same path).
- Last 20 events cached per match in the DO; resets on a fresh deploy.
- A Solflare sign-in could be added to issue API keys / satisfy the Solana sign-up requirement (the demo runs open).
