import { endpoint, constant, secret } from "../../../../lib/security";
import { maintenance } from "../../../../lib/maintenance";
export const maxDuration = 300;
export const POST = (req: Request) =>
  endpoint(async () => {
    if (
      !constant(
        req.headers.get("authorization") || "",
        "Bearer " + secret("SCHEDULER_SECRET"),
      )
    )
      throw new Response("인증 필요", { status: 401 });
    return Response.json(await maintenance());
  });
