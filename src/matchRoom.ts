// PitchPulse - MatchRoom Durable Object. One per fixture.
// Alarm (~15s) polls TxLINE scores + odds, detects significant events, generates a Claude
// one-liner, caches the last 20, and broadcasts to embedded widgets over WebSocket.
import { getMatch, getImplied, listFixtures, MatchSnapshot, Implied } from './txline';
import { commentate } from './commentary';

const POLL_MS = 15000;
const ODDS_SHIFT = 0.08; // 8pp implied move = an odds-shift event

export interface RoomEnv { TXLINE_API_KEY?: string; DEEPINFRA_API_KEY?: string }

interface Feed { id: string; type: string; commentary: string; score: string; phase: string; minute: number | null; round: string | null; ts: number; }
interface Ev { type: string; home: string; away: string; score: string; phase: string; scoreline?: string; team?: string; player?: string; playerOut?: string; goalType?: string; minute?: number | null; round?: string | null; venue?: string | null; detail?: string; history?: string[]; }

export class MatchRoom {
  ctx: DurableObjectState; env: RoomEnv;
  constructor(ctx: DurableObjectState, env: RoomEnv) { this.ctx = ctx; this.env = env; }

  txenv() {
    return { TXLINE_API_KEY: this.env.TXLINE_API_KEY, jwtCache: {
      get: () => this.ctx.storage.get<string>('jwt').then((v) => v ?? null),
      set: (v: string) => this.ctx.storage.put('jwt', v),
    } };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const fx = url.searchParams.get('fixtureId');
    if (fx) await this.ctx.storage.put('fixtureId', fx);

    if (url.pathname === '/widget') {
      const feed = (await this.ctx.storage.get<Feed[]>('feed')) || [];
      return new Response(JSON.stringify({ events: feed }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/mock' && req.method === 'POST') {
      const b = await req.json().catch(() => ({})) as { type?: string; detail?: string };
      const names = await this.names();
      const ls = await this.ctx.storage.get<MatchSnapshot>('last');
      const score = ls ? `${ls.homeGoals}-${ls.awayGoals}` : '0-0';
      await this.emit(b.type || 'goal', { type: b.type || 'goal', home: names.home, away: names.away, score, phase: ls?.phase || 'H1', detail: b.detail });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair(); const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      const feed = (await this.ctx.storage.get<Feed[]>('feed')) || [];
      server.send(JSON.stringify({ type: 'init', events: feed }));
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 2000);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    const fixtureId = await this.ctx.storage.get<string>('fixtureId');
    if (!fixtureId || this.ctx.getWebSockets().length === 0) return;
    let finished = false;
    try {
      const snap = await getMatch(this.txenv(), fixtureId);
      if (snap) {
        const names = await this.names();
        const scoreline = `${names.home} ${snap.homeGoals}-${snap.awayGoals} ${names.away}`;
        const score = `${snap.homeGoals}-${snap.awayGoals}`;
        const lastPhase = await this.ctx.storage.get<string>('lastPhase');
        const seen = new Set<number>((await this.ctx.storage.get<number[]>('seenIds')) || []);
        const firstSight = lastPhase === undefined;

        // Phase transitions (kickoff / half-time / full-time). Each is announced at most ONCE per
        // match: phase detection can flap (a poll whose snapshot momentarily lacks
        // halftime_finalised reads as H1 again), and lastPhase alone re-announced half-time.
        const announced = new Set<string>((await this.ctx.storage.get<string[]>('announcedPhases')) || []);
        const phaseEvts: string[] = [];
        const pushPhase = (pt: string) => { if (!announced.has(pt)) { announced.add(pt); phaseEvts.push(pt); } };
        if (firstSight) { if (snap.phase !== 'NS') pushPhase(snap.phase === 'HT' ? 'half_time' : 'kickoff'); }
        else if (lastPhase !== snap.phase) {
          if (snap.phase === 'H1') pushPhase('kickoff');
          else if (snap.phase === 'HT') pushPhase('half_time');
          else if (snap.phase === 'F' || snap.phase === 'FET' || snap.phase === 'FPE') pushPhase('full_time');
        }
        await this.ctx.storage.put('announcedPhases', [...announced]);
        // Full time is emitted LAST (after discrete events + the goal safety net below), so a
        // goal landing in the same poll reads "GOAL ... 0-1" then "Full-time 0-1", not reversed.
        const emitPhase = (pt: string) =>
          // Phase transitions aren't minute-stamped - the match clock is unreliable at those points
          // (resets to ~0 at full time), so don't prefix a minute.
          this.emit(pt, { type: pt, home: names.home, away: names.away, score, scoreline, phase: snap.phase, minute: null, round: snap.round, venue: snap.venue });
        for (const pt of phaseEvts) {
          if (pt === 'full_time') { finished = true; continue; }
          await emitPhase(pt);
        }
        // Once the game is finalised the feed's clock resets to ~0, so a stoppage-time card can
        // read "1'" - suppress tiny minutes at phase F rather than print a wrong one.
        const fixMin = (m: number | null) => (snap.phase === 'F' && m != null && m < 10 ? null : m);
        // Cumulative goal accounting: `goalsAnnounced` counts goals we've told users about per
        // side (baselined to the score at first sight). Stats and goal records can land in
        // DIFFERENT polls, so per-poll diffing would double-announce; this ledger can't.
        const curGoals = { home: snap.homeGoals, away: snap.awayGoals };
        const prevSnap = await this.ctx.storage.get<MatchSnapshot>('last');
        const announcedG = (await this.ctx.storage.get<{ home: number; away: number }>('goalsAnnounced'))
          ?? { home: Number(prevSnap?.homeGoals ?? snap.homeGoals), away: Number(prevSnap?.awayGoals ?? snap.awayGoals) };
        // Discrete goal/card/sub records, de-duplicated by record Id. Baseline (no backfill) on first sight.
        for (const ev of snap.events) {
          if (seen.has(ev.id)) continue;
          seen.add(ev.id);
          if (firstSight) continue;
          if (ev.type === 'goal' && (ev.team === 'home' || ev.team === 'away')) {
            // Credit the side the goal counts FOR (an own goal benefits the other team).
            const credit = ev.goalType === 'OwnGoal' ? (ev.team === 'home' ? 'away' : 'home') : ev.team;
            // Already covered by a synthesized goal (record surfaced late) - don't announce twice.
            if (announcedG[credit] >= curGoals[credit]) continue;
            announcedG[credit]++;
          }
          const team = ev.team === 'home' ? names.home : ev.team === 'away' ? names.away : undefined;
          await this.emit(ev.type, { type: ev.type, home: names.home, away: names.away, score, scoreline, phase: snap.phase, minute: fixMin(ev.minute ?? snap.minute), round: snap.round, venue: snap.venue, team, player: ev.player, playerOut: ev.playerOut, goalType: ev.goalType });
        }
        // Safety net: goals that never produce a 'goal' record. A penalty converted in normal
        // play appears only as penalty_outcome (this is how BOTH bots missed France's winner v
        // Paraguay), and a goal record can also age out of the pruned snapshot between polls.
        // If the score is ahead of the announced ledger, synthesize the missing goal - named
        // from an unseen scored-penalty record when one matches the side.
        if (!firstSight) {
          for (const sd of ['home', 'away'] as const) {
            let missing = curGoals[sd] - announcedG[sd];
            while (missing-- > 0) {
              announcedG[sd]++;
              const pen = snap.penaltyGoals.find((p) => p.team === sd && !seen.has(p.id));
              if (pen) seen.add(pen.id);
              const team = sd === 'home' ? names.home : names.away;
              await this.emit('goal', { type: 'goal', home: names.home, away: names.away, score, scoreline, phase: snap.phase, minute: fixMin(pen?.minute ?? snap.minute), round: snap.round, venue: snap.venue, team, player: pen?.player, goalType: pen ? 'Penalty' : undefined });
            }
          }
        }
        await this.ctx.storage.put('goalsAnnounced', announcedG);
        if (finished && phaseEvts.includes('full_time')) await emitPhase('full_time');
        await this.ctx.storage.put('seenIds', [...seen].slice(-300));
        await this.ctx.storage.put('lastPhase', snap.phase);
        await this.ctx.storage.put('last', snap);
      }
      // odds-shift detection
      const implied = await getImplied(this.txenv(), fixtureId);
      if (implied) {
        const prev = await this.ctx.storage.get<Implied>('lastImplied');
        if (prev) {
          const moved = (['home', 'draw', 'away'] as const).find((m) => Math.abs(implied[m] - prev[m]) >= ODDS_SHIFT);
          if (moved) {
            const names = await this.names(); const ls = await this.ctx.storage.get<MatchSnapshot>('last');
            const sl = ls ? `${names.home} ${ls.homeGoals}-${ls.awayGoals} ${names.away}` : `${names.home} 0-0 ${names.away}`;
            await this.emit('odds_shift', { type: 'odds_shift', home: names.home, away: names.away, score: ls ? `${ls.homeGoals}-${ls.awayGoals}` : '0-0', scoreline: sl, phase: ls?.phase || 'H1', minute: ls?.minute ?? null, detail: `${moved} now ${(implied[moved] * 100).toFixed(0)}%` });
          }
        }
        await this.ctx.storage.put('lastImplied', implied);
      }
    } catch (e) { console.log('pp alarm error', String(e)); }
    if (!finished) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }

  async emit(type: string, ev: Ev): Promise<void> {
    const history = (await this.ctx.storage.get<string[]>('history')) || [];
    const feed = (await this.ctx.storage.get<Feed[]>('feed')) || [];
    // Feed the model its own last few lines (newest first in `feed`) so it varies its language.
    const recent = feed.slice(0, 6).map((f) => f.commentary);
    const commentary = await commentate(this.env.DEEPINFRA_API_KEY, { ...ev, history: history.slice(-10), recent });
    if (type !== 'odds_shift') { history.push(factLine(ev)); await this.ctx.storage.put('history', history.slice(-30)); }
    const item: Feed = { id: crypto.randomUUID(), type, commentary, score: ev.score, phase: ev.phase, minute: ev.minute ?? null, round: ev.round ?? null, ts: Date.now() };
    feed.unshift(item);
    await this.ctx.storage.put('feed', feed.slice(0, 20));
    this.broadcast({ type: 'event', event: item });
  }

  async names(): Promise<{ home: string; away: string }> {
    let n = await this.ctx.storage.get<{ home: string; away: string }>('names');
    if (n) return n;
    const fixtureId = await this.ctx.storage.get<string>('fixtureId');
    try {
      const fx = (await listFixtures(this.txenv())).find((f) => String(f.fixtureId) === fixtureId);
      n = fx ? { home: fx.home, away: fx.away } : { home: 'Home', away: 'Away' };
    } catch { n = { home: 'Home', away: 'Away' }; }
    await this.ctx.storage.put('names', n);
    return n;
  }

  broadcast(msg: unknown): void { const s = JSON.stringify(msg); for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch { /* closed */ } } }
  async webSocketClose(ws: WebSocket): Promise<void> { try { ws.close(); } catch { /* noop */ } }
}

// One concise factual line per event, for the running match timeline fed to the AI.
function factLine(ev: Ev): string {
  const line = ev.scoreline || `${ev.home} ${ev.score} ${ev.away}`;
  const who = ev.team || '';
  const min = ev.minute ? `${ev.minute}' ` : '';
  const scorer = ev.player ? `${ev.player} (${who})` : who;
  switch (ev.type) {
    case 'goal': return `${min}GOAL ${scorer}${ev.goalType ? ' [' + ev.goalType + ']' : ''} → ${line}`.trim();
    case 'red_card': return `${min}RED CARD ${scorer} (now ${line})`.trim();
    case 'yellow_card': return `${min}Yellow ${scorer}`.trim();
    case 'substitution': return `${min}Sub ${who}: ${ev.player || '?'} on for ${ev.playerOut || '?'}`.trim();
    case 'kickoff': return 'Kick-off';
    case 'half_time': return `Half-time ${line}`;
    case 'full_time': return `Full-time ${line}`;
    default: return `${min}${ev.type} ${line}`.trim();
  }
}
