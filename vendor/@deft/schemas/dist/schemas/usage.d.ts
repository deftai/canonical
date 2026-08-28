import { z } from "zod";
export declare const USAGE_SCHEMA_VERSION = "1";
export declare const UsagePayloadSchema: z.ZodObject<{
    metric: z.ZodString;
    value: z.ZodNumber;
    period: z.ZodOptional<z.ZodString>;
    dimensions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
}, z.core.$strict>;
export type UsagePayload = z.infer<typeof UsagePayloadSchema>;
//# sourceMappingURL=usage.d.ts.map