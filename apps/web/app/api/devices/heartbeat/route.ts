import { z } from "zod";
import { db } from "../../../../lib/db";
import { endpoint, hash, limitedJson } from "../../../../lib/security";
const Heartbeat = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.]+)?$/)
    .max(40),
  sourceTypes: z.array(z.enum(["codex", "claude-code"])).max(2),
  paused: z.boolean(),
  status: z.enum(["starting", "paused", "success", "failed"]),
  lastSyncAt: z.iso.datetime().optional(),
  lastErrorCode: z
    .enum([
      "sync_failed",
      "network_error",
      "unauthorized",
      "unknown",
      "SOURCE_CHANGED",
      "SYNC_FAILED",
    ])
    .optional(),
});
export const POST = (req: Request) =>
  endpoint(async () => {
    const token = req.headers.get("authorization");
    if (!token?.startsWith("Bearer "))
      throw new Response("기기 인증 필요", { status: 401 });
    const parsed = Heartbeat.safeParse(await limitedJson(req, 4096));
    if (!parsed.success)
      throw new Response("잘못된 기기 상태", { status: 422 });
    const b = parsed.data;
    const rows =
      await db()`UPDATE atlas.devices SET last_seen_at=now(),collector_version=${b.version},source_types=${db().json(b.sourceTypes)},paused=${b.paused},sync_status=${b.status},last_sync_at=CASE WHEN ${b.status}='success' THEN now() ELSE last_sync_at END,last_error_code=${b.status === "failed" ? b.lastErrorCode || "sync_failed" : null} WHERE token_hash=${hash(token.slice(7))} AND revoked=false AND owner IS NOT NULL RETURNING id`;
    if (!rows.length) throw new Response("기기 인증 필요", { status: 401 });
    return Response.json({ ok: true });
  });
