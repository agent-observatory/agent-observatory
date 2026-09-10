import { dispatchJob } from "../../../../lib/dispatch";
import { endpoint, constant, secret } from "../../../../lib/security";
import { db } from "../../../../lib/db";
import { registerJob } from "../../../../lib/jobs";
export const maxDuration = 300;
export const POST = (req: Request) =>
  endpoint(async () => {
    if (
      !constant(
        req.headers.get("authorization") || "",
        "Bearer " + secret("SCHEDULER_SECRET"),
      )
    )
      throw new Response("인증 필요", { status: 401 });
    const users =
      await db()`SELECT DISTINCT owner FROM atlas.sessions s WHERE expires_at>now() AND deleted=false AND owner NOT LIKE 'guest:%' AND NOT EXISTS(SELECT 1 FROM atlas.job_items i WHERE i.session_id=s.id AND i.revision=s.revision AND i.status='completed') LIMIT 100`;
    let started = 0;
    for (const u of users) {
      try {
        const job = await registerJob(u.owner, {
          scope: "all",
          requestKey: "daily:" + new Date().toISOString().slice(0, 10),
        });
        await dispatchJob(job.id);
        if (!job.existing) started++;
      } catch (e) {
        if (e instanceof Response && e.status === 429) continue;
        throw e;
      }
    }
    return Response.json({ started });
  });
