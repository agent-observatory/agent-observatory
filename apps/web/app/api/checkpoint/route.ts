import { endpoint, owner } from "../../../lib/security";
import { db } from "../../../lib/db";
export const GET = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req, true, true);
    const q = new URL(req.url).searchParams;
    const [s] =
      await db()`SELECT offset_bytes,deleted,expires_at FROM atlas.sessions WHERE owner=${id} AND source_id=${q.get("session_id") || ""} AND generation=${q.get("generation") || ""}`;
    if (s && (s.deleted || new Date(s.expires_at).getTime() <= Date.now()))
      throw new Response("만료된 세션", { status: 410 });
    return Response.json({ offset: Number(s?.offset_bytes || 0) });
  });
