import { endpoint, owner, limitedJson } from "../../../lib/security";
import { ingest } from "../../../lib/ingest";
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req, true, true);
    return Response.json(
      await ingest(
        id,
        await limitedJson(req),
        req.headers.get("x-content-sha256"),
      ),
    );
  });
