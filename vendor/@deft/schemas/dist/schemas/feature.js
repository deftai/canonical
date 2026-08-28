// SUB-5: strict Zod schema for the `feature` scope payload (feature / enhancement requests).
// Routed to GitHub like `bug`, with issue type Feature and label enhancement.
import { z } from "zod";
export const FEATURE_SCHEMA_VERSION = "1";
export const FeaturePayloadSchema = z
    .object({
    summary: z.string().min(1).max(300),
    details: z.string().max(20_000).optional(),
    // Optional product surface context (mirrors bug's os field as free-form context).
    context: z.string().min(1).max(200).optional(),
})
    .strict();
//# sourceMappingURL=feature.js.map