import { readFile } from "node:fs/promises";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { migrate } from "./migrate";

// A real Postgres running on this computer, for development and tests. It is the same database
// engine Neon runs, so row-level security, roles and functions behave exactly the same.
// It needs no account and holds no secrets. The passwords below are for this local copy only.

export const LOCAL_PASSWORDS = { owner: "owner_local", app: "zx_app_local" } as const;

export type LocalPostgres = {
  ownerUrl: string;
  appUrl: string;
  stop: () => Promise<void>;
};

export async function startLocalPostgres(opts: { dir: string; port: number; fresh?: boolean }): Promise<LocalPostgres> {
  const { dir, port, fresh = false } = opts;
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: LOCAL_PASSWORDS.owner,
    port,
    persistent: !fresh,
    onLog: () => undefined,
    onError: () => undefined,
  });

  let existed = true;
  try {
    await pg.initialise();
    existed = false;
  } catch {
    // Already initialised in a previous run: just start it.
  }
  await pg.start();

  const base = `postgres://postgres:${LOCAL_PASSWORDS.owner}@127.0.0.1:${port}`;
  if (!existed) await pg.createDatabase("zindex");
  const ownerUrl = `${base}/zindex`;

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await migrate(client);
    // The login role, made from the very same file Ahmed runs on Neon.
    const roles = (await readFile(path.resolve(process.cwd(), "sql/roles.sql"), "utf8")).replaceAll("__APP_PASSWORD__", LOCAL_PASSWORDS.app);
    await client.query(roles);
  } finally {
    await client.end();
  }

  return {
    ownerUrl,
    appUrl: `postgres://zx_app:${LOCAL_PASSWORDS.app}@127.0.0.1:${port}/zindex`,
    stop: () => pg.stop(),
  };
}
