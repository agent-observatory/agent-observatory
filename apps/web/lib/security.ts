import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { auth } from "../auth";
import { db } from "./db";
import {
  ATLAS_CONTENT_ENCODING,
  decompressBytes,
} from "@agent-observatory/contracts/transport";
import {
  MAX_COMPRESSED_BATCH_BYTES,
  MAX_DECODED_BATCH_BYTES,
} from "@agent-observatory/contracts";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function secret(name: string) {
  const s = process.env[name];
  if (!s) throw new Error("Server secret is not configured");
  return s;
}
export function constant(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function seal(value: string) {
  const iv = randomBytes(12),
    key = Buffer.from(secret("BYOK_ENCRYPTION_KEY"), "hex");
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body]
    .map((x) => x.toString("base64url"))
    .join(".");
}
export function unseal(value: string) {
  const [iv, tag, body] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const c = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(secret("BYOK_ENCRYPTION_KEY"), "hex"),
    iv,
  );
  c.setAuthTag(tag);
  return Buffer.concat([c.update(body), c.final()]).toString("utf8");
}
export function origin(req: Request) {
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.get("origin") !== new URL(secret("APP_URL")).origin
  )
    throw new Response("요청 출처를 확인할 수 없습니다", { status: 403 });
}
function sign(s: string) {
  return createHmac("sha256", secret("AUTH_SECRET")).update(s).digest("hex");
}
export async function owner(
  req?: Request,
  allowGuest = false,
  allowDevice = false,
) {
  if (req?.headers.get("authorization")) {
    if (!allowDevice)
      throw new Response("이 작업은 브라우저 로그인이 필요합니다", {
        status: 403,
      });
    const t = req.headers.get("authorization")!.replace(/^Bearer /, "");
    const rows =
      await db()`SELECT owner FROM atlas.devices WHERE token_hash=${hash(t)} AND revoked=false AND owner IS NOT NULL`;
    if (!rows.length) throw new Response("기기 인증 필요", { status: 401 });
    return String(rows[0].owner);
  }
  if (req) origin(req);
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  if (allowGuest) {
    const jar = await cookies();
    const v = jar.get("atlas_guest")?.value || "";
    const [id, stamp, sig] = v.split(".");
    if (
      id &&
      stamp &&
      sig &&
      constant(sign(id + "." + stamp), sig) &&
      Date.now() - Number(stamp) < 7 * 86400000
    )
      return "guest:" + id;
  }
  throw new Response("로그인이 필요합니다", { status: 401 });
}
export async function guest() {
  const id = randomBytes(24).toString("hex"),
    stamp = String(Date.now());
  await db()`INSERT INTO atlas.users(id,name,guest) VALUES(${"guest:" + id},'방문자',true)`;
  const jar = await cookies();
  jar.set("atlas_guest", `${id}.${stamp}.${sign(id + "." + stamp)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
  return "guest:" + id;
}
export async function limitedJson(req: Request, max = 1048576) {
  const reader = req.body?.getReader();
  if (!reader) throw new Response("빈 요청", { status: 400 });
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > max) {
      await reader.cancel();
      throw new Response("파일 크기 제한 초과", { status: 413 });
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Response("JSON 형식 오류", { status: 400 });
  }
}
async function limitedBody(req: Request, max: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new Response("빈 요청", { status: 400 });
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > max) {
      await reader.cancel();
      throw new Response("파일 크기 제한 초과", { status: 413 });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function limitedBatch(req: Request) {
  const encoding = req.headers.get("x-atlas-content-encoding");
  if (encoding && encoding !== ATLAS_CONTENT_ENCODING)
    throw new Response("지원하지 않는 본문 인코딩", { status: 415 });
  try {
    const body =
      encoding === ATLAS_CONTENT_ENCODING
        ? decompressBytes(await limitedBody(req, MAX_COMPRESSED_BATCH_BYTES))
        : await limitedBody(req, MAX_COMPRESSED_BATCH_BYTES);
    return JSON.parse(body.toString("utf8"));
  } catch (e) {
    if (e instanceof Response) throw e;
    const tooLarge =
      e instanceof Error &&
      (e.message.includes("exceeds") ||
        ("code" in e && e.code === "ERR_BUFFER_TOO_LARGE"));
    throw new Response(tooLarge ? "파일 크기 제한 초과" : "JSON 형식 오류", {
      status: tooLarge ? 413 : 400,
    });
  }
}
export async function endpoint(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(
      "Atlas request failed",
      e instanceof Error ? e.name : "unknown",
    );
    return Response.json(
      { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요." },
      { status: 500 },
    );
  }
}
export async function rate(key: string, limit: number) {
  const rows =
    await db()`INSERT INTO atlas.rate_limits(key,count) VALUES(${key},1) ON CONFLICT(key) DO UPDATE SET count=atlas.rate_limits.count+1 RETURNING count`;
  if (rows[0].count > limit)
    throw new Response("잠시 후 다시 시도하세요", { status: 429 });
}
export function dailyKey(prefix: string) {
  return prefix + ":" + new Date().toISOString().slice(0, 10);
}
