import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const postgres = require("postgres");
for (const p of [".env.remote.local", ".env.local"])
  try {
    process.loadEnvFile(p);
  } catch {}
const u = new URL(process.env.POSTGRES_URL);
u.searchParams.delete("sslmode");
const sql = postgres(u.toString(), {
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync("ops/certs/supabase-prod-ca-2021.crt", "utf8"),
  },
  prepare: false,
  max: 1,
});
try {
  await sql`CREATE SCHEMA IF NOT EXISTS atlas`;
  await sql`CREATE TABLE IF NOT EXISTS atlas.migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE atlas.migrations ENABLE ROW LEVEL SECURITY`;
  for (const name of readdirSync("db/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(772301)`;
      if (
        (await tx`SELECT name FROM atlas.migrations WHERE name=${name}`).length
      )
        return;
      await tx.unsafe(readFileSync("db/migrations/" + name, "utf8"));
      await tx`INSERT INTO atlas.migrations(name) VALUES(${name})`;
      console.log("Applied", name);
    });
  }
  console.log("DB migration verified");
} finally {
  await sql.end();
}
