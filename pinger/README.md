# Zindex pinger

A tiny Cloudflare Worker that keeps the free API awake during shop hours (10:50 to 22:00 Pakistan time, every 5 minutes). Outside those hours the API sleeps, which keeps it inside Render's 750 free hours a month, and the web app shows a "waking up" screen.

Deploy (once, then after any change): `npm install`, `npx wrangler login`, `npm run deploy`. Cron times are in UTC and live in `wrangler.toml`.
