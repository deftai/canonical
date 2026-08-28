// SUB-5 / SUB-5a: strict Zod schema for the `usage` scope payload. Optional `dimensions`
// (string|number|boolean values; key `^[a-z][a-z0-9_]{0,63}$`; ≤32 keys).
import { z } from "zod";
export const USAGE_SCHEMA_VERSION = "1";
const DIMENSION_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const UsageDimensionsSchema = z
    .record(z.string().regex(DIMENSION_KEY_RE), z.union([z.string(), z.number(), z.boolean()]))
    .refine((obj) => Object.keys(obj).length <= 32, { message: "at most 32 dimension keys" });
export const UsagePayloadSchema = z
    .object({
    metric: z.string().min(1).max(100),
    value: z.number(),
    period: z.string().optional(),
    dimensions: UsageDimensionsSchema.optional(),
})
    .strict();
//# sourceMappingURL=usage.js.map