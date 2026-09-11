import { endpoint, owner } from "../../../lib/security";
import { db } from "../../../lib/db";
import { normalizeSettings, freeCandidates } from "../../../lib/ai-routing";
export const GET = (req: Request) =>
  endpoint(async () => {
    const publicCandidates = freeCandidates().map(
      ({ provider, model, endpoint }) => ({ provider, model, endpoint }),
    );
    let id;
    try {
      id = await owner(req, true);
    } catch {
      return Response.json({ user: null, freeCandidates: publicCandidates });
    }
    const [user] =
      await db()`SELECT id,name,guest,settings,key_cipher IS NOT NULL AS has_key FROM atlas.users WHERE id=${id}`;
    return Response.json({
      user: user
        ? { ...user, settings: normalizeSettings(user.settings) }
        : null,
      freeCandidates: publicCandidates,
    });
  });
