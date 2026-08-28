// Registry mapping each known scope to its strict Zod payload schema and schema version
// (DATA-5: adding a scope requires only a schema + routing rule + config entry — no protocol
// change). `POST /v1/submissions/:scope` looks up this table; a scope not present here is a
// 404 `not_found` at the route boundary (IMPLEMENTATION §1.1).
import { BUG_SCHEMA_VERSION, BugPayloadSchema } from "./bug.js";
import { FEATURE_SCHEMA_VERSION, FeaturePayloadSchema } from "./feature.js";
import { FEEDBACK_SCHEMA_VERSION, FeedbackPayloadSchema } from "./feedback.js";
import { USAGE_SCHEMA_VERSION, UsagePayloadSchema } from "./usage.js";
export const SCOPE_SCHEMAS = {
    feedback: { schema: FeedbackPayloadSchema, version: FEEDBACK_SCHEMA_VERSION },
    bug: { schema: BugPayloadSchema, version: BUG_SCHEMA_VERSION },
    feature: { schema: FeaturePayloadSchema, version: FEATURE_SCHEMA_VERSION },
    usage: { schema: UsagePayloadSchema, version: USAGE_SCHEMA_VERSION },
};
export function isKnownScope(scope) {
    return Object.prototype.hasOwnProperty.call(SCOPE_SCHEMAS, scope);
}
export { BugPayloadSchema, FeaturePayloadSchema, FeedbackPayloadSchema, UsagePayloadSchema, };
//# sourceMappingURL=index.js.map