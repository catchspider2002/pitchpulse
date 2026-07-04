// PitchPulse - TxLINE client: auth + fixtures + match state (counts/phase) + odds (for odds-shift).
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

// Keep ONLY the senior men's FIFA World Cup 2026 - excludes qualifiers, youth (U-17/U-20),
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

export interface State {
  phase: string; homeGoals: number; awayGoals: number; yellows: number; reds: number;
  homeYellows: number; awayYellows: number; homeReds: number; awayReds: number;
  minute: number | null;
}
const PHASES = new Set(['NS', 'H1', 'HT', 'H2', 'ET1', 'ET2', 'HTET', 'WET', 'PE', 'WPE', 'F', 'FET', 'FPE']);
export async function getState(env: TxEnv, fixtureId: string | number): Promise<State | null> {
  const res = await authedGet(env, `/api/scores/snapshot/${fixtureId}`);
  if (!res.ok) return null;
  const arr = await res.json() as any[];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const phase = phaseFromActions(arr);
  const rec = latestStatRec(arr); const sm = statMap(rec); const sc = rec?.ScoreSoccer ?? rec?.scoreSoccer;
  const g1 = sm.get(1) ?? num(sc?.Participant1?.Total?.Goals), g2 = sm.get(2) ?? num(sc?.Participant2?.Total?.Goals);
  const p1Home = (rec?.Participant1IsHome ?? rec?.participant1IsHome) !== false;
  const y1 = sm.get(3) ?? num(sc?.Participant1?.Total?.YellowCards), y2 = sm.get(4) ?? num(sc?.Participant2?.Total?.YellowCards);
  const r1 = sm.get(5) ?? num(sc?.Participant1?.Total?.RedCards), r2 = sm.get(6) ?? num(sc?.Participant2?.Total?.RedCards);
  return {
    phase,
    homeGoals: p1Home ? g1 : g2, awayGoals: p1Home ? g2 : g1,
    yellows: y1 + y2, reds: r1 + r2,
    homeYellows: p1Home ? y1 : y2, awayYellows: p1Home ? y2 : y1,
    homeReds: p1Home ? r1 : r2, awayReds: p1Home ? r2 : r1,
    minute: matchMinute(arr, phase),
  };
}

