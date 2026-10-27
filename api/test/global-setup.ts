import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startLocalPostgres, type LocalPostgres } from "../src/db/local-postgres";

let pg: LocalPostgres | undefined;

// Starts a real Postgres on this computer, makes sure every migration is applied and the login
// role exists, then hands the connection strings to the tests through the environment.
// The data folder is kept between runs (ZX_PG_CACHE, default: the temp folder) because setting up
// a brand-new one is slow on Windows. Every test makes its own owners with random ids.
export async function setup() {
  const dir = process.env.ZX_PG_CACHE ?? path.join(os.tmpdir(), "zindex-pg-cache");
  await mkdir(dir, { recursive: true });
  pg = await startLocalPostgres({ dir, port: 54340 });
  process.env.TEST_OWNER_URL = pg.ownerUrl;
  process.env.TEST_APP_URL = pg.appUrl;
}

export async function teardown() {
  await pg?.stop().catch(() => undefined);
}
