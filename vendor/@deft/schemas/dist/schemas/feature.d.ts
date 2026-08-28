import { z } from "zod";
export declare const FEATURE_SCHEMA_VERSION = "1";
export declare const FeaturePayloadSchema: z.ZodObject<{
    summary: z.ZodString;
    details: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type FeaturePayload = z.infer<typeof FeaturePayloadSchema>;
//# sourceMappingURL=feature.d.ts.map