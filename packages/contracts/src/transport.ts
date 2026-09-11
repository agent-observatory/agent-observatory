import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import {
  Batch,
  MAX_COMPRESSED_BATCH_BYTES,
  MAX_DECODED_BATCH_BYTES,
  type AtlasBatch,
} from "@agent-observatory/contracts";

export const ATLAS_CONTENT_ENCODING = "zstd";

export function canonicalBatch(batch: unknown): {
  batch: AtlasBatch;
  json: string;
  bytes: Buffer;
} {
  const parsed = Batch.parse(batch);
  const json = JSON.stringify(parsed);
  const bytes = Buffer.from(json);
  if (bytes.length > MAX_DECODED_BATCH_BYTES)
    throw new Error("Decoded batch exceeds the 8 MiB limit");
  return { batch: parsed, json, bytes };
}

export function compressBatch(batch: unknown): Buffer {
  const { bytes } = canonicalBatch(batch);
  const compressed = zstdCompressSync(bytes, {
    params: { [constants.ZSTD_c_compressionLevel]: 3 },
  });
  if (compressed.length > MAX_COMPRESSED_BATCH_BYTES)
    throw new Error("Compressed batch exceeds the 1 MiB limit");
  return compressed;
}

export function decompressBatch(
  input: Uint8Array,
): ReturnType<typeof canonicalBatch> {
  const decoded = decompressBytes(input);
  let value: unknown;
  try {
    value = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error("Decoded batch is not valid JSON");
  }
  return canonicalBatch(value);
}

export function decompressBytes(input: Uint8Array): Buffer {
  if (input.byteLength > MAX_COMPRESSED_BATCH_BYTES)
    throw new Error("Compressed batch exceeds the 1 MiB limit");
  return zstdDecompressSync(input, {
    maxOutputLength: MAX_DECODED_BATCH_BYTES,
  });
}
