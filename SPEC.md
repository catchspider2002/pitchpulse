# PitchPulse - Live Match Commentary Widget
## Build Spec for Claude Code

---

## What we're building

An embeddable live match commentary widget that consumes TxLINE's real-time World Cup SSE stream, pipes each event through the Claude API to generate punchy one-liner commentary, and renders it in a self-contained widget any website can embed with a single `<script>` tag.

Submitted to the **Superteam × TxODDS World Cup Hackathon** under the **Fan Experiences** track.

**Hackathon deadline:** July 19, 2026 (23:59 UTC)  
**Required:** deployed app (mainnet or devnet), demo video, public GitHub repo, working embed link

---

## Architecture overview

```
TxLINE SSE Stream
       │
       ▼
Node.js Backend (Express)
  ├── Ingests SSE events from TxLINE
  ├── Filters for significant events (goal, red card, yellow card, kickoff, halftime, fulltime, big odds shift)
  ├── Calls Claude API → generates one-liner commentary
  ├── Broadcasts to connected clients via Server-Sent Events
  └── REST endpoint: GET /widget/:matchId  (returns last N events)
       │
       ▼
Widget JS (vanilla, no framework)
  ├── Loaded via <script> tag on any site
  ├── Opens SSE connection to backend
  ├── Renders event feed into injected DOM
  └── Share button → copies pre-formatted tweet to clipboard
       │
       ▼
Landing page (Next.js or plain HTML)
  ├── Shows widget demo live
  ├── Shows embed code snippet
  └── Solana sign-in → issues free API key (satisfies TxLINE sign-up requirement)
```

---

## Project structure

```
pitchpulse/
├── backend/
│   ├── index.js              # Express server entry point
│   ├── txline.js             # TxLINE SSE client + event filter
│   ├── commentary.js         # Claude API call → one-liner generator
│   ├── broadcast.js          # SSE broadcaster to widget clients
│   └── routes/
│       ├── widget.js         # GET /widget/:matchId
│       └── events.js         # GET /events/:matchId (SSE to widget)
├── widget/
│   ├── pitchpulse.js         # Self-contained embeddable widget script
│   └── pitchpulse.css        # Widget styles (injected by JS)
├── frontend/
│   ├── index.html            # Landing page with live demo + embed snippet
│   └── styles.css
├── .env.example
├── package.json
└── README.md
```

---

## Backend - detailed spec

### Environment variables (`.env`)

```
TXLINE_API_KEY=your_txline_key
TXLINE_SSE_URL=https://txline.txodds.com/stream   # confirm exact URL from docs
DEEPINFRA_API_KEY="your_deepinfra_key"
PORT=3001
```

### TxLINE SSE client (`txline.js`)

