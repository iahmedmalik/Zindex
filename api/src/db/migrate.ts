import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";

// Runs the numbered SQL files in api/sql, in name order, each in its own transaction.
// Each applied file is remembered with a fingerprint of its text, so:
//   * a file that has already run is skipped,
//   * a file that was edited after it ran stops everything (add a new numbered file instead).

export type Applied = { name: string; checksum: string };

const checksumOf = (sql: string) => createHash("sha256").update(sql).digest("hex");

export async function migrate(client: Client, dir = path.resolve(process.cwd(), "sql")): Promise<string[]> {
  await client.query(`
    create table if not exists _migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);

  const done = new Map<string, string>(
    (await client.query<{ name: string; checksum: string }>("select name, checksum from _migrations")).rows.map((r) => [
      r.name,
      r.checksum,
    ]),
  );

  const files = (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    const checksum = checksumOf(sql);
    const previous = done.get(file);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(`Migration ${file} was edited after it ran. Never edit a migration that has run: add a new numbered file.`);
      }
      continue;
    }

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into _migrations (name, checksum) values ($1, $2)", [file, checksum]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    applied.push(file);
  }

  return applied;
}
