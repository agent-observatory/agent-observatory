import { InspectionReply } from "@agent-observatory/contracts/device-inspection";
import { db } from "../../../../lib/db";
import { endpoint, hash, limitedJson } from "../../../../lib/security";
const json = (value: unknown) =>
  Response.json(value, { headers: { "Cache-Control": "no-store" } });
async function device(req: Request) {
  const token = req.headers.get("authorization");
  if (!token?.startsWith("Bearer "))
    throw new Response("기기 인증 필요", { status: 401 });
  const [d] =
    await db()`SELECT id FROM atlas.devices WHERE token_hash=${hash(token.slice(7))} AND revoked=false AND owner IS NOT NULL`;
  if (!d) throw new Response("기기 인증 필요", { status: 401 });
  return String(d.id);
}
export const GET = (req: Request) =>
  endpoint(async () => {
    const token = req.headers.get("authorization");
    if (!token?.startsWith("Bearer "))
      throw new Response("기기 인증 필요", { status: 401 });
    const [row] = await db()`WITH connected AS (
      UPDATE atlas.devices SET control_seen_at=now()
      WHERE token_hash=${hash(token.slice(7))} AND revoked=false AND owner IS NOT NULL RETURNING id
    ), expired AS (
      DELETE FROM atlas.device_inspections i USING connected c WHERE i.device_id=c.id AND i.expires_at<=now()
    ) SELECT c.id,(SELECT request_id FROM atlas.device_inspections i WHERE i.device_id=c.id AND i.status='pending' AND i.expires_at>now()) AS request_id FROM connected c`;
    if (!row) throw new Response("기기 인증 필요", { status: 401 });
    return json({ requestId: row.request_id || null });
  });
export const POST = (req: Request) =>
  endpoint(async () => {
    const id = await device(req);
    const parsed = InspectionReply.safeParse(await limitedJson(req, 3_000_000));
    if (!parsed.success)
      throw new Response("잘못된 조회 응답", { status: 422 });
    const b = parsed.data;
    const rows =
      await db()`UPDATE atlas.device_inspections SET status=${b.status},snapshot=${b.status === "complete" ? db().json(b.snapshot) : null},expires_at=now()+interval '5 minutes' WHERE device_id=${id} AND request_id=${b.requestId} AND status='pending' AND expires_at>now() AND EXISTS(SELECT 1 FROM atlas.devices WHERE id=${id} AND revoked=false) RETURNING request_id`;
    if (!rows.length) throw new Response("만료된 조회 요청", { status: 410 });
    return json({ ok: true });
  });
