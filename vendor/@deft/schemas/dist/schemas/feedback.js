// SUB-5: strict Zod schema for the `feedback` scope payload.
import { z } from "zod";
export const FEEDBACK_SCHEMA_VERSION = "1";
export const FeedbackPayloadSchema = z
    .object({
    message: z.string().min(1).max(5000),
    rating: z.number().int().min(1).max(5).optional(),
})
    .strict();
//# sourceMappingURL=feedback.js.map