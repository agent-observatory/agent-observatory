import { endpoint, owner, limitedBatch } from "../../../lib/security";
import { ingest } from "../../../lib/ingest";
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req, true, true);
    return Response.json(
      await ingest(
        id,
        await limitedBatch(req),
        req.headers.get("x-content-sha256"),
      ),
    );
  });
