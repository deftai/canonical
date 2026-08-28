// DEP-1: the deployment-ID grammar. A deployment ID identifies what is talking to the Service —
// `product:platform:environment:version` with an optional 5th `:customer` segment. Parsing is
// strict: anything outside the grammar below is malformed, full stop (no normalization, no
// trimming — a whitespace-padded value is invalid, not silently cleaned up).
//
// Segment charsets (REQUIREMENTS §13, DEP-1):
//   product/platform/environment = ^[a-z0-9][a-z0-9-]{0,31}$   (max 32 chars)
//   version                      = ^[A-Za-z0-9._-]{1,64}$      (colons impossible by charset)
//   customer (optional 5th)      = ^[a-z0-9][a-z0-9-]{0,63}$   (max 64 chars)
//   total raw length <= 200
//
// WP9a: moved here from `packages/server/src/lib/deployment.ts` (IMPL §3.2/§3.3) so the Worker
// and the SDK share one grammar. The old path re-exports this module as a thin shim.
const MAX_RAW_LENGTH = 200;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,64}$/;
const CUSTOMER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Strict parse of a deployment ID per DEP-1. No trimming or normalization — the raw string is
 * matched exactly against the grammar. */
export function parseDeploymentId(raw) {
    if (raw.length === 0 || raw.length > MAX_RAW_LENGTH) {
        return { ok: false, reason: "deployment id length must be between 1 and 200 characters" };
    }
    const segments = raw.split(":");
    if (segments.length !== 4 && segments.length !== 5) {
        return { ok: false, reason: "deployment id must have exactly 4 or 5 colon-separated segments" };
    }
    const [product, platform, environment, version, customer] = segments;
    if (!NAME_RE.test(product)) {
        return { ok: false, reason: "product segment is malformed" };
    }
    if (!NAME_RE.test(platform)) {
        return { ok: false, reason: "platform segment is malformed" };
    }
    if (!NAME_RE.test(environment)) {
        return { ok: false, reason: "environment segment is malformed" };
    }
    if (!VERSION_RE.test(version)) {
        return { ok: false, reason: "version segment is malformed" };
    }
    if (customer !== undefined && !CUSTOMER_RE.test(customer)) {
        return { ok: false, reason: "customer segment is malformed" };
    }
    return {
        ok: true,
        id: { product, platform, environment, version, customer, raw },
    };
}
//# sourceMappingURL=deployment.js.map