import { players, boards, fail, json, currentUser, readBody, weekId, clamp, setupError, maskEmail, GAME_RE } from "../lib/core.mjs";

const BOARD_SIZE = 100;

async function placeOnBoard(name, key, username, best) {
  if (best <= 0) return null;
  const store = boards();
  const board = (await store.get(name, { type: "json" })) || { entries: [] };
  const others = board.entries.filter((e) => e.key !== key);
  others.push({ key, username, best });
  others.sort((a, b) => b.best - a.best);
  const entries = others.slice(0, BOARD_SIZE);
  await store.setJSON(name, { entries });
  const i = entries.findIndex((e) => e.key === key);
  return i >= 0 ? i + 1 : null;
}

export default async (req) => {
  const notReady = setupError();
  if (notReady) return notReady;
  const me = await currentUser(req);
  if (me.error) return fail(401, me.error);
  const { key, user } = me;

  if (req.method === "GET") return json(200, { username: user.username, games: user.games || {}, email: maskEmail(user.email) });
  if (req.method !== "POST") return fail(405, "Use GET or POST");

  const { game = "", best = 0, theme = null, week = null, week_best = 0 } = await readBody(req);
  if (!GAME_RE.test(game)) return fail(400, "Bad game id");
  const prev = (user.games || {})[game] || {};
  const score = Math.max(Number(prev.best) || 0, clamp(best));
  const t = theme || prev.theme || null;
  const wk = weekId();
  let weekBest = prev.week && prev.week.id === wk ? Number(prev.week.best) || 0 : 0;
  if (week === wk) weekBest = Math.max(weekBest, clamp(week_best));
  const best2 = Math.max(score, weekBest);
  user.games = { ...(user.games || {}), [game]: { best: best2, theme: t, week: { id: wk, best: weekBest }, updatedAt: new Date().toISOString() } };
  await players().setJSON(key, user);

  const rank = await placeOnBoard(game, key, user.username, best2);
  const weekRank = await placeOnBoard(game + "@" + wk, key, user.username, weekBest);
  return json(200, { best: best2, theme: t, rank, week: wk, week_best: weekBest, week_rank: weekRank });
};

export const config = { path: ["/api/sync", "/api/me"] };
