// CORR-1: correlator grammar. Opaque client-minted install-cluster id —
// `^[a-z0-9][a-z0-9-]{0,63}$` (same charset/length as DEP-1 `customer`). Parsing is strict:
// no structure beyond the grammar, no trimming/normalization.
const CORRELATOR_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Strict parse of a correlator per CORR-1. No trimming or normalization. */
export function parseCorrelator(raw) {
    if (!CORRELATOR_RE.test(raw)) {
        return { ok: false, reason: "correlator is malformed" };
    }
    return { ok: true, value: raw };
}
//# sourceMappingURL=correlator.js.map