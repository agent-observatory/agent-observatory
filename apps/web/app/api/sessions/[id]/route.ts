import { endpoint, owner } from "../../../../lib/security";
import { db } from "../../../../lib/db";
export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  endpoint(async () => {
    const user = await owner(req, true),
      { id } = await ctx.params;
    const [s] =
      await db()`SELECT * FROM atlas.sessions WHERE id=${id} AND owner=${user} AND expires_at>now() AND deleted=false`;
    if (!s) throw new Response("세션 없음", { status: 404 });
    const results =
      await db()`SELECT i.id,i.status,i.result,i.error,i.revision FROM atlas.job_items i JOIN atlas.jobs j ON j.id=i.job_id WHERE i.session_id=${id} AND j.owner=${user} AND i.expires_at>now() ORDER BY j.created_at DESC LIMIT 10`;
    return Response.json({ session: s, results });
  });
export const DELETE = (
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) =>
  endpoint(async () => {
    const user = await owner(req, true),
      { id } = await ctx.params;
    await db().begin(async (sql) => {
      await sql`UPDATE atlas.sessions SET deleted=true,expires_at=now() WHERE id=${id} AND owner=${user}`;
      await sql`UPDATE atlas.job_items SET result=null,expires_at=now(),status='expired' WHERE session_id IN (SELECT id FROM atlas.sessions WHERE id=${id} AND owner=${user})`;
      await sql`DELETE FROM atlas.summaries WHERE session_id=${id} AND owner=${user}`;
    });
    return Response.json({ ok: true });
  });
