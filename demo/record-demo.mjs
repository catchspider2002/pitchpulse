// PitchPulse hackathon demo (~2.5 min), recorded DURING A LIVE MATCH:
//   Act 1 - the problem (slides: fan sites can't afford live commentary)
//   Act 2 - live walkthrough (widget on the live match with REAL AI commentary,
//           then the one-tag embed on a plain "fan blog" page)
//   Act 3 - how TxLINE powers the backend (architecture + REAL live TxLINE JSON)
// Fully automated; captions/slides carry the narrative so no voiceover is needed.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const BASE = 'https://pitchpulse.wc26hackathon.com';
const OUT = './video';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the live fixture (soonest listed = in-play or next up) ----
const { fixtures } = await (await fetch(`${BASE}/api/matches`)).json();
const fx = fixtures.slice().sort((a, b) => a.startTime - b.startTime)[0];
if (!fx) throw new Error('no fixtures listed');
const LIVE = Date.now() >= fx.startTime;

// ---- pull REAL TxLINE data to show in Act 3: live scores-feed records for THIS match ----
const KEY = readFileSync('/Users/naveencs/Downloads/app store projects/solana-world-cup/bracketboss/.dev.vars', 'utf8')
  .match(/^TXLINE_API_KEY=(.*)$/m)[1].trim().replace(/^"|"$/g, '');
