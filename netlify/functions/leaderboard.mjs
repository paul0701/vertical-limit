// Vertical Limit leaderboard — a faithful rebuild of the game's original API,
// backed by Netlify Blobs. The compiled game (index.html) talks to:
//   GET  /api/leaderboard?limit=N         -> { entries:[{rank,id,name,best,alt,at}], total }
//   POST /api/leaderboard/submit          -> record a run, return the player's standing
//   POST /api/leaderboard/profile         -> claim/rename (with name) or restore (id+secret only)
//
// A "profile" is a player: a 12-hex id + 24-hex secret (their VL- recovery code),
// a display name, a cumulative bank, their best single haul, and the highest
// altitude they've reached. The board ranks by best haul (what the game shows as
// the headline number), tie-broken by altitude. Writes to the single board blob
// use compare-and-swap so simultaneous submissions can't clobber each other.
import { getStore, getDeployStore } from '@netlify/blobs';

// Keep production on the persistent site-wide store; isolate every other deploy
// context (deploy-preview, branch-deploy, dev) so previews can't touch real data.
const IS_PROD = (process.env.CONTEXT || 'production') === 'production';
const store = () => (IS_PROD ? getStore('vl-leaderboard') : getDeployStore('vl-leaderboard'));

const ID_RE = /^[a-f0-9]{12}$/;
const SECRET_RE = /^[a-f0-9]{24}$/;
const MAX_NAME = 16;
const MAX_VAL = 1_000_000_000;   // generous ceiling for haul/alt/legacy values
const CAS_RETRIES = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const err = (msg, status) => json({ error: msg }, status);

const cleanName = (raw) => {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
};
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(MAX_VAL, Math.floor(Number(v)))) : 0);

// profiles sorted into ranked order: named climbers, best haul desc, then altitude, then earliest
const ranked = (board) =>
  board.filter((p) => p.name).sort((a, b) => (b.best - a.best) || (b.alt - a.alt) || (a.at - b.at));

const rankOf = (board, id) => {
  const r = ranked(board);
  const i = r.findIndex((p) => p.id === id);
  return i < 0 ? null : i + 1;
};

const standing = (board, p) => ({
  ok: true,
  id: p.id,
  name: p.name,
  bank: p.bank,
  best: p.best,
  alt: p.alt,
  rank: p.name ? rankOf(board, p.id) : null,
});

// Find a player by id in a board copy, verifying the secret. Returns a fresh
// board with the player present (created if new) and the player object to mutate,
// or an { error } if the secret doesn't match an existing id.
const upsert = (board, id, secret) => {
  const next = board.slice();
  const i = next.findIndex((x) => x.id === id);
  if (i >= 0) {
    if (next[i].secret !== secret) return { error: { msg: 'That recovery code does not match.', status: 403 } };
    const p = { ...next[i] };
    next[i] = p;
    return { next, p };
  }
  const p = { id, secret, name: '', bank: 0, best: 0, alt: 0, at: Date.now() };
  next.push(p);
  return { next, p };
};

// Read-modify-write the 'board' blob with compare-and-swap + jittered backoff.
const commit = async (st, update) => {
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    if (attempt > 0) await sleep(Math.floor(Math.random() * 40) * attempt);
    const cur = await st.getWithMetadata('board', { type: 'json' });
    const board = (cur && cur.data) || [];
    const result = update(board);                 // may return { board, value } or throw via result.error
    if (result.error) return result;              // business-rule rejection, no write needed
    const opts = cur && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const res = await st.setJSON('board', result.board, opts);
    if (res && res.modified) return result;
  }
  return { error: { msg: 'Leaderboard is busy — try again in a moment.', status: 503 } };
};

export default async (req) => {
  const st = store();
  const url = new URL(req.url);
  // sub-path after /api/leaderboard : '' | '/submit' | '/profile'
  const sub = url.pathname.replace(/^.*\/api\/leaderboard/, '').replace(/\/+$/, '');

  if (req.method === 'GET' && sub === '') {
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10) || 25));
    const board = (await st.get('board', { type: 'json' })) || [];
    const r = ranked(board);
    const entries = r.slice(0, limit).map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, best: p.best, alt: p.alt, at: p.at }));
    return json({ entries, total: r.length });
  }

  if (req.method !== 'POST') return err('Method not allowed', 405);

  let body;
  try { body = await req.json(); } catch { return err('Bad request', 400); }

  const id = typeof body.id === 'string' ? body.id.toLowerCase() : '';
  const secret = typeof body.secret === 'string' ? body.secret.toLowerCase() : '';
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return err('Invalid credentials.', 400);

  // seed legacy local progress when the client migrates an existing player
  const legacyBank = num(body.legacy_bank);
  const legacyBest = num(body.legacy_best);

  if (sub === '/submit') {
    const haul = num(body.haul);
    const alt = num(body.alt);
    const name = cleanName(body.name);
    const out = await commit(st, (board) => {
      const u = upsert(board, id, secret);
      if (u.error) return u;
      const { next, p } = u;
      if (name) p.name = name;
      p.bank = Math.max(p.bank, legacyBank) + haul;
      p.best = Math.max(p.best, haul, legacyBest);
      p.alt = Math.max(p.alt, alt);
      p.at = Date.now();
      return { board: next, value: p };
    });
    if (out.error) return err(out.error.msg, out.error.status);
    return json(standing(out.board, out.value));
  }

  if (sub === '/profile') {
    const name = cleanName(body.name);
    // restore / fetch: no name supplied
    if (!name && body.name === undefined) {
      const board = (await st.get('board', { type: 'json' })) || [];
      const p = board.find((x) => x.id === id);
      if (!p) return err('No profile found for that recovery code.', 404);
      if (p.secret !== secret) return err('That recovery code does not match.', 403);
      return json(standing(board, p));
    }
    if (!name) return err('Enter a name (1–16 characters).', 400);
    // claim / rename (and seed legacy progress)
    const out = await commit(st, (board) => {
      const u = upsert(board, id, secret);
      if (u.error) return u;
      const { next, p } = u;
      p.name = name;
      p.bank = Math.max(p.bank, legacyBank);
      p.best = Math.max(p.best, legacyBest);
      p.at = Date.now();
      return { board: next, value: p };
    });
    if (out.error) return err(out.error.msg, out.error.status);
    return json(standing(out.board, out.value));
  }

  return err('Not found', 404);
};

export const config = { path: ['/api/leaderboard', '/api/leaderboard/*'] };
