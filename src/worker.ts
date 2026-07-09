// PitchPulse - Cloudflare Worker. Routes + static (landing + embeddable widget); DO real-time.
import { listFixtures } from './txline';
export { MatchRoom } from './matchRoom';

export interface Env {
  ASSETS: Fetcher;
  MATCH_ROOM: DurableObjectNamespace;
  TXLINE_API_KEY?: string;
  DEEPINFRA_API_KEY?: string;
  ADMIN_KEY?: string;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

function room(env: Env, fixtureId: string, path: string, req?: Request): Promise<Response> {
  const id = env.MATCH_ROOM.idFromName(fixtureId);
  const stub = env.MATCH_ROOM.get(id);
  const u = new URL(`https://room${path}`); u.searchParams.set('fixtureId', fixtureId);
  return stub.fetch(req ? new Request(u.toString(), req) : new Request(u.toString()));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url); const path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);  // serves landing + /pitchpulse.js
    try {
      if (path === '/api/matches' && req.method === 'GET') {
        if (!env.TXLINE_API_KEY) return json({ fixtures: [], note: 'TXLINE_API_KEY not set' });
        return json({ fixtures: await listFixtures({ TXLINE_API_KEY: env.TXLINE_API_KEY }) });
      }
      let m = path.match(/^\/api\/events\/(\w+)$/);
      if (m) return room(env, m[1], '/events', req);
      m = path.match(/^\/api\/widget\/(\w+)$/);
      if (m && req.method === 'GET') return room(env, m[1], '/widget', req);
      m = path.match(/^\/api\/mock-event\/(\w+)$/);
      if (m && req.method === 'POST') {
        if (!env.ADMIN_KEY || req.headers.get('X-Admin-Key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        return room(env, m[1], '/mock', req);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  },
};