const jwt = (await (await fetch('https://txline.txodds.com/auth/guest/start', { method: 'POST' })).json()).token;
const tx = (p) => fetch('https://txline.txodds.com' + p, { headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': KEY } }).then((r) => r.json());

const scoreArr = await tx(`/api/scores/snapshot/${fx.fixtureId}`);
const interesting = new Set(['kickoff', 'goal', 'yellow_card', 'red_card', 'corner', 'shot', 'penalty', 'halftime_finalised', 'game_finalised']);
const feedSample = (Array.isArray(scoreArr) ? scoreArr : [])
  .filter((r) => interesting.has(String(r.Action)))
  .slice(-5)
  .map((r) => ({ FixtureId: r.FixtureId, Action: r.Action, Clock: r.Clock ? { Seconds: r.Clock.Seconds } : undefined, Team: r.Team, Data: r.Data && Object.keys(r.Data).length ? r.Data : undefined }));

// ---- slide deck ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const jsonHtml = (o) => `<pre class="code">${esc(JSON.stringify(o, null, 2))}</pre>`;
const slides = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#0b1120;color:#f1f5f9}
  .slide{display:none;width:100vw;height:100vh;box-sizing:border-box;padding:64px 90px;flex-direction:column;justify-content:center}
  .slide.on{display:flex}
  .brand{color:#4ade80;font-weight:800}
  h1{font-size:54px;margin:0 0 18px} h2{font-size:40px;margin:0 0 26px}
  p,li{font-size:26px;line-height:1.55;color:#cbd5e1} li{margin-bottom:14px}
  .tag{font-size:20px;letter-spacing:2px;text-transform:uppercase;color:#64748b;margin-bottom:14px}
  .code{background:#020617;border:1px solid #1e293b;border-radius:12px;padding:20px 26px;font:16px/1.55 ui-monospace,Menlo,monospace;color:#7dd3fc;overflow:hidden;max-height:52vh}
  .flow{display:flex;align-items:center;gap:14px;margin-top:30px;flex-wrap:wrap}
  .box{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px 20px;font-size:20px;font-weight:600}
  .box small{display:block;font-weight:400;color:#94a3b8;font-size:15px;margin-top:4px}
  .arrow{color:#4ade80;font-size:26px;font-weight:700}
  .accent{color:#4ade80}
  .snippet{background:#020617;border:1px solid #1e293b;border-radius:12px;padding:22px 28px;font:20px/1.6 ui-monospace,Menlo,monospace;color:#fbbf24;margin-top:10px}
</style></head><body>

<div class="slide" id="s1" style="text-align:center;align-items:center">
  <h1 style="font-size:72px">🎙 <span class="brand">PitchPulse</span></h1>
  <p style="font-size:30px">AI commentary for every World Cup moment - on any website, one script tag<br>Consumer &amp; Fan Experiences · powered by the <b class="accent">TxLINE</b> live feed</p>
</div>

<div class="slide" id="s2">
  <div class="tag">The problem</div>
  <h2>Fan sites go silent at the exact moment fans show up</h2>
  <ul>
    <li>During a match, fans refresh blogs, forums and fan pages - and find <b>static content</b></li>
    <li>Live commentary needs a data feed, a writer, and infrastructure - <b>none of which a fan site has</b></li>
    <li>The big-network live tickers can't be embedded, and they don't speak with your site's energy anyway</li>
  </ul>
</div>

<div class="slide" id="s3">
  <div class="tag">The fix</div>
  <h2><span class="brand">PitchPulse</span>: paste one tag, get a live AI pundit</h2>
  <div class="snippet">&lt;div id="pitchpulse" data-match="MATCH_ID"&gt;&lt;/div&gt;<br>&lt;script src="pitchpulse…/pitchpulse.js"&gt;&lt;/script&gt;</div>
  <ul style="margin-top:26px">
    <li>The widget streams every goal, card and odds swing from <b class="accent">TxLINE</b>, narrated by AI, over WebSocket</li>
    <li>Self-contained, framework-free, dark-mode aware - and every card has a one-click share</li>
  </ul>
  <p style="margin-top:20px">${LIVE ? `<b class="accent">${esc(fx.home)} vs ${esc(fx.away)} is in play RIGHT NOW</b> - everything you're about to see is real. →` : `Let's see it on a real match. →`}</p>
</div>

<div class="slide" id="s4">
  <div class="tag">Under the hood</div>
  <h2>How <span class="accent">TxLINE</span> powers the backend</h2>
  <div class="flow">
    <div class="box">TxLINE API<small>scores + odds snapshots</small></div>
    <div class="arrow">→</div>
    <div class="box">MatchRoom DO (per fixture)<small>~15s alarm → detect new events</small></div>
    <div class="arrow">→</div>
    <div class="box">AI one-liner<small>goal / card / odds swing → commentary</small></div>
    <div class="arrow">→</div>
    <div class="box">WebSocket fan-out<small>every embedded widget, at once</small></div>
  </div>
  <ul style="margin-top:34px">
    <li><b>detect</b> - goal &amp; card records and phase changes from <span class="accent">/api/scores/snapshot</span>; ≥8pp odds swings from the odds feed</li>
    <li><b>narrate</b> - the LLM gets the verified facts (teams, score, minute) and adds one line of colour - it never invents names</li>
    <li><b>fan out</b> - one Durable Object per match broadcasts to every site embedding that match, simultaneously</li>
  </ul>
</div>

<div class="slide" id="s5">
  <div class="tag">Live TxLINE data · scores snapshot · ${esc(fx.home)} vs ${esc(fx.away)}</div>
  <h2>The raw feed behind what you just watched - fetched seconds ago</h2>
  ${jsonHtml(feedSample)}
  <p style="margin-top:22px">Action records with the running <b>Clock</b> - the MatchRoom turns these into the commentary cards in the widget.</p>
</div>

<div class="slide" id="s6" style="text-align:center;align-items:center">
  <h1><span class="brand">PitchPulse</span></h1>
  <p style="font-size:28px">pitchpulse.wc26hackathon.com<br><br>One tag. Every moment. <span class="accent">Any website.</span> 🎙</p>
</div>

<script>window.show=(id)=>{document.querySelectorAll('.slide').forEach(s=>s.classList.remove('on'));document.getElementById(id).classList.add('on')}</script>
</body></html>`;
const slidesPath = resolve('./slides.html');
writeFileSync(slidesPath, slides);

// ---- a plain "fan blog" page that embeds the widget with the real one-tag snippet ----
const blogPath = resolve('./fanblog.html');
writeFileSync(blogPath, `<!doctype html><html><head><meta charset="utf-8"><title>Lucas' Football Blog</title><style>
  body{margin:0;font-family:Georgia,serif;background:#faf7f2;color:#292524}
  header{background:#292524;color:#faf7f2;padding:18px 32px;font-size:22px;font-style:italic}
  .cols{display:flex;gap:36px;max-width:1050px;margin:28px auto;padding:0 24px}
  article{flex:1} h1{font-size:30px} p{line-height:1.7;font-size:16.5px;color:#44403c}
  aside{width:430px}
</style></head><body>
<header>⚽ Lucas' Football Blog - <i>just a fan with a website</i></header>
<div class="cols">
  <article>
    <h1>Quarter-final day: ${fx.home} vs ${fx.away}</h1>
    <p>Huge one today. I'll be watching from the couch as always - drop your predictions in the comments.</p>
    <p>I pasted two lines of HTML into this post before kickoff, and now my little blog has a live AI commentary feed
    running next to this article. That's the entire integration. Two lines.</p>
    <p>Enjoy the match - allez les bleus / dima maghreb, whichever side you're on.</p>
  </article>
  <aside>
    <div id="pitchpulse" data-match="${fx.fixtureId}"></div>
    <script src="${BASE}/pitchpulse.js"><\/script>
  </aside>
</div>
</body></html>`);

// ---- recording ----
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();

let currentCaption = '';
async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById('demo-cap');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-cap';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
        'background:rgba(10,14,26,.92);color:#fff;padding:12px 22px;border-radius:12px;' +
        'font:600 19px/1.3 -apple-system,system-ui,sans-serif;z-index:99999;max-width:900px;' +
        'text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.15)';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}
async function cap(text, holdMs = 2600) { currentCaption = text; await caption(text); await sleep(holdMs); }
page.on('load', () => { if (currentCaption) caption(currentCaption).catch(() => { }); });
async function clearCap() {
  currentCaption = '';
  await page.evaluate(() => document.getElementById('demo-cap')?.remove()).catch(() => { });
}
async function slide(id, holdMs) {
  if (!page.url().startsWith('file:')) await page.goto('file://' + slidesPath);
  await page.evaluate((i) => window.show(i), id);
  await sleep(holdMs);
}

// ============ ACT 1 - the problem (slides) ============
await page.goto('file://' + slidesPath);
await slide('s1', 6000);
await slide('s2', 11000);
await slide('s3', 12000);

// ============ ACT 2 - live walkthrough ============
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector(`#match option[value="${fx.fixtureId}"]`, { state: 'attached' });
await cap(LIVE ? `${fx.home} vs ${fx.away} is LIVE right now - let's mount the widget on it` : 'Pick a match and the widget mounts', 4200);
await page.selectOption('#match', String(fx.fixtureId));
await page.waitForSelector('.pp-widget .pp-card', { timeout: 30000 }).catch(() => { });
await sleep(1500);
await cap('Real commentary from the live match - every card was written by the AI as the moment happened', 5000);
await cap('The facts (score, minute, event) come verified from TxLINE; the AI only adds the colour', 4800);
await cap('Each card has one-click share - fans post the moment straight to X', 3800);

// The judge moment: same widget, someone else's website, one script tag.
await cap('Now the real pitch: this widget goes on ANY website. Here is a plain fan blog…', 3600);
await page.goto('file://' + blogPath, { waitUntil: 'load' });
await page.waitForSelector('.pp-widget .pp-card', { timeout: 30000 }).catch(() => { });
await sleep(1200);
await cap('Two lines of HTML pasted into the page - and the same live AI commentary is running on this blog', 5200);
await cap('Every site embedding this match gets each new moment at the same instant, over WebSocket', 4600);
await sleep(6000); // linger: if a live event lands now, it animates in on camera
await clearCap();

// ============ ACT 3 - TxLINE backend ============
await page.goto('file://' + slidesPath);
await slide('s4', 14000);
await slide('s5', 11000);
await slide('s6', 5000);

await ctx.close();
await browser.close();
console.log('DONE - raw webm in ' + OUT);
