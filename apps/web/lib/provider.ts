import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch as request } from "undici";
export function publicAddress(address: string) {
  try {
    const a = ipaddr.process(address);
    return a.range() === "unicast";
  } catch {
    return false;
  }
}
export async function validateEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new Error("공개 HTTPS 기본 URL만 사용할 수 있습니다");
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw new Error("공개 서비스 주소만 사용할 수 있습니다");
  return { url, records };
}
export async function completion(endpoint: string, key: string, body: unknown) {
  const { url, records } = await validateEndpoint(endpoint);
  url.pathname = url.pathname.replace(/\/$/, "") + "/chat/completions";
  const record = records[0];
  const agent = new Agent({
    connect: {
      lookup: ((_hostname: any, _options: any, cb: any) => {
        if (_options?.all) cb(null, [record]);
        else cb(null, record.address, record.family);
      }) as any,
    },
  });
  try {
    const r = await request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      dispatcher: agent,
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
    const reader = r.body?.getReader();
    let text = "",
      bytes = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 100000) {
          await reader.cancel();
          throw new Error("Provider response too large");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    const code = String(data?.error?.code || "");
    return {
      status: r.status,
      retryAfter: r.headers.get("retry-after"),
      errorCode: /^[a-zA-Z0-9_-]{1,32}$/.test(code) ? code : null,
      data: r.ok ? data : null,
    };
  } finally {
    await agent.close();
  }
}

export function retryDelay(attempt: number, retryAfter?: string | null) {
  const seconds = Number(retryAfter);
  const requested = Number.isFinite(seconds)
    ? seconds
    : Math.max(0, (Date.parse(retryAfter || "") - Date.now()) / 1000) || 0;
  return (
    Math.max(
      [300, 1800, 7200, 21600][Math.min(attempt, 3)],
      Math.min(requested, 86400),
    ) + Math.floor(Math.random() * 30)
  );
}
