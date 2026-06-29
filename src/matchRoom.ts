// PitchPulse — MatchRoom Durable Object. One per fixture.
// Alarm (~15s) polls TxLINE scores + odds, detects significant events, generates a Claude
// one-liner, caches the last 20, and broadcasts to embedded widgets over WebSocket.
import { getState, getImplied, listFixtures, State, Implied } from './txline';
import { commentate } from './commentary';

const POLL_MS = 15000;
const ODDS_SHIFT = 0.08; // 8pp implied move = an odds-shift event

export interface RoomEnv { TXLINE_API_KEY?: string; ANTHROPIC_API_KEY?: string }

interface Feed { id: string; type: string; commentary: string; score: string; phase: string; ts: number; }

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
      const ls = await this.ctx.storage.get<State>('last');
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
      const state = await getState(this.txenv(), fixtureId);
      if (state) {
        const names = await this.names();
        const events = await this.detect(state);
        for (const e of events) {
          if (e.type === 'full_time') finished = true;
          await this.emit(e.type, { type: e.type, home: names.home, away: names.away, score: `${state.homeGoals}-${state.awayGoals}`, phase: state.phase, detail: e.detail });
        }
        await this.ctx.storage.put('last', state);
      }
      // odds-shift detection
      const implied = await getImplied(this.txenv(), fixtureId);
      if (implied) {
        const prev = await this.ctx.storage.get<Implied>('lastImplied');
        if (prev) {
          const moved = (['home', 'draw', 'away'] as const).find((m) => Math.abs(implied[m] - prev[m]) >= ODDS_SHIFT);
          if (moved) {
            const names = await this.names(); const ls = await this.ctx.storage.get<State>('last');
            await this.emit('odds_shift', { type: 'odds_shift', home: names.home, away: names.away, score: ls ? `${ls.homeGoals}-${ls.awayGoals}` : '0-0', phase: ls?.phase || 'H1', detail: `${moved} now ${(implied[moved] * 100).toFixed(0)}%` });
          }
        }
        await this.ctx.storage.put('lastImplied', implied);
      }
    } catch (e) { console.log('pp alarm error', String(e)); }
    if (!finished) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }

  // Compare new state to last to find new events.
  async detect(state: State): Promise<{ type: string; detail?: string }[]> {
    const last = await this.ctx.storage.get<State>('last');
    const out: { type: string; detail?: string }[] = [];
    if (!last) { // first sighting: announce kickoff if in play
      if (state.phase !== 'NS') out.push({ type: state.phase === 'HT' ? 'half_time' : 'kickoff' });
      return out;
    }
    if (last.phase !== state.phase) {
      if (state.phase === 'H1') out.push({ type: 'kickoff' });
      else if (state.phase === 'HT') out.push({ type: 'half_time' });
      else if (state.phase === 'F' || state.phase === 'FET' || state.phase === 'FPE') out.push({ type: 'full_time' });
    }
    const goalsNow = state.homeGoals + state.awayGoals, goalsThen = last.homeGoals + last.awayGoals;
    for (let i = 0; i < Math.min(goalsNow - goalsThen, 3); i++) out.push({ type: 'goal' });
    if (state.reds > last.reds) out.push({ type: 'red_card' });
    if (state.yellows > last.yellows) out.push({ type: 'yellow_card' });
    return out;
  }

  async emit(type: string, ev: { type: string; home: string; away: string; score: string; phase: string; detail?: string }): Promise<void> {
    const commentary = await commentate(this.env.ANTHROPIC_API_KEY, ev);
    const item: Feed = { id: crypto.randomUUID(), type, commentary, score: ev.score, phase: ev.phase, ts: Date.now() };
    const feed = (await this.ctx.storage.get<Feed[]>('feed')) || [];
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
