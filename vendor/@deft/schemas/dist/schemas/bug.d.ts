import { z } from "zod";
export declare const BUG_SCHEMA_VERSION = "1";
export declare const BugPayloadSchema: z.ZodObject<{
    summary: z.ZodString;
    os: z.ZodString;
    stack: z.ZodOptional<z.ZodString>;
    logs: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type BugPayload = z.infer<typeof BugPayloadSchema>;
//# sourceMappingURL=bug.d.ts.map