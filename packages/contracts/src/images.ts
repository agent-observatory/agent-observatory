import { codexEvent, type AtlasEvent } from "@agent-observatory/contracts";

const DATA_IMAGE = /data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/_-]+={0,2})/gi;

function decodeBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function dimensions(bytes: Uint8Array, mimeType: string) {
  if (
    mimeType === "image/png" &&
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === "image/jpeg" && bytes.length >= 4) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        offset + 8 < bytes.length
      )
        return {
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        };
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return {};
}

async function sanitizeString(value: string) {
  // Tool results may contain JSON text whose URL slash is still escaped.
  value = value.replace(/data:image\\\//gi, "data:image/");
  const matches = [...value.matchAll(DATA_IMAGE)];
  if (!matches.length)
    return { value, images: [] as NonNullable<AtlasEvent["images"]> };
  const replacements = await Promise.all(
    matches.map(async (match) => {
      const mimeType = match[1].toLowerCase();
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64(match[2]);
      } catch {
        return {
          match: match[0],
          replacement: "[image:invalid omitted: local-only]",
          image: null,
        };
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        Uint8Array.from(bytes),
      );
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const image = {
        sha256,
        mimeType,
        bytes: bytes.byteLength,
        ...dimensions(bytes, mimeType),
        status: "local_only" as const,
      };
      return {
        match: match[0],
        replacement: `[image:${sha256} omitted: local-only]`,
        image,
      };
    }),
  );
  let cursor = 0;
  let sanitized = "";
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    sanitized +=
      value.slice(cursor, match.index) + replacements[index].replacement;
    cursor = (match.index ?? 0) + match[0].length;
  }
  return {
    value: sanitized + value.slice(cursor),
    images: replacements.flatMap(({ image }) => (image ? [image] : [])),
  };
}

async function sanitizeValue(
  value: unknown,
): Promise<{ value: unknown; images: NonNullable<AtlasEvent["images"]> }> {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) {
    const parts = await Promise.all(value.map(sanitizeValue));
    return {
      value: parts.map((part) => part.value),
      images: parts.flatMap((part) => part.images),
    };
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([key, child]) => [key, await sanitizeValue(child)] as const,
      ),
    );
    return {
      value: Object.fromEntries(
        entries.map(([key, part]) => [key, part.value]),
      ),
      images: entries.flatMap(([, part]) => part.images),
    };
  }
  return { value, images: [] };
}

export async function sanitizeEventImages(
  event: AtlasEvent,
): Promise<AtlasEvent> {
  if (event.text === undefined) return event;
  const sanitized = await sanitizeString(event.text);
  const images = [...(event.images ?? []), ...sanitized.images];
  return {
    ...event,
    text: sanitized.value,
    ...(images.length ? { images } : {}),
  };
}

export async function codexEventWithImages(record: unknown, id: string) {
  const sanitized = await sanitizeValue(record);
  const event = codexEvent(sanitized.value, id);
  if (!event) return null;
  const images = [...(event.images ?? []), ...sanitized.images];
  return images.length ? { ...event, images } : event;
}
