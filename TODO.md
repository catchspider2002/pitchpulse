# PitchPulse - Submission Checklist

Track: **Consumer & Fan Experiences** (Superteam × TxODDS World Cup Hackathon)
Live: https://pitchpulse.wc26hackathon.com · Repo: https://github.com/catchspider2002/pitchpulse

## ✅ Done

- [x] MatchRoom Durable Object: ~15s scores+odds poll, event detection, WebSocket fan-out (no Container)
- [x] DeepInfra LLM commentary one-liner per event, deterministic fallback
- [x] Event types: goals, yellow/red cards, kickoff/half/full time, ≥8pp odds shifts
- [x] Embeddable `pitchpulse.js` (self-contained, REST catch-up + WS, share-to-tweet, dark mode)
- [x] Landing page: live demo, copy-able embed snippet, demo event buttons
- [x] Worker routes + last-20 cache; deployed; `TXLINE_API_KEY` set

## ⏳ Before submitting

- [ ] **Add `DEEPINFRA_API_KEY`**: `wrangler secret put DEEPINFRA_API_KEY` (live commentary; fallback works without it)
- [ ] **Record demo video** (≤5 min): pick a match, fire Goal/Red/Odds, then paste the embed snippet into a blank HTML file to show the one-tag embed going live
- [ ] **Add demo video link** to README + submission form
- [ ] **Push final code to GitHub** - confirm latest commit; verify `.dev.vars` is NOT committed
- [ ] **Fill submission form**: live URL, GitHub URL, video URL, TxLINE endpoints used, API feedback
- [ ] Attach custom domain `pitchpulse.<domain>` (optional)

## 💡 Optional polish / known limitations

- [ ] Solana sign-in to issue API keys (satisfies the Solana sign-up requirement)
- [ ] Richer events (player names/minutes) via the scores action feed instead of counts
- [ ] Rate-limit/queue Claude calls if many events fire together
