import { endpoint, owner } from "../../../lib/security";
import { db } from "../../../lib/db";
import { sessionPage, sessionPagination } from "../../../lib/pagination";
export const GET = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req, true);
    const { page, pageSize, q } = sessionPage(req.url);
    const filter = q
      ? db()`AND (strpos(lower(s.project),lower(${q}))>0 OR strpos(lower(s.source_id),lower(${q}))>0)`
      : db()``;
    const [{ total }] =
      await db()`SELECT count(*)::int AS total FROM atlas.sessions s WHERE s.owner=${id} AND s.deleted=false AND s.expires_at>now() ${filter}`;
    const pagination = sessionPagination(page, pageSize, Number(total));
    const offset = (pagination.page - 1) * pageSize;
    const rows =
      await db()`SELECT s.id,s.project,s.source_id,s.revision,s.source,s.first_received,s.last_received,s.ingestion_complete_at,s.expires_at,latest.status,latest.attempts,latest.error AS status_reason,latest.result->'metrics' AS metrics,jsonb_array_length(latest.result->'candidates') AS candidate_count FROM atlas.sessions s LEFT JOIN LATERAL (SELECT i.status,i.result,i.attempts,i.error FROM atlas.job_items i JOIN atlas.jobs j ON j.id=i.job_id WHERE i.session_id=s.id AND j.owner=${id} AND i.expires_at>now() ORDER BY i.revision DESC,j.created_at DESC,i.id DESC LIMIT 1) latest ON true WHERE s.owner=${id} AND s.deleted=false AND s.expires_at>now() ${filter} ORDER BY s.first_received DESC,s.id DESC LIMIT ${pageSize} OFFSET ${offset}`;
    const [overview] =
      await db()`SELECT count(*)::int AS sessions,count(summary.session_id)::int AS completed,coalesce(sum((summary.metrics->>'toolCalls')::bigint),0)::bigint AS tool_calls,coalesce(sum(summary.candidate_count),0)::bigint AS candidate_count FROM atlas.sessions s LEFT JOIN atlas.summaries summary ON summary.session_id=s.id AND summary.owner=${id} AND summary.expires_at>now() WHERE s.owner=${id} AND s.deleted=false AND s.expires_at>now()`;
    const projects =
      await db()`SELECT s.project,count(*)::int AS sessions,count(summary.session_id)::int AS completed,coalesce(sum((summary.metrics->>'toolCalls')::bigint),0)::bigint AS tool_calls,coalesce(sum(summary.candidate_count),0)::bigint AS candidate_count FROM atlas.sessions s LEFT JOIN atlas.summaries summary ON summary.session_id=s.id AND summary.owner=${id} AND summary.expires_at>now() WHERE s.owner=${id} AND s.deleted=false AND s.expires_at>now() GROUP BY s.project ORDER BY sessions DESC,s.project`;
    const summaries =
      await db()`SELECT session_id,metrics,candidate_count,expires_at FROM atlas.summaries WHERE owner=${id} AND expires_at>now()`;
    const jobs =
      await db()`SELECT j.id,j.scope,j.status,j.created_at,count(i.id)::int AS total,count(i.id) FILTER(WHERE i.status='completed')::int AS completed,count(i.id) FILTER(WHERE i.status='failed')::int AS failed,count(i.id) FILTER(WHERE i.status='running')::int AS running,count(i.id) FILTER(WHERE i.status='queued')::int AS queued,count(i.id) FILTER(WHERE i.status='queued' AND i.attempts>0)::int AS retrying FROM atlas.jobs j JOIN atlas.job_items i ON i.job_id=j.id AND i.expires_at>now() WHERE j.owner=${id} GROUP BY j.id ORDER BY j.created_at DESC LIMIT 20`;
    return Response.json({
      sessions: rows,
      pagination,
      overview: {
        sessions: Number(overview.sessions),
        completed: Number(overview.completed),
        toolCalls: Number(overview.tool_calls),
        candidateCount: Number(overview.candidate_count),
      },
      projects: projects.map((project) => ({
        project: project.project,
        sessions: Number(project.sessions),
        completed: Number(project.completed),
        toolCalls: Number(project.tool_calls),
        candidateCount: Number(project.candidate_count),
      })),
      summaries,
      jobs,
    });
  });
