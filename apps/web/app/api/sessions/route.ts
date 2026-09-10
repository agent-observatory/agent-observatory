import { endpoint, owner } from "../../../lib/security";
import { db } from "../../../lib/db";
export const GET = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req, true);
    const rows =
      await db()`SELECT s.id,s.project,s.source_id,s.revision,s.first_received,s.expires_at,latest.status,latest.result->'metrics' AS metrics,jsonb_array_length(latest.result->'candidates') AS candidate_count FROM atlas.sessions s LEFT JOIN LATERAL (SELECT i.status,i.result FROM atlas.job_items i WHERE i.session_id=s.id AND i.expires_at>now() ORDER BY (i.status='completed') DESC,i.revision DESC LIMIT 1) latest ON true WHERE s.owner=${id} AND s.deleted=false AND s.expires_at>now() ORDER BY s.first_received DESC LIMIT 2000`;
    const summaries =
      await db()`SELECT session_id,metrics,candidate_count,expires_at FROM atlas.summaries WHERE owner=${id} AND expires_at>now()`;
    const jobs =
      await db()`SELECT j.id,j.scope,j.status,j.created_at,count(i.id)::int AS total,count(i.id) FILTER(WHERE i.status='completed')::int AS completed,count(i.id) FILTER(WHERE i.status='failed')::int AS failed FROM atlas.jobs j JOIN atlas.job_items i ON i.job_id=j.id AND i.expires_at>now() WHERE j.owner=${id} GROUP BY j.id ORDER BY j.created_at DESC LIMIT 20`;
    return Response.json({ sessions: rows, summaries, jobs });
  });
