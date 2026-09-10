import { randomBytes, randomUUID } from "node:crypto";
import { endpoint, hash, rate, dailyKey } from "../../../lib/security";
import { db } from "../../../lib/db";
export const POST = () =>
  endpoint(async () => {
    await rate(dailyKey("device-create"), 200);
    const code = randomBytes(32).toString("hex"),
      userCode = randomBytes(5).toString("hex").toUpperCase(),
      id = randomUUID();
    await db().begin(async (sql) => {
      await sql`INSERT INTO atlas.devices(id) VALUES(${id})`;
      await sql`INSERT INTO atlas.pairings(code_hash,user_code,device_id,expires_at) VALUES(${hash(code)},${userCode},${id},now()+interval '10 minutes')`;
    });
    return Response.json({
      device_code: code,
      user_code: userCode,
      verification_url: process.env.APP_URL + "/?connect=" + userCode,
    });
  });
