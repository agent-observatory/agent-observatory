import { z } from "zod";
import { endpoint, owner, limitedJson } from "../../../../lib/security";
import { db } from "../../../../lib/db";
const Snapshot = z.object({
  source: z.enum(["codex", "claude-code"]),
  session_id: z.string().min(1).max(256),
  generation: z.string().min(1).max(256),
  snapshot_end_offset: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
});
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req, true, true);
    const parsed = Snapshot.safeParse(await limitedJson(req, 4096));
    if (!parsed.success)
      throw new Response("잘못된 접수 완료 정보", { status: 422 });
    const b = parsed.data;
    return db().begin(async (sql) => {
      // Same owner lock as ingestion: a stale completion cannot overtake a new batch.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${id},0))`;
      const [s] =
        await sql`SELECT * FROM atlas.sessions WHERE owner=${id} AND source=${b.source} AND source_id=${b.session_id} AND generation=${b.generation} FOR UPDATE`;
      if (!s) throw new Response("세션 없음", { status: 404 });
      if (s.deleted || new Date(s.expires_at).getTime() <= Date.now())
        throw new Response("만료된 세션", { status: 410 });
      if (Number(s.offset_bytes) !== b.snapshot_end_offset)
        throw new Response("snapshot_not_terminal", { status: 409 });
      const [updated] =
        await sql`UPDATE atlas.sessions SET ingestion_complete_at=coalesce(ingestion_complete_at,now()),completed_snapshot_offset=${b.snapshot_end_offset} WHERE id=${s.id} RETURNING ingestion_complete_at`;
      return Response.json({
        ok: true,
        completed_at: updated.ingestion_complete_at,
        snapshot_end_offset: b.snapshot_end_offset,
      });
    });
  });
