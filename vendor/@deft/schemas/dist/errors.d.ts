/** Closed table of error codes -> HTTP status. Exactly 32 entries — no extras. */
export declare const ERROR_CODES: {
    readonly invalid_json: {
        readonly status: 400;
    };
    readonly unsupported_media_type: {
        readonly status: 415;
    };
    readonly payload_too_large: {
        readonly status: 413;
    };
    readonly schema_invalid: {
        readonly status: 400;
    };
    readonly token_missing: {
        readonly status: 403;
    };
    readonly token_mismatch: {
        readonly status: 403;
    };
    readonly unknown_installation: {
        readonly status: 403;
    };
    readonly not_opted_in: {
        readonly status: 403;
    };
    readonly optin_expired: {
        readonly status: 403;
    };
    readonly scope_not_consented: {
        readonly status: 403;
    };
    readonly revoked: {
        readonly status: 403;
    };
    readonly nonce_invalid: {
        readonly status: 403;
    };
    readonly nonce_expired: {
        readonly status: 403;
    };
    readonly nonce_used: {
        readonly status: 409;
    };
    readonly nonce_scope_mismatch: {
        readonly status: 403;
    };
    readonly nonce_install_mismatch: {
        readonly status: 403;
    };
    readonly duplicate: {
        readonly status: 409;
    };
    readonly rate_limited: {
        readonly status: 429;
    };
    readonly quota_exceeded: {
        readonly status: 429;
    };
    readonly too_many_nonces: {
        readonly status: 429;
    };
    readonly scope_disabled: {
        readonly status: 503;
    };
    readonly service_disabled: {
        readonly status: 503;
    };
    readonly denied: {
        readonly status: 403;
    };
    readonly method_not_allowed: {
        readonly status: 405;
    };
    readonly not_found: {
        readonly status: 404;
    };
    readonly internal_error: {
        readonly status: 500;
    };
    readonly already_registered: {
        readonly status: 409;
    };
    readonly https_required: {
        readonly status: 400;
    };
    readonly deployment_invalid: {
        readonly status: 400;
    };
    readonly deployment_mismatch: {
        readonly status: 400;
    };
    readonly correlator_invalid: {
        readonly status: 400;
    };
    readonly correlator_mismatch: {
        readonly status: 400;
    };
};
export type ErrorCode = keyof typeof ERROR_CODES;
//# sourceMappingURL=errors.d.ts.map