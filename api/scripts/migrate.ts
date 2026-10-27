import { Client } from "pg";
import { migrate } from "../src/db/migrate";

// Applies the numbered files in api/sql to the database named by DATABASE_URL_OWNER (the table
// owner's connection string, which lives only on Ahmed's computer in api/.env.local).
const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error("DATABASE_URL_OWNER is not set. Put the table owner's connection string in api/.env.local.");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  const applied = await migrate(client);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Nothing to apply: the database is up to date.");
} finally {
  await client.end();
}
