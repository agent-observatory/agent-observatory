import { endpoint, owner } from "../../../../lib/security";
import { db } from "../../../../lib/db";
import { evidenceHash } from "../../../../lib/evaluation";
export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  endpoint(async () => {
    const user = await owner(req, true),
      { id } = await ctx.params;
    const [s] =
      await db()`SELECT * FROM atlas.sessions WHERE id=${id} AND owner=${user} AND expires_at>now() AND deleted=false`;
    if (!s) throw new Response("세션 없음", { status: 404 });
    const results =
      await db()`SELECT i.id,i.status,i.result,i.error,i.revision,i.attempts,j.created_at FROM atlas.job_items i JOIN atlas.jobs j ON j.id=i.job_id WHERE i.session_id=${id} AND j.owner=${user} AND i.expires_at>now() ORDER BY j.created_at DESC LIMIT 10`;
    for (const row of results) {
      if (!Array.isArray(row.result?.timeline)) continue;
      row.result = {
        ...row.result,
        timeline: row.result.timeline.map((event: Record<string, unknown>) =>
          event.hash
            ? event
            : {
                ...event,
                hash: evidenceHash(event),
                hashScope: "stored_excerpt",
              },
        ),
      };
    }
    const [manifest] =
      await db()`SELECT count(*)::int AS batches,coalesce(sum(bytes),0)::bigint AS stored_bytes FROM atlas.batches WHERE session_id=${id} AND owner=${user} AND purged=false`;
    const completed = results.find(
      (result) =>
        result.status === "completed" &&
        Number(result.revision) === Number(s.revision),
    );
    const metrics = completed?.result?.metrics;
    const images = completed?.result?.imageInput;
    const aggregate = {
      available: {
        storageManifest: true,
        analysisMetrics: Boolean(metrics),
        imageMetadata: Boolean(images),
      },
      metricRevision: metrics ? Number(completed.revision) : null,
      storedBytes: Number(manifest.stored_bytes),
      batches: Number(manifest.batches),
      collectedEvents: metrics ? Number(metrics.events) : null,
      userMessages: metrics ? Number(metrics.userMessages) : null,
      assistantMessages: metrics ? Number(metrics.assistantMessages) : null,
      toolCalls: metrics ? Number(metrics.toolCalls) : null,
      toolResults: null,
      usageEvents: null,
      imageOccurrences: images ? Number(images.occurrences) : null,
      uniqueImages: images ? Number(images.unique) : null,
    };
    return Response.json({ session: s, results, aggregate });
  });
export const DELETE = (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) =>
  endpoint(async () => {
    const user = await owner(req, true),
      { id } = await ctx.params;
    await db().begin(async (sql) => {
      // Keep the original detailed-data expiry as the tombstone deadline.
      // The deleted flag immediately hides the session and blocks re-ingestion.
      await sql`UPDATE atlas.sessions SET deleted=true WHERE id=${id} AND owner=${user}`;
      await sql`UPDATE atlas.job_items SET result=null,expires_at=now(),status='expired' WHERE session_id IN (SELECT id FROM atlas.sessions WHERE id=${id} AND owner=${user})`;
      await sql`DELETE FROM atlas.summaries WHERE session_id=${id} AND owner=${user}`;
    });
    return Response.json({ ok: true });
  });
