import { endpoint, owner } from "../../../lib/security";
import { db } from "../../../lib/db";
export const GET = (req: Request) =>
  endpoint(async () => {
    let id;
    try {
      id = await owner(req, true);
    } catch {
      return Response.json({ user: null });
    }
    const [user] =
      await db()`SELECT id,name,guest,settings,key_cipher IS NOT NULL AS has_key FROM atlas.users WHERE id=${id}`;
    return Response.json({ user: user || null });
  });
