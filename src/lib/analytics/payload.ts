/** The /api/events request body. */
import { z } from "@/lib/zod";
import { USAGE_EVENTS } from "./events";

export const usagePayload = z.object({
  e: z.enum(USAGE_EVENTS),
  s: z
    .string()
    .regex(/^[a-z0-9:_-]{0,64}$/)
    .default(""),
  v: z.number().finite().min(0).max(600_000).optional(),
  /** Vitals: whether the browser rated the value good. */
  g: z.boolean().optional(),
});
export type UsagePayload = z.infer<typeof usagePayload>;
