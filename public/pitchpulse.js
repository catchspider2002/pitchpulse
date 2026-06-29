/* PitchPulse — self-contained embeddable live-commentary widget.
   Embed:  <div id="pitchpulse" data-match="FIXTURE_ID"></div>
           <script src="https://YOURDOMAIN/pitchpulse.js"></script>  */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); for (var i = s.length - 1; i >= 0; i--) if (/pitchpulse\.js/.test(s[i].src)) return s[i]; return null; })();
  var BASE = script ? new URL(script.src).origin : location.origin;
  var WSB = BASE.replace(/^http/, 'ws');

  injectCSS();

  function badgeClass(t) { return t === 'goal' ? 'pp-goal' : t === 'red_card' ? 'pp-red' : t === 'odds_shift' ? 'pp-odds' : 'pp-other'; }
  function label(t) { return ({ goal: 'GOAL', red_card: 'RED CARD', yellow_card: 'YELLOW', kickoff: 'KICK-OFF', half_time: 'HALF TIME', full_time: 'FULL TIME', odds_shift: 'ODDS SHIFT' })[t] || t.toUpperCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function mount(el, matchId) {
    el.classList.add('pp-widget');
    el.innerHTML = '<div class="pp-head">Live commentary</div><div class="pp-feed"></div><div class="pp-foot">Powered by <a href="' + BASE + '" target="_blank" rel="noopener">PitchPulse</a></div>';
    var feed = el.querySelector('.pp-feed');
    var seen = {};

    function card(ev, prepend) {
      if (seen[ev.id]) return; seen[ev.id] = 1;
      var d = document.createElement('div');
      d.className = 'pp-card ' + badgeClass(ev.type);
      var tweet = '⚽ ' + label(ev.type) + ' — ' + ev.commentary + ' #WorldCup2026 ' + BASE;
      d.innerHTML = '<div class="pp-row"><span class="pp-badge">' + label(ev.type) + '</span>' +
        '<span class="pp-score">' + esc(ev.score || '') + '</span></div>' +
        '<div class="pp-text">' + esc(ev.commentary) + '</div>' +
        '<button class="pp-share">Share</button>';
      d.querySelector('.pp-share').addEventListener('click', function () { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(tweet), '_blank'); });
      if (prepend && feed.firstChild) { feed.insertBefore(d, feed.firstChild); d.classList.add('pp-in'); }
      else feed.appendChild(d);
      while (feed.children.length > 20) feed.removeChild(feed.lastChild);
    }

    fetch(BASE + '/api/widget/' + matchId).then(function (r) { return r.json(); }).then(function (j) {
      (j.events || []).slice().reverse().forEach(function (e) { card(e, false); });
    }).catch(function () {});

    function connect() {
      var ws = new WebSocket(WSB + '/api/events/' + matchId);
      ws.onmessage = function (m) { var d; try { d = JSON.parse(m.data); } catch (e) { return; } if (d.type === 'init') (d.events || []).slice().reverse().forEach(function (e) { card(e, false); }); else if (d.type === 'event') card(d.event, true); };
      ws.onclose = function () { setTimeout(connect, 3000); };
    }
    connect();
  }

  window.PitchPulse = { mount: mount, BASE: BASE };
  function auto() { var nodes = document.querySelectorAll('#pitchpulse[data-match], .pitchpulse[data-match]'); for (var i = 0; i < nodes.length; i++) mount(nodes[i], nodes[i].getAttribute('data-match')); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();

  function injectCSS() {
    if (document.getElementById('pp-css')) return;
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var css = '.pp-widget{max-width:420px;border:1px solid ' + (dark ? '#2a2f3a' : '#E4E0D8') + ';border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:' + (dark ? '#171a21' : '#fff') + ';color:' + (dark ? '#e7e9ee' : '#1F1D1A') + '}'
      + '.pp-head{padding:10px 14px;font-weight:700;border-bottom:1px solid ' + (dark ? '#2a2f3a' : '#E4E0D8') + ';font-size:14px}'
      + '.pp-feed{max-height:460px;overflow:auto}'
      + '.pp-card{padding:10px 14px;border-bottom:1px solid ' + (dark ? '#23262e' : '#EFEDE7') + '}'
      + '.pp-card.pp-goal{background:' + (dark ? '#16240f' : '#EAF3DE') + '}.pp-card.pp-red{background:' + (dark ? '#2a1414' : '#FCEBEB') + '}.pp-card.pp-odds{background:' + (dark ? '#1b1830' : '#EEEDFE') + '}'
      + '.pp-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}'
      + '.pp-badge{font-size:10px;font-weight:700;letter-spacing:.05em;opacity:.8}'
      + '.pp-score{font-variant-numeric:tabular-nums;font-weight:700;font-size:13px}'
      + '.pp-text{font-size:13.5px;line-height:1.4}'
      + '.pp-share{margin-top:6px;font-size:11px;padding:3px 10px;border-radius:6px;border:1px solid ' + (dark ? '#3a3f4a' : '#C9C2B6') + ';background:transparent;color:inherit;cursor:pointer}'
      + '.pp-foot{padding:8px 14px;font-size:11px;opacity:.7;border-top:1px solid ' + (dark ? '#2a2f3a' : '#E4E0D8') + '}.pp-foot a{color:inherit}'
      + '.pp-in{animation:ppfade .4s ease}@keyframes ppfade{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}';
    var st = document.createElement('style'); st.id = 'pp-css'; st.textContent = css; document.head.appendChild(st);
  }
})();
