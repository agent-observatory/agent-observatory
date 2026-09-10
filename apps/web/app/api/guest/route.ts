import { endpoint, origin, guest, rate, dailyKey } from "../../../lib/security";
export const POST = (req: Request) =>
  endpoint(async () => {
    origin(req);
    await rate(dailyKey("guest-create"), 50);
    await guest();
    return Response.json({ ok: true });
  });
