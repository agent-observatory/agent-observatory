import { z } from "zod";
const paths = z.array(z.string().max(4096)).max(200);
export const DeviceSnapshot = z
  .object({
    observedAt: z.iso.datetime(),
    paused: z.boolean(),
    sourceTypes: z.array(z.enum(["codex", "claude-code"])).max(2),
    include: paths,
    exclude: paths,
    since: z.iso.datetime().optional(),
    until: z.iso.datetime().optional(),
    projects: z
      .array(
        z
          .object({
            project: z.string().max(4096),
            sessions: z.number().int().nonnegative(),
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(200),
    sessions: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    pendingBatches: z.number().int().nonnegative(),
    pendingBytes: z.number().int().nonnegative(),
  })
  .strict();
export type DeviceSnapshot = z.infer<typeof DeviceSnapshot>;
export const InspectionReply = z.discriminatedUnion("status", [
  z
    .object({
      requestId: z.uuid(),
      status: z.literal("complete"),
      snapshot: DeviceSnapshot,
    })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      status: z.literal("failed"),
      error: z.literal("inspection_failed"),
    })
    .strict(),
]);
