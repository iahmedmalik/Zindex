import { createApp } from "./app";
import { buildContext } from "./context";
import { startDemoReset, startPhotoCleanup } from "./maintenance";

// The long-running server (Render, and local development). On Vercel the app starts from index.ts instead.
const ctx = buildContext();
createApp(ctx).listen(ctx.config.PORT, () => {
  console.log(`Zindex API listening on port ${ctx.config.PORT}`);
  startPhotoCleanup(ctx.db);
  startDemoReset(ctx, ctx.config.PORT);
});
