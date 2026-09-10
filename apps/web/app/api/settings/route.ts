import { z } from "zod";
import { endpoint, owner, limitedJson, seal } from "../../../lib/security";
import { db } from "../../../lib/db";
import { validateEndpoint } from "../../../lib/provider";
const Settings = z.object({
  language: z.enum(["ko", "en"]),
  theme: z.enum(["dark", "light", "system"]),
  masking: z.boolean(),
  provider: z.enum(["zai", "openrouter", "custom"]),
  endpoint: z.string().max(1000),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(4096).optional(),
  removeKey: z.boolean().optional(),
});
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req);
    const p = Settings.safeParse(await limitedJson(req, 16000));
    if (!p.success) throw new Response("설정 형식 오류", { status: 400 });
    const { apiKey, removeKey, ...s } = p.data;
    if (s.provider === "zai") {
      s.endpoint = "https://api.z.ai/api/paas/v4";
      s.model = "glm-4.7-flash";
    } else {
      if (s.provider === "openrouter")
        s.endpoint = "https://openrouter.ai/api/v1";
      try {
        await validateEndpoint(s.endpoint);
      } catch {
        throw new Response("공개 HTTPS endpoint를 입력하세요", { status: 400 });
      }
    }
    const [old] =
      await db()`SELECT settings,key_cipher FROM atlas.users WHERE id=${id}`;
    let cipher = old.key_cipher;
    // Never send an old endpoint's key to a newly selected provider.
    if (old.settings.endpoint !== s.endpoint || removeKey) cipher = null;
    if (apiKey) cipher = seal(apiKey);
    await db()`UPDATE atlas.users SET settings=${db().json(s)},key_cipher=${cipher} WHERE id=${id}`;
    return Response.json({ settings: s, has_key: !!cipher });
  });
