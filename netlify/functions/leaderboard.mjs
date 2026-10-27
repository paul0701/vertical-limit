import { boards, fail, json, weekId, GAME_RE } from "../lib/core.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const game = url.searchParams.get("game") || "";
  const period = url.searchParams.get("period") === "week" ? "week" : "all";
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10) || 20));
  if (!GAME_RE.test(game)) return fail(400, "Bad game id");
  const wk = period === "week" ? weekId() : null;
  const board = (await boards().get(wk ? game + "@" + wk : game, { type: "json" })) || { entries: [] };
  return json(200, { period, week: wk, entries: board.entries.slice(0, limit).map((e) => ({ username: e.username, best: e.best })) });
};

export const config = { path: "/api/leaderboard" };
