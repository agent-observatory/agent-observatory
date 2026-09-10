import { randomUUID } from "node:crypto";
import { Batch, maskBatch } from "@agent-observatory/contracts";
import { db } from "./db";
import { hash } from "./security";
import { storage } from "./storage";
export async function ingest(
  owner: string,
  input: unknown,
  expectedHash?: string | null,
) {
  const parsed = Batch.safeParse(input);
  if (!parsed.success)
    throw new Response("지원하지 않는 배치 형식", { status: 422 });
  const b = parsed.data;
  const received = hash(JSON.stringify(b));
  if (expectedHash && received !== expectedHash)
    throw new Response("본문 해시 불일치", { status: 400 });
  return db().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${owner},0))`;
    const old =
      await sql`SELECT * FROM atlas.batches WHERE owner=${owner} AND id=${b.batch_id}`;
    if (old.length) {
      if (old[0].received_hash !== received)
        throw new Response("같은 배치의 내용이 다릅니다", { status: 409 });
      return {
        batch_id: b.batch_id,
        received_sha256: received,
        end_offset: Number(old[0].end_offset),
      };
    }
    const [user] =
      await sql`SELECT settings,guest FROM atlas.users WHERE id=${owner}`;
    if (!user) throw new Response("계정 없음", { status: 401 });
    const masked = user.guest || user.settings.masking !== false;
    const stored = masked ? maskBatch(b) : b;
    const body = JSON.stringify(stored);
    await sql`SELECT pg_advisory_xact_lock(782111)`;
    const [database] =
      await sql`SELECT pg_database_size(current_database()) AS size`;
    if (Number(database.size) > 350 * 1024 * 1024)
      throw new Response("DB 저장 용량 한도", { status: 429 });
    const [quota] =
      await sql`SELECT coalesce(sum(bytes),0)::bigint AS size FROM atlas.batches WHERE purged=false`;
    if (Number(quota.size) + Buffer.byteLength(body) > 700 * 1024 * 1024)
      throw new Response("저장 용량 한도", { status: 429 });
    const [day] =
      await sql`SELECT coalesce(sum(bytes),0)::bigint AS size FROM atlas.batches WHERE owner=${owner} AND created_at>now()-interval '1 day'`;
    if (
      Number(day.size) + Buffer.byteLength(body) >
      (user.guest ? 2 : 40) * 1024 * 1024
    )
      throw new Response("일일 업로드 한도", { status: 429 });
    const [found] =
      await sql`SELECT * FROM atlas.sessions WHERE owner=${owner} AND source_id=${b.session_id} AND generation=${b.generation}`;
    if (
      found &&
      (found.deleted || new Date(found.expires_at).getTime() <= Date.now())
    )
      throw new Response("만료되거나 삭제된 세션", { status: 410 });
    const sid = found?.id || randomUUID();
    const offset = Number(found?.offset_bytes || 0);
    if (b.start_offset !== offset)
      throw new Response("서버 접수 위치를 다시 확인하세요", { status: 409 });
    const objectPath = hash(owner) + "/" + sid + "/" + b.batch_id + ".json";
    const { error } = await storage().upload(objectPath, body, {
      contentType: "application/json",
      upsert: true,
    });
    if (error) throw new Error("Storage upload failed");
    if (!found)
      await sql`INSERT INTO atlas.sessions(id,owner,source_id,generation,project) VALUES(${sid},${owner},${b.session_id},${b.generation},${stored.project})`;
    await sql`INSERT INTO atlas.batches(id,owner,session_id,received_hash,stored_hash,path,bytes,end_offset,masking) VALUES(${b.batch_id},${owner},${sid},${received},${hash(body)},${objectPath},${Buffer.byteLength(body)},${b.end_offset},${masked})`;
    await sql`UPDATE atlas.sessions SET revision=revision+1,offset_bytes=${b.end_offset} WHERE id=${sid}`;
    return {
      batch_id: b.batch_id,
      received_sha256: received,
      end_offset: b.end_offset,
    };
  });
}
