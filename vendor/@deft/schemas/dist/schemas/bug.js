// SUB-5: strict Zod schema for the `bug` scope payload. GEN-7 allows this scope a larger
// body cap (100KB, IMPLEMENTATION §1.4) so `stack`/`logs` can carry meaningful diagnostics.
// `logs`'s bound (99_000) is kept just under the 100,000-byte body cap — leaving headroom for
// `summary`/`os`/JSON-wrapper overhead (~140 bytes at minimum) — so the schema can't describe a
// payload the body-size check would reject first, while still admitting a payload right at the
// cap (see the GEN-7 "at the cap" regression test in test/http/general.test.ts).
import { z } from "zod";
export const BUG_SCHEMA_VERSION = "1";
export const BugPayloadSchema = z
    .object({
    summary: z.string().min(1).max(300),
    os: z.string().min(1).max(100),
    stack: z.string().max(20000).optional(),
    logs: z.string().max(99_000).optional(),
})
    .strict();
//# sourceMappingURL=bug.js.map