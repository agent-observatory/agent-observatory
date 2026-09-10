import { randomBytes } from "node:crypto";
import { endpoint, limitedJson, hash } from "../../../../lib/security";
import { db } from "../../../../lib/db";
export const POST = (req: Request) =>
  endpoint(async () => {
    const body = await limitedJson(req, 1000);
    return db().begin(async (sql) => {
      const [p] =
        await sql`SELECT * FROM atlas.pairings WHERE code_hash=${hash(String(body.device_code))} AND expires_at>now() AND claimed=false FOR UPDATE`;
      if (!p) throw new Response("연결 코드 만료", { status: 410 });
      if (!p.approved) return Response.json({ pending: true }, { status: 202 });
      const token = randomBytes(32).toString("hex");
      await sql`UPDATE atlas.devices SET token_hash=${hash(token)} WHERE id=${p.device_id}`;
      await sql`UPDATE atlas.pairings SET claimed=true WHERE code_hash=${p.code_hash}`;
      return Response.json({ device_id: p.device_id, token });
    });
  });
