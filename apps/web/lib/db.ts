import postgres from "postgres";
import { readFileSync } from "node:fs";
import path from "node:path";
let client: ReturnType<typeof postgres> | undefined;
export function db() {
  if (!client) {
    if (!process.env.POSTGRES_URL)
      throw new Error("Database is not configured");
    const url = new URL(process.env.POSTGRES_URL);
    url.searchParams.delete("sslmode");
    client = postgres(url.toString(), {
      ssl: {
        rejectUnauthorized: true,
        ca: readFileSync(
          path.join(process.cwd(), "lib/certs/supabase.crt"),
          "utf8",
        ),
      },
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return client;
}
