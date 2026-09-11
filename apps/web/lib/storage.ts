import { createClient } from "@supabase/supabase-js";
import {
  canonicalBatch,
  decompressBatch,
} from "@agent-observatory/contracts/transport";
export function storage() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Storage is not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from("sessions");
}

export async function decodeStoredBatch(path: string, data: Blob) {
  const bytes = Buffer.from(await data.arrayBuffer());
  if (path.endsWith(".zst")) return decompressBatch(bytes);
  return canonicalBatch(JSON.parse(bytes.toString("utf8")));
}
