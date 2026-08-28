// GEN-5: stable machine-readable error codes shared by the Worker and the SDK.
//
// WP9a: split out of `packages/server/src/lib/errors.ts` (IMPL §3.2/§3.3). Only the closed
// code table and its type travel into this shared package — the `Request`/`Response`-building
// helpers (`errorResponse`, `errorBody`, `requireJsonContentType`, `maxBodyBytesFor`,
// `readBodyWithLimit`) are server-only and stay in `packages/server/src/lib/errors.ts`, which
// re-exports this table under the same name it always has.
/** Closed table of error codes -> HTTP status. Exactly 32 entries — no extras. */
export const ERROR_CODES = {
    invalid_json: { status: 400 },
    unsupported_media_type: { status: 415 },
    payload_too_large: { status: 413 },
    schema_invalid: { status: 400 },
    token_missing: { status: 403 },
    token_mismatch: { status: 403 },
    unknown_installation: { status: 403 },
    not_opted_in: { status: 403 },
    optin_expired: { status: 403 },
    scope_not_consented: { status: 403 },
    revoked: { status: 403 },
    nonce_invalid: { status: 403 },
    nonce_expired: { status: 403 },
    nonce_used: { status: 409 },
    nonce_scope_mismatch: { status: 403 },
    nonce_install_mismatch: { status: 403 },
    duplicate: { status: 409 },
    rate_limited: { status: 429 },
    quota_exceeded: { status: 429 },
    too_many_nonces: { status: 429 },
    scope_disabled: { status: 503 },
    service_disabled: { status: 503 },
    denied: { status: 403 },
    method_not_allowed: { status: 405 },
    not_found: { status: 404 },
    internal_error: { status: 500 },
    already_registered: { status: 409 },
    https_required: { status: 400 },
    // DEP-8: two new codes for the deployment-identity wire contract. Both 400.
    deployment_invalid: { status: 400 },
    deployment_mismatch: { status: 400 },
    // CORR-5: two new codes for the correlator wire contract. Both 400. Table 30 → 32.
    correlator_invalid: { status: 400 },
    correlator_mismatch: { status: 400 },
};
//# sourceMappingURL=errors.js.map