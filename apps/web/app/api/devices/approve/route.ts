import {
  endpoint,
  owner,
  limitedJson,
  rate,
  dailyKey,
} from "../../../../lib/security";
import { db } from "../../../../lib/db";
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await owner(req);
    await rate(dailyKey("pair:" + id), 20);
    const body = await limitedJson(req, 1000);
    return db().begin(async (sql) => {
      const [p] =
        await sql`SELECT * FROM atlas.pairings WHERE user_code=${String(body.code).toUpperCase()} AND expires_at>now() AND approved=false FOR UPDATE`;
      if (!p)
        throw new Response("코드가 만료되었거나 유효하지 않습니다", {
          status: 400,
        });
      const assigned =
        await sql`UPDATE atlas.devices SET owner=${id} WHERE id=${p.device_id} AND owner IS NULL AND revoked=false RETURNING id`;
      if (!assigned.length)
        throw new Response("이미 연결된 기기입니다", { status: 409 });
      await sql`UPDATE atlas.pairings SET approved=true WHERE code_hash=${p.code_hash}`;
      return Response.json({ ok: true });
    });
  });