- Connect to TxLINE's SSE stream using `eventsource` npm package
- Parse incoming JSON events
- Filter for these event types only (ignore the rest to avoid spamming Claude):
  - `goal`
  - `red_card`
  - `yellow_card` (only if it's a second yellow / resulting in dismissal)
  - `kickoff`
  - `half_time`
  - `full_time`
  - `odds_shift` - only trigger if the implied probability of any outcome moves by ≥ 8 percentage points in a single update
- Emit filtered events on an internal EventEmitter for the broadcaster to pick up

Refer to TxLINE docs for exact field names: https://txline.txodds.com/documentation/worldcup

### Commentary generator (`commentary.js`)

Call the Anthropic API with this system prompt:

```
You are a sharp, witty football commentator covering the 2026 World Cup.
When given a match event in JSON, write exactly ONE sentence of live commentary.

Rules:
- Maximum 25 words
- Write in present tense, active voice
- Sound like a knowledgeable fan, not a corporate press release
- For goals: describe the moment with a visual detail
- For red cards: note the drama and consequence
- For odds shifts: explain what the market is saying in plain English
- For half time / full time: summarise the mood in one line
- Never start with "And" or "Well"
- Output only the commentary sentence, nothing else
```

User message: the raw event JSON from TxLINE, stringified.

Use `claude-sonnet-4-6` model, `max_tokens: 100`.

### SSE broadcaster (`broadcast.js`)

- Maintain a `Map` of `matchId → Set<res>` (Express response objects with SSE headers)
- On new commentary event: write to all connected clients for that match
- On client disconnect: remove from the Set
- Cache the last 20 events per match in memory (for late-joining widgets to catch up)

### Routes

**`GET /events/:matchId`** - SSE endpoint for the widget
- Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`
- Immediately flushes the last 20 cached events to the new client
- Keeps connection open, streams new events as they arrive

**`GET /widget/:matchId`** - REST fallback
- Returns JSON array of last 20 events for the match
- Used by the widget on first load if SSE isn't supported

---

## Widget script (`widget/pitchpulse.js`)

This is the embeddable script. It must be completely self-contained - no React, no dependencies.

### Embed interface

Publishers add this to their HTML:

```html
<div id="pitchpulse" data-match="match_id_here"></div>
<script src="https://yourdeployeddomain.com/pitchpulse.js"></script>
```

### Widget behaviour

On load:
1. Find `div#pitchpulse`, read `data-match` attribute
2. Inject widget HTML and CSS into the div
3. Fetch last 20 events from `GET /widget/:matchId` and render them
4. Open SSE connection to `GET /events/:matchId`
5. On each new SSE event: prepend new event card to the feed (newest at top), animate in with a fade, keep max 20 items visible

### Event card structure (per event type)

Each card shows:
- Event type badge (coloured: green for goal, red for red card, purple for odds shift, grey for others)
- Match minute (e.g. "67'")
- AI-generated one-liner commentary
- Share button (copies tweet to clipboard):  
  `"⚽ 67' - [commentary text] #WorldCup2026 #BRAvFRA [link to widget page]"`

### Visual design

- Clean white card, 0.5px border, 12px border radius
- Colour coding:
  - Goal: `background: #EAF3DE` (light green)
  - Red card: `background: #FCEBEB` (light red)
  - Odds shift: `background: #EEEDFE` (light purple)
  - Other: white background
- Footer: "Powered by PitchPulse" with link to landing page
- Max width 420px, works at any width down to 320px
- Dark mode: respect `prefers-color-scheme: dark`

---

## Frontend landing page (`frontend/index.html`)

Keep it simple - this is for the demo, not a full product site.

Sections:
1. Hero: "AI commentary for every World Cup moment. Embed in 30 seconds."
2. Live widget demo (pointing at a real or simulated match)
3. Embed code snippet:
   ```html
   <div id="pitchpulse" data-match="MATCH_ID"></div>
   <script src="https://pitchpulse.yourapp.com/pitchpulse.js"></script>
   ```
   With a copy button.
4. How it works: 3-step diagram (TxLINE → AI → Your site)
5. Solana sign-in button (to get an API key / satisfy hackathon requirement)

---

## Solana sign-in (minimal implementation)

Use `@solana/wallet-adapter` or a simple manual sign-in:
- User connects wallet (Phantom etc.)
- Signs a message: `"Sign in to PitchPulse - ${timestamp}"`
- Backend verifies the signature, stores wallet address, issues a UUID API key
- API key is shown once, stored in localStorage
- Future: API key required as `?key=xxx` on the SSE endpoint (for now, open in hackathon mode)

This satisfies the TxLINE requirement: "Must use TxLINE data as a live input and sign up through Solana."

---

## Deployment

- **Backend:** Railway, Render, or Fly.io (needs persistent SSE connections - avoid serverless)
- **Frontend + widget JS:** Vercel or Netlify (static)
- Both must be live and publicly accessible for judge review

Suggested domain pattern:
- `api.pitchpulse.xyz` → backend
- `pitchpulse.xyz` → frontend
- `pitchpulse.xyz/pitchpulse.js` → widget script (proxied from frontend to backend, or served as static)

---

## Demo video plan (max 5 minutes)

Structure the Loom/YouTube recording like this:

1. **0:00-0:30** - Problem: show a generic sports site with no live commentary. "Publishers have no easy way to add live AI commentary."
2. **0:30-1:30** - Show the live widget on the PitchPulse landing page. A real match is in progress. A goal fires - watch the AI commentary appear within 2 seconds.
3. **1:30-2:30** - Show the backend terminal: TxLINE SSE event comes in → Claude API call → response → broadcast. Prove the data flow.
4. **2:30-3:30** - Open a blank HTML file, paste the embed snippet, refresh the page. The widget appears and is live. This is the judge's "wow" moment.
5. **3:30-4:00** - Click Share on a goal event. Show the copied tweet. Explain the viral loop.
6. **4:00-4:30** - Show the Solana sign-in flow and API key generation.
7. **4:30-5:00** - Wrap: "104 matches, 0 manual effort. Every goal, every red card, every odds swing - narrated automatically."

---

## Submission checklist

- [ ] Backend deployed and publicly accessible
- [ ] Widget embed works on a third-party HTML page
- [ ] Landing page live with working demo
- [ ] Solana sign-in functional
- [ ] GitHub repo public with README
- [ ] Demo video uploaded (Loom or YouTube, unlisted is fine)
- [ ] TxLINE endpoints used listed in technical docs (for submission form)
- [ ] Feedback on TxLINE API prepared (what worked, what had friction)

---

## TxLINE resources

- Quickstart: https://txline.txodds.com/documentation/quickstart
- World Cup docs: https://txline.txodds.com/documentation/worldcup
- Support: Discord and Telegram (links in hackathon brief)
- Note: all commercial data fees are waived until July 19, 2026

---

## Key decisions / notes for Claude Code

- Keep the widget JS vanilla - no bundler needed, just a single `.js` file served as a static asset
- The backend must support long-lived SSE connections - do not deploy to a platform that kills connections after 30s (e.g. standard Vercel serverless functions)
- Commentary generation should be non-blocking - fire the Claude API call async, broadcast when it resolves, don't hold up the SSE stream
- If TxLINE sends events faster than Claude can respond (unlikely but possible), queue them with a simple in-memory queue and process sequentially per match
- Start with one hardcoded match ID for the demo, then generalise
- The share tweet should include a direct link back to the widget demo page - this is the distribution flywheel
