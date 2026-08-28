import { z } from "zod";
export declare const FEEDBACK_SCHEMA_VERSION = "1";
export declare const FeedbackPayloadSchema: z.ZodObject<{
    message: z.ZodString;
    rating: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type FeedbackPayload = z.infer<typeof FeedbackPayloadSchema>;
//# sourceMappingURL=feedback.d.ts.map