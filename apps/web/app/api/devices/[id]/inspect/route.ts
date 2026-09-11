import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../../../../../lib/db";
import { endpoint, owner, rate } from "../../../../../lib/security";
const offline =
  "Collector 연결을 확인할 수 없습니다. PC에서 atlas-collector start를 실행해 주세요.";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
type Context = { params: Promise<{ id: string }> };
export const POST = (req: Request, ctx: Context) =>
  endpoint(async () => {
    const user = await owner(req);
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success)
      throw new Response("기기 없음", { status: 404 });
    await rate(`inspection:${user}:${Math.floor(Date.now() / 60000)}`, 10);
    return db().begin(async (sql) => {
      const [device] =
        await sql`SELECT id, control_seen_at > now()-interval '40 seconds' AS online FROM atlas.devices WHERE id=${id} AND owner=${user} AND revoked=false FOR UPDATE`;
      if (!device) throw new Response("기기 없음", { status: 404 });
      if (!device.online) return json({ error: offline }, 409);
      const [pending] =
        await sql`SELECT request_id FROM atlas.device_inspections WHERE device_id=${id} AND status='pending' AND expires_at>now()`;
      if (pending)
        return json({ requestId: pending.request_id, status: "pending" });
      const requestId = randomUUID();
      await sql`INSERT INTO atlas.device_inspections(device_id,request_id,status,expires_at) VALUES(${id},${requestId},'pending',now()+interval '60 seconds') ON CONFLICT(device_id) DO UPDATE SET request_id=excluded.request_id,status='pending',snapshot=null,expires_at=excluded.expires_at`;
      return json({ requestId, status: "pending" });
    });
  });
export const GET = (req: Request, ctx: Context) =>
  endpoint(async () => {
    const user = await owner(req);
    const { id } = await ctx.params;
    const requestId = new URL(req.url).searchParams.get("requestId");
    if (
      !z.uuid().safeParse(id).success ||
      !z.uuid().safeParse(requestId).success
    )
      throw new Response("잘못된 조회 요청", { status: 422 });
    const [row] =
      await db()`SELECT i.status,i.snapshot,i.expires_at>now() AS valid FROM atlas.device_inspections i JOIN atlas.devices d ON d.id=i.device_id WHERE d.id=${id} AND d.owner=${user} AND d.revoked=false AND i.request_id=${requestId!}`;
    if (!row) throw new Response("조회 요청 없음", { status: 404 });
    if (!row.valid) return json({ status: "expired", error: offline });
    return json({
      status: row.status,
      ...(row.status === "complete"
        ? { snapshot: row.snapshot }
        : row.status === "failed"
          ? {
              error:
                "로컬 설정 조회 실패. atlas-collector doctor로 상태를 확인해 주세요.",
            }
          : {}),
    });
  });
