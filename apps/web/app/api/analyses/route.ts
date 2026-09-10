import { dispatchJob } from "../../../lib/dispatch";
import { registerJob } from "../../../lib/jobs";
import {
  endpoint,
  owner,
  limitedJson,
  rate,
  dailyKey,
} from "../../../lib/security";
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req, true);
    await rate(dailyKey("analysis:" + id), id.startsWith("guest:") ? 3 : 100);
    const job = await registerJob(id, await limitedJson(req, 100000));
    await dispatchJob(job.id);
    return Response.json({ jobId: job.id }, { status: 202 });
  });
