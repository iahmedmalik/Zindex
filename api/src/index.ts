import { createApp } from "./app";
import { buildContext } from "./context";

// The Vercel entry. A function cannot keep timers running between requests, so the photo cleanup and the
// demo refresh run from the daily cron instead (routes/cron.ts).
export default createApp(buildContext());
