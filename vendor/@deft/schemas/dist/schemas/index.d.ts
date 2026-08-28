import type { z } from "zod";
import { BugPayloadSchema } from "./bug.js";
import { FeaturePayloadSchema } from "./feature.js";
import { FeedbackPayloadSchema } from "./feedback.js";
import { UsagePayloadSchema } from "./usage.js";
export declare const SCOPE_SCHEMAS: {
    feedback: {
        schema: z.ZodObject<{
            message: z.ZodString;
            rating: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        version: string;
    };
    bug: {
        schema: z.ZodObject<{
            summary: z.ZodString;
            os: z.ZodString;
            stack: z.ZodOptional<z.ZodString>;
            logs: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        version: string;
    };
    feature: {
        schema: z.ZodObject<{
            summary: z.ZodString;
            details: z.ZodOptional<z.ZodString>;
            context: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        version: string;
    };
    usage: {
        schema: z.ZodObject<{
            metric: z.ZodString;
            value: z.ZodNumber;
            period: z.ZodOptional<z.ZodString>;
            dimensions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
        }, z.core.$strict>;
        version: string;
    };
};
export type KnownScope = keyof typeof SCOPE_SCHEMAS;
export declare function isKnownScope(scope: string): scope is KnownScope;
export { BugPayloadSchema, FeaturePayloadSchema, FeedbackPayloadSchema, UsagePayloadSchema, };
//# sourceMappingURL=index.d.ts.map