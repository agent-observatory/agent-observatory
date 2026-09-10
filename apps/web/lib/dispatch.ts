import { start } from "workflow/api";
import { analysisWorkflow } from "../workflows/analysis";
import { db } from "./db";

// Serialize dispatch retries. Item leases also protect against an ambiguous
// network acknowledgement after the Workflow service has accepted a run.
export async function dispatchJob(id: string) {
  try {
    await db().begin(async (sql) => {
      const [job] =
        await sql`SELECT * FROM atlas.jobs WHERE id=${id} FOR UPDATE`;
      if (!job || job.run_id || ["completed", "partial"].includes(job.status))
        return;
      const run = await start(analysisWorkflow, [id], {
        region: "icn1",
        experimental_retention: 0,
      });
      await sql`UPDATE atlas.jobs SET run_id=${run.runId},status='queued' WHERE id=${id}`;
    });
  } catch {
    await db()`UPDATE atlas.jobs SET status='dispatch_failed' WHERE id=${id} AND run_id IS NULL`;
    throw new Response("분석 등록 실패 · 재시도 가능", { status: 503 });
  }
}
