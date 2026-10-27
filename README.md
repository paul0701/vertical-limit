# Vertical Limit

A tap-to-climb arcade game. Tap the next hold to climb, dodge falling stones,
and cash out at base camps to bank your points — or push on and risk it all.
Part of the [Agnostic Solutions](https://agnosticsolutions.co.uk) games collection.

**Play:** https://vertical-limit.agnosticsolutions.co.uk

## How it's built
- `index.html` — the whole game (Canvas 2D), plus a CSS/SVG wilderness backdrop
  that frames the portrait playfield on wider (laptop/desktop) screens.
- `netlify/functions/leaderboard.mjs` — the global leaderboard API, a Netlify
  Function backed by Netlify Blobs. Players get a private recovery code
  (`VL-…`) so they can reclaim their name and score on another device.
  - `GET  /api/leaderboard?limit=N` — the top climbers
  - `POST /api/leaderboard/submit`  — record a run
  - `POST /api/leaderboard/profile` — claim/rename, or restore by recovery code
- `netlify.toml` / `package.json` — Netlify build + the `@netlify/blobs` dependency.

## Deploy
Connected to Netlify via continuous deployment: pushes to `main` deploy
automatically. The leaderboard store is site-wide in production and isolated
per-deploy for previews, so preview testing never touches the live board.
