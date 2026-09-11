import { randomUUID } from "node:crypto";
import { db } from "./db";
import { z } from "zod";
import { analysisVersion } from "@agent-observatory/contracts";
import { normalizeSettings, isFree, routingVersion } from "./ai-routing";
export const JobRequest = z.object({
  scope: z.enum(["all", "selected", "single"]),
  sessionIds: z.array(z.string().uuid()).max(2000).default([]),
  requestKey: z.string().min(8).max(100),
  force: z.boolean().default(false),
});
export async function registerJob(owner: string, input: unknown) {
  const p = JobRequest.safeParse(input);
  if (!p.success) throw new Response("분석 범위 오류", { status: 400 });
  const b = p.data;
  return db().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${owner},0))`;
    const [old] =
      await sql`SELECT id,run_id FROM atlas.jobs WHERE owner=${owner} AND request_key=${b.requestKey}`;
    if (old) return { id: String(old.id), existing: true };
    const active =
      await sql`SELECT id FROM atlas.jobs WHERE owner=${owner} AND status IN ('queued','running')`;
    if (active.length >= 3)
      throw new Response("진행 중인 분석이 완료된 후 다시 요청하세요", {
        status: 429,
      });
    const ids = [...new Set(b.sessionIds)];
    if (
      b.scope !== "all" &&
      (!ids.length || (b.scope === "single" && ids.length !== 1))
    )
      throw new Response("세션을 선택하세요", { status: 400 });
    const sessions =
      b.scope === "all"
        ? await sql`SELECT * FROM atlas.sessions WHERE owner=${owner} AND deleted=false AND expires_at>now() ORDER BY first_received`
        : await sql`SELECT * FROM atlas.sessions WHERE owner=${owner} AND id IN ${sql(ids)} AND deleted=false AND expires_at>now()`;
    if (!sessions.length)
      throw new Response("분석할 세션이 없습니다", {
        status: b.scope === "all" ? 400 : 404,
      });
    if (b.scope !== "all" && sessions.length !== ids.length)
      throw new Response("선택한 세션을 사용할 수 없습니다", { status: 404 });
    if (sessions.length > 2000)
      throw new Response("한 번에 최대 2,000개 세션을 분석할 수 있습니다", {
        status: 413,
      });
    const [user] =
      await sql`SELECT settings,key_cipher FROM atlas.users WHERE id=${owner}`;
    const id = randomUUID();
    const version = analysisVersion();
    const settings = {
      ...normalizeSettings(user.settings),
      routingVersion: isFree(user.settings) ? routingVersion : "byok-1",
    };
    await sql`INSERT INTO atlas.jobs(id,owner,request_key,scope,settings,key_cipher) VALUES(${id},${owner},${b.requestKey},${b.scope},${sql.json(settings)},${user.key_cipher})`;
    for (const s of sessions) {
      const batches =
        await sql`SELECT id FROM atlas.batches WHERE session_id=${s.id} AND purged=false ORDER BY end_offset`;
      const [reuse] = b.force
        ? []
        : await sql`SELECT i.result FROM atlas.job_items i JOIN atlas.jobs j ON j.id=i.job_id WHERE i.session_id=${s.id} AND i.revision=${s.revision} AND i.status='completed' AND i.expires_at>now() AND i.result->>'analysisVersion'=${version} AND (j.settings-'theme')=(${sql.json(settings)}::jsonb-'theme') ORDER BY j.created_at DESC LIMIT 1`;
      await sql`INSERT INTO atlas.job_items(id,job_id,session_id,revision,batch_ids,expires_at,status,result) VALUES(${randomUUID()},${id},${s.id},${s.revision},${sql.json(batches.map((x) => x.id))},${s.expires_at},${reuse ? "completed" : "queued"},${reuse ? sql.json(reuse.result) : null})`;
    }
    return { id, existing: false };
  });
}
