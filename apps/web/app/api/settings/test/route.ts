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
import {
  isFree,
  candidates,
  selectCandidate,
  attemptCompletion,
  failureCooldownKey,
} from "../../../../lib/ai-routing";

export const maxDuration = 180;
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req);
    await rate(dailyKey("connection-test:" + id), 10);
    const [user] =
      await db()`SELECT settings,key_cipher FROM atlas.users WHERE id=${id}`;
    const free = isFree(user.settings),
      pool = candidates(user.settings);
    if (!pool.length || (!free && !user.key_cipher))
      throw new Response("저장된 API 키가 없습니다", { status: 400 });
    const holder = randomUUID(),
      leaseKey = free ? "zai-global" : "byok:" + id;
    const lease =
      await db()`INSERT INTO atlas.leases(key,holder,expires_at) VALUES(${leaseKey},${holder},now()+interval '600 seconds') ON CONFLICT(key) DO UPDATE SET holder=excluded.holder,expires_at=excluded.expires_at WHERE atlas.leases.expires_at<now() RETURNING key`;
    if (!lease.length)
      throw new Response("AI 요청이 진행 중입니다. 완료 후 다시 테스트하세요", {
        status: 429,
      });
    try {
      const cooldowns: Record<string, number> = {};
      if (free) {
        for (const row of await db()`SELECT key,expires_at FROM atlas.leases WHERE key LIKE 'ai-cooldown:%' AND expires_at>now()`)
          cooldowns[row.key.slice("ai-cooldown:".length)] = new Date(
            row.expires_at,
          ).getTime();
      }
      for (let n = 0; n < Math.min(pool.length, 3); n++) {
        const { candidate } = selectCandidate(pool, cooldowns);
        if (!candidate) break;
        const key = free
          ? process.env[candidate.keyEnv!]!
          : unseal(user.key_cipher);
        const result = await attemptCompletion(
          candidate,
          key,
          free,
          {
            max_tokens: 4000,
            messages: [
              {
                role: "user",
                content:
                  'Synthetic connection test. Return only JSON: {"summary":"OK","suggestions":[]}',
              },
            ],
          },
          new Set(),
          0,
          (url, apiKey, body) => completion(url, apiKey, body, 45000),
        );
        if (result.ok)
          return Response.json({
            ok: true,
            tier: result.tier,
            provider: result.provider,
            model: result.model,
            endpoint: result.endpoint,
          });
        if (!free)
          throw new Response(
            "연결 테스트 실패 · 저장된 제공자와 모델 설정을 확인하세요",
            { status: 502 },
          );
        const until = new Date(Date.now() + result.waitSeconds * 1000);
        cooldowns[failureCooldownKey(candidate, result.attempt)] =
          until.getTime();
        await db()`INSERT INTO atlas.leases(key,holder,expires_at) VALUES(${"ai-cooldown:" + failureCooldownKey(candidate, result.attempt)},'cooldown',${until}) ON CONFLICT(key) DO UPDATE SET expires_at=GREATEST(atlas.leases.expires_at,excluded.expires_at)`;
      }
      if (selectCandidate(pool, cooldowns).candidate)
        throw new Response(
          "연결 테스트 시간 안에 확인하지 못했습니다. 분석 작업은 남은 후보도 시도합니다.",
          { status: 502 },
        );
      throw new Response(
        "무료 AI 후보가 모두 대기 중입니다. 백오프 후 다시 확인하세요",
        { status: 429 },
      );
    } finally {
      await db()`DELETE FROM atlas.leases WHERE key=${leaseKey} AND holder=${holder}`;
    }
  });