// ---- Rich, per-event view: discrete goal/card/sub records with player names + exact clock. ----
export interface RichEvent {
  id: number; seq: number;
  type: 'goal' | 'red_card' | 'yellow_card' | 'substitution';
  team?: 'home' | 'away'; player?: string; playerOut?: string; goalType?: string; minute: number | null;
}
export interface MatchSnapshot {
  phase: string; minute: number | null; round: string | null; venue: string | null;
  homeGoals: number; awayGoals: number; yellows: number; reds: number;
  events: RichEvent[];
}
// Venue by fixture id - TxLINE doesn't provide a stadium name, but we know the 2026 R32 host venues.
const VENUES_2026: Record<number, string> = {
  18175983: 'Gillette Stadium, Foxborough', 18175981: 'MetLife Stadium, East Rutherford',
  18172280: 'Estadio Monterrey, Monterrey', 18179763: 'Toronto Stadium, Toronto',
  18179551: 'SoFi Stadium, Inglewood', 18172379: "Levi's Stadium, Santa Clara",
  18179550: 'Lumen Field, Seattle', 18172469: 'NRG Stadium, Houston',
  18175397: 'AT&T Stadium, Arlington', 18179759: 'Estadio Azteca, Mexico City',
  18179764: 'Mercedes-Benz Stadium, Atlanta', 18175918: 'Hard Rock Stadium, Miami Gardens',
  18176123: 'AT&T Stadium, Arlington', 18179552: 'Vancouver Stadium, Vancouver',
  18179549: 'Arrowhead Stadium, Kansas City',
};
export function venueOf(fixtureId: string | number): string | null { return VENUES_2026[Number(fixtureId)] ?? null; }
// 2026 WC knockout round from the fixture: R32 by known ids, later rounds by date (rest-day gaps
// mean no overlap). TxLINE has no round field, so we derive it.
const R32_IDS_2026 = new Set([18175983, 18175981, 18172280, 18179763, 18179551, 18172379, 18179550, 18172469, 18175397, 18179759, 18179764, 18175918, 18176123, 18179552, 18179549]);
export function roundLabel(fixtureId: string | number, startMs: number): string | null {
  if (R32_IDS_2026.has(Number(fixtureId))) return 'Round of 32';
  if (!startMs) return null;
  const d = new Date(startMs); const mon = d.getUTCMonth(), day = d.getUTCDate();
  if (mon === 5) return day >= 28 ? 'Round of 32' : 'Group stage';   // June
  if (mon === 6) {                                                    // July
    if (day <= 8) return 'Round of 16';
    if (day <= 13) return 'Quarter-final';
    if (day <= 17) return 'Semi-final';
    if (day === 18) return 'Third-place play-off';
    return 'Final';
  }
  return null;
}
export async function getMatch(env: TxEnv, fixtureId: string | number): Promise<MatchSnapshot | null> {
  const res = await authedGet(env, `/api/scores/snapshot/${fixtureId}`);
  if (!res.ok) return null;
  const arr = await res.json() as any[];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const phase = phaseFromActions(arr);
  const rec = latestStatRec(arr); const sm = statMap(rec); const sc = rec?.ScoreSoccer ?? rec?.scoreSoccer;
  const g1 = sm.get(1) ?? num(sc?.Participant1?.Total?.Goals), g2 = sm.get(2) ?? num(sc?.Participant2?.Total?.Goals);
  const y1 = sm.get(3) ?? 0, y2 = sm.get(4) ?? 0, r1 = sm.get(5) ?? 0, r2 = sm.get(6) ?? 0;
  const p1Home = (rec?.Participant1IsHome ?? rec?.participant1IsHome) !== false;
  const names = lineupNames(arr);
  const side = (p: number): 'home' | 'away' | undefined => p === 1 ? (p1Home ? 'home' : 'away') : p === 2 ? (p1Home ? 'away' : 'home') : undefined;
  const minOf = (r: any): number | null => { const s = num(r?.Clock?.Seconds); return s ? Math.min(Math.floor(s / 60) + 1, 130) : null; };
  const events: RichEvent[] = [];
  for (const r of arr) {
    if (r?.Confirmed === false) continue; // skip provisional/unconfirmed records - TxLINE amends them into a confirmed one
    const a = String(r?.Action || ''); const d = r?.Data || {};
    if (a === 'goal') events.push({ id: num(r.Id), seq: seqOf(r), type: 'goal', team: side(num(r.Participant)), player: names.get(num(d.PlayerId)), goalType: d.GoalType, minute: minOf(r) });
    else if (a === 'yellow_card') events.push({ id: num(r.Id), seq: seqOf(r), type: 'yellow_card', team: side(num(r.Participant)), player: names.get(num(d.PlayerId)), minute: minOf(r) });
    else if (a === 'red_card') events.push({ id: num(r.Id), seq: seqOf(r), type: 'red_card', team: side(num(r.Participant)), player: names.get(num(d.PlayerId)), minute: minOf(r) });
    else if (a === 'substitution') {
      const pin = names.get(num(d.PlayerInId));
      if (!pin) continue; // can't name the sub yet - skip (avoids "? on, ? off" and the provisional duplicate)
      events.push({ id: num(r.Id), seq: seqOf(r), type: 'substitution', team: side(num(d.Participant)), player: pin, playerOut: names.get(num(d.PlayerOutId)), minute: minOf(r) });
    }
  }
  events.sort((x, y) => x.seq - y.seq);
  // Live minute from the most recent record carrying a running clock; else timestamp estimate.
  let clk: { seq: number; sec: number } | null = null;
  for (const r of arr) { const s = r?.Clock?.Seconds; if (s != null && (!clk || seqOf(r) > clk.seq)) clk = { seq: seqOf(r), sec: num(s) }; }
  const minute = clk ? Math.min(Math.floor(clk.sec / 60) + 1, 130) : matchMinute(arr, phase);
  const round = roundLabel(fixtureId, num(rec?.StartTime));
  return { phase, minute, round, venue: venueOf(fixtureId), homeGoals: p1Home ? g1 : g2, awayGoals: p1Home ? g2 : g1, yellows: y1 + y2, reds: r1 + r2, events };
}
// Map player normativeId -> display name ("Kane, Harry" -> "Harry Kane"), from the lineups record.
function lineupNames(arr: any[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of arr) {
    if (String(r?.Action || '') !== 'lineups' || !Array.isArray(r.Lineups)) continue;
    for (const t of r.Lineups) for (const p of (t?.lineups || [])) {
      const pl = p?.player || {};
      if (pl.normativeId != null && pl.preferredName) m.set(Number(pl.normativeId), tidyName(String(pl.preferredName)));
    }
  }
  return m;
}
// TxLINE's only name field is preferredName in "Surname, Forename" order. Just reorder around the
// single comma - non-lossy (keeps every name part, so it can't mangle compound names). Leave anything
// without exactly one comma (mononyms like "Neymar") untouched.
function tidyName(n: string): string {
  const c = n.split(',');
  if (c.length !== 2) return n.trim();
  const surname = c[0].trim(), forename = c[1].trim();
  return forename && surname ? `${forename} ${surname}` : n.trim();
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
// TxLINE soccer game-phase encoding (numeric id → code). Docs: scores/soccer-feed.
function phaseFromActions(arr: any[]): string {
  let hasKick = false, htSeq = -1, finalised = false;
  for (const r of arr) {
    const a = String(r?.Action || '');
    const s = seqOf(r);
    if (a === 'kickoff' || a === 'kickoff_team') hasKick = true;
    if (a === 'halftime_finalised' && s > htSeq) htSeq = s;
    if (a === 'game_finalised') finalised = true;
  }
  if (finalised) return 'F';
  if (htSeq >= 0) {
    for (const r of arr) if (String(r?.Action || '') === 'kickoff' && seqOf(r) > htSeq) return 'H2';
    return 'HT';
  }
  return hasKick ? 'H1' : 'NS';
}
function seqOf(u: any): number { return num(u?.Seq ?? u?.seq ?? u?.Timestamp ?? u?.timestamp ?? u?.Ts ?? u?.ts); }
function tsOf(u: any): number { return num(u?.Ts ?? u?.ts ?? u?.Timestamp ?? u?.timestamp); }
// Approximate match minute from event timestamps (the feed has no clock field). Best-effort:
// elapsed since the (second-half) kickoff, clamped. Null when not meaningful (HT/FT/NS handled by phase).
function matchMinute(arr: any[], phase: string): number | null {
  if (phase === 'NS') return 0;
  if (phase === 'HT') return 45;
  if (phase === 'F' || phase === 'FET' || phase === 'FPE') return null;
  let now = 0; for (const r of arr) { const t = tsOf(r); if (t > now) now = t; }
  if (!now) return null;
  let h1 = 0, h1Seq = Infinity, htSeq = -1;
  for (const r of arr) {
    const a = String(r?.Action || ''); const s = seqOf(r);
    if ((a === 'kickoff' || a === 'kickoff_team') && s < h1Seq) { h1Seq = s; h1 = tsOf(r); }
    if (a === 'halftime_finalised' && s > htSeq) htSeq = s;
  }
  if (phase === 'H2') {
    let h2 = 0, h2Seq = Infinity;
    for (const r of arr) if (String(r?.Action || '') === 'kickoff' && seqOf(r) > htSeq && seqOf(r) < h2Seq) { h2Seq = seqOf(r); h2 = tsOf(r); }
    if (h2) return Math.max(46, Math.min(45 + Math.round((now - h2) / 60000), 120));
    return 46;
  }
  if (h1) return Math.max(1, Math.min(1 + Math.round((now - h1) / 60000), 60));
  return null;
}
function hasStats(u: any): boolean { const s = u?.Stats ?? u?.stats; return !!s && typeof s === 'object' && (s['1'] != null || s['2'] != null); }
function latestStatRec(arr: any[]): any {
  let best: any = null;
  for (const r of arr) if (hasStats(r) && (!best || seqOf(r) > seqOf(best))) best = r;
  return best ?? (arr.length ? arr.reduce((a, b) => (seqOf(b) > seqOf(a) ? b : a)) : {});
}
function statMap(u: any): Map<number, number> {
  const m = new Map<number, number>();
  const s = u?.Stats ?? u?.stats;
  if (Array.isArray(s)) { for (const it of s) { const k = Number(it?.Key ?? it?.key ?? it?.[0]); if (Number.isFinite(k)) m.set(k, num(it?.Value ?? it?.value ?? it?.[1])); } }
  else if (s && typeof s === 'object') { for (const k of Object.keys(s)) { const kn = Number(k); if (Number.isFinite(kn)) m.set(kn, num((s as any)[k])); } }
  return m;
}
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
void PHASES;
