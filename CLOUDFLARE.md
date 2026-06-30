# PitchPulse - Cloudflare Deployment (as built)

**Track:** Consumer & Fan Experiences · **Subdomain:** `pitchpulse.<domain>`
**Live:** https://pitchpulse.catchspider2002.workers.dev · Spec: `SPEC.md` · Notes: `README.md`

## Architecture decision: Durable Object, NOT a Container

The original plan used a Container running an always-on SSE consumer. **The shipped build uses a Durable Object** that polls TxLINE scores + odds on a ~15s alarm, generates Claude commentary, and fans out to embedded widgets over WebSocket. Single `wrangler deploy`, no Docker, no D1.

## Component mapping (as built)

| Spec component | Cloudflare (shipped) |
|---|---|
| `txline.js` SSE consumer + filter | `src/txline.ts` polled by the DO - scores (goals/cards/phase) + odds (odds-shift) |
| `commentary.js` (Claude one-liner) | `src/commentary.ts` - `claude-sonnet-4-6`, deterministic fallback |
| `broadcast.js` (clients + last-20 cache) | `MatchRoom` DO - WebSocket hibernation + 20-event cache in DO storage |
| `routes/widget.js` (`GET /widget/:id`) | Worker `GET /api/widget/:id` → DO REST catch-up |
| `routes/events.js` (`GET /events/:id` SSE) | Worker `GET /api/events/:id` → DO WebSocket |
| `widget/pitchpulse.js` (embeddable, vanilla) | `public/pitchpulse.js` - self-contained, derives backend from its own `src`, REST + WS, share-to-tweet, dark mode |
| landing page (demo + embed snippet) | `public/index.html` via Workers `[assets]` |
| Solana sign-in (API key) | not implemented (demo runs open) - add for the sign-up requirement |

**Flow:** widget opens WS → Worker routes to the fixture's `MatchRoom` → DO alarm polls TxLINE → detects events → Claude one-liner → broadcasts to all embedded widgets.

## Bindings (`wrangler.toml`, as shipped)

```toml
name = "pitchpulse"
main = "src/worker.ts"
compatibility_date = "2026-01-01"

[assets]
directory = "./public"
binding = "ASSETS"

[[durable_objects.bindings]]
name = "MATCH_ROOM"
class_name = "MatchRoom"

[[migrations]]
tag = "v1"
new_classes = ["MatchRoom"]
```

Secrets: `TXLINE_API_KEY` (required), `ANTHROPIC_API_KEY` (recommended - Claude commentary).

## Deploy

```bash
npm install && wrangler login
wrangler secret put TXLINE_API_KEY
wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

## Verify / demo

- `GET /api/matches` → live fixtures (confirms auth).
- Landing → pick a match → widget mounts → click Goal/Red/Odds → commentary streams in.
- Paste the embed snippet into a blank HTML file to prove the one-tag embed.

## Notes

- Events from goal/card counts + phase + ≥8pp odds shifts; commentary is moment-based (no player names in the snapshot).
- DO stops polling when no widgets are connected and at full time (cost-safe).
- `/pitchpulse.js` is served as a static asset; embedding pages get it cross-origin with permissive CORS on `/api/*`.
