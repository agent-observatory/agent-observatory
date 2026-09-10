import { randomUUID } from "node:crypto";
import {
  endpoint,
  owner,
  rate,
  dailyKey,
  unseal,
} from "../../../../lib/security";
import { db } from "../../../../lib/db";
import { completion } from "../../../../lib/provider";

export const maxDuration = 180;
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req);
    await rate(dailyKey("connection-test:" + id), 10);
    const [user] =
      await db()`SELECT settings,key_cipher FROM atlas.users WHERE id=${id}`;
    const key =
      user.settings.provider === "zai"
        ? process.env.ZAI_API_KEY
        : user.key_cipher
          ? unseal(user.key_cipher)
          : null;
    if (!key) throw new Response("저장된 API 키가 없습니다", { status: 400 });
    const holder = randomUUID(),
      leaseKey = user.settings.provider === "zai" ? "zai-global" : "byok:" + id;
    const lease =
      await db()`INSERT INTO atlas.leases(key,holder,expires_at) VALUES(${leaseKey},${holder},now()+interval '600 seconds') ON CONFLICT(key) DO UPDATE SET holder=excluded.holder,expires_at=excluded.expires_at WHERE atlas.leases.expires_at<now() RETURNING key`;
    if (!lease.length)
      throw new Response("AI 요청이 진행 중입니다. 완료 후 다시 테스트하세요", {
        status: 429,
      });
    try {
      const result = await completion(user.settings.endpoint, key, {
        model: user.settings.model,
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: "This is a synthetic connection test. Reply with OK.",
          },
        ],
      });
      if (result.status !== 200 || !result.data?.choices?.[0]?.message?.content)
        throw new Response(
          `연결 테스트 실패 (HTTP ${result.status}${result.errorCode ? " · " + result.errorCode : ""})`,
          { status: 502 },
        );
      return Response.json({
        ok: true,
        model: result.data.model || user.settings.model,
        provider: user.settings.provider,
      });
    } finally {
      await db()`DELETE FROM atlas.leases WHERE key=${leaseKey} AND holder=${holder}`;
    }
  });
