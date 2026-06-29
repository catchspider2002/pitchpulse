// PitchPulse — TxLINE client: auth + fixtures + match state (counts/phase) + odds (for odds-shift).
const BASE = 'https://txline.txodds.com';
export interface TxEnv { TXLINE_API_KEY?: string; jwtCache?: { get(): Promise<string | null>; set(v: string): Promise<void> } }

async function getJwt(env: TxEnv, force = false): Promise<string> {
  if (!force && env.jwtCache) { const c = await env.jwtCache.get(); if (c) return c; }
  const r = await fetch(`${BASE}/auth/guest/start`, { method: 'POST' });
  if (!r.ok) throw new Error('guest start ' + r.status);
  const token = (await r.json() as { token: string }).token;
  if (env.jwtCache) await env.jwtCache.set(token);
  return token;
}
async function authedGet(env: TxEnv, path: string): Promise<Response> {
  if (!env.TXLINE_API_KEY) throw new Error('TXLINE_API_KEY not set');
  let jwt = await getJwt(env);
  const h = () => ({ Authorization: `Bearer ${jwt}`, 'X-Api-Token': env.TXLINE_API_KEY! });
  let res = await fetch(BASE + path, { headers: h() });
  if (res.status === 401) { jwt = await getJwt(env, true); res = await fetch(BASE + path, { headers: h() }); }
  return res;
}

export interface TxFixture { fixtureId: number; competition: string; startTime: number; home: string; away: string; }

// Keep ONLY the senior men's FIFA World Cup 2026 — excludes qualifiers, youth (U-17/U-20),
// women's, Club World Cup, beach/futsal/esports, and any other edition/year.
function isMainWorldCup(name: string): boolean {
  const s = (name || '').toLowerCase();
  if (!/world cup/.test(s)) return false;
  if (/qualif|wom(e|a)n|u-?\d{1,2}|under[\s-]?\d{1,2}|youth|club|beach|futsal|esoccer|e-?sports|e[\s-]?world/.test(s)) return false;
  const year = s.match(/\b(19|20)\d{2}\b/);
  if (year && year[0] !== '2026') return false;
  return true;
}

export async function listFixtures(env: TxEnv): Promise<TxFixture[]> {
  const res = await authedGet(env, '/api/fixtures/snapshot');
  if (!res.ok) throw new Error('fixtures ' + res.status);
  const arr = await res.json() as any[];
  return arr.map((f) => { const p1 = !!f.Participant1IsHome; return { fixtureId: f.FixtureId, competition: f.Competition, startTime: f.StartTime, home: p1 ? f.Participant1 : f.Participant2, away: p1 ? f.Participant2 : f.Participant1 }; })
    .filter((f) => isMainWorldCup(f.competition || ''));
}

export interface State { phase: string; homeGoals: number; awayGoals: number; yellows: number; reds: number; }
const PHASES = new Set(['NS', 'H1', 'HT', 'H2', 'ET1', 'ET2', 'HTET', 'WET', 'PE', 'WPE', 'F', 'FET', 'FPE']);
export async function getState(env: TxEnv, fixtureId: string | number): Promise<State | null> {
  const res = await authedGet(env, `/api/scores/snapshot/${fixtureId}`);
  if (!res.ok) return null;
  const arr = await res.json() as any[];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const latest = arr.reduce((a, b) => ((b?.seq ?? b?.ts ?? 0) > (a?.seq ?? a?.ts ?? 0) ? b : a));
  const phase = phaseOf(latest); const st = latest?.stats || {}; const sc = latest?.scoreSoccer;
  const n = (k: string, fb?: number) => (st[k] != null ? num(st[k]) : (fb ?? 0));
  const g1 = n('1', num(sc?.Participant1?.Total?.Goals)), g2 = n('2', num(sc?.Participant2?.Total?.Goals));
  const p1Home = latest?.participant1IsHome !== false;
  return {
    phase,
    homeGoals: p1Home ? g1 : g2, awayGoals: p1Home ? g2 : g1,
    yellows: n('3', num(sc?.Participant1?.Total?.YellowCards)) + n('4', num(sc?.Participant2?.Total?.YellowCards)),
    reds: n('5', num(sc?.Participant1?.Total?.RedCards)) + n('6', num(sc?.Participant2?.Total?.RedCards)),
  };
}

export type Implied = { home: number; draw: number; away: number };
export async function getImplied(env: TxEnv, fixtureId: string | number): Promise<Implied | null> {
  const res = await authedGet(env, `/api/odds/snapshot/${fixtureId}`);
  if (!res.ok) return null;
  const arr = await res.json() as any[];
  if (!Array.isArray(arr)) return null;
  const cands = arr.filter((o) => Array.isArray(o.PriceNames) && o.PriceNames.length === 3 && Array.isArray(o.Pct));
  const pick = cands.find((o) => /stable/i.test(o.Bookmaker || '') || /stable/i.test(o.SuperOddsType || '')) || cands[0];
  if (!pick) return null;
  const pct = (pick.Pct as string[]).map((x) => (x === 'NA' ? NaN : Number(x)));
  if (pct.some((x) => !Number.isFinite(x))) return null;
  const names = (pick.PriceNames as string[]).map((s) => String(s).toLowerCase());
  const hi = idx(names, ['1', 'home'], 0), di = idx(names, ['x', 'draw'], 1), ai = idx(names, ['2', 'away'], 2);
  const s = pct[hi] + pct[di] + pct[ai];
  return { home: pct[hi] / s, draw: pct[di] / s, away: pct[ai] / s };
}
function idx(n: string[], keys: string[], fb: number) { const i = n.findIndex((x) => keys.some((k) => x === k || x.includes(k))); return i >= 0 ? i : fb; }
function phaseOf(u: any): string { if (typeof u?.gameState === 'string' && u.gameState) return u.gameState; const s = u?.statusSoccerId; if (typeof s === 'string') return s; if (s && typeof s === 'object') return Object.keys(s)[0] || 'NS'; return 'NS'; }
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
void PHASES;
