// SDK-2..SDK-6: the client collector. Wraps the full protocol (register, opt-in, opt-out,
// status, and a one-call `submit`) per IMPLEMENTATION §3.4 / §1.9. Every method returns a typed
// `{ok:true, ...} | {ok:false, code, retryable}` result and never throws for an expected
// rejection (SDK-4) — the only two SDK-internal codes are `"transport_error"` and
// `"invalid_response"` (pinned at WP10 G1, IMPLEMENTATION §3.4 "Three `Result` details pinned"),
// which are deliberately NOT added to the server's closed `ERROR_CODES` table since they
// describe failures that never reached the server (or a response it would never have sent).
// ---------------------------------------------------------------------------------------
// Deployment id (SDK-5, DEP-1): built from structured config fields — consumers never
// construct the colon-joined string themselves. `@deft/schemas`'s `parseDeploymentId` defines
// the grammar this must satisfy; this is the (trivial) inverse of that parse, not a
// reimplementation of it.
// ---------------------------------------------------------------------------------------
function buildDeploymentId(deployment) {
    const base = `${deployment.product}:${deployment.platform}:${deployment.environment}:${deployment.version}`;
    return deployment.customer !== undefined ? `${base}:${deployment.customer}` : base;
}
// ---------------------------------------------------------------------------------------
// Small typed-read helpers for pulling expected fields out of an unknown, parsed JSON body.
// ---------------------------------------------------------------------------------------
function readString(body, key) {
    if (body === null || typeof body !== "object")
        return undefined;
    const value = body[key];
    return typeof value === "string" ? value : undefined;
}
function readNumber(body, key) {
    if (body === null || typeof body !== "object")
        return undefined;
    const value = body[key];
    return typeof value === "number" ? value : undefined;
}
function readStringArray(body, key) {
    if (body === null || typeof body !== "object")
        return undefined;
    const value = body[key];
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        return value;
    }
    return undefined;
}
function isNonceCode(code) {
    return code.startsWith("nonce_");
}
/** Shared retryable rule (IMPLEMENTATION §3.4): 429 and 5xx are retryable, everything else is a
 * definite rejection a byte-identical retry cannot fix. */
function isRetryableStatus(status) {
    return status === 429 || status >= 500;
}
const INVALID_RESPONSE = { ok: false, code: "invalid_response", retryable: true };
const TRANSPORT_ERROR = { ok: false, code: "transport_error", retryable: true };
const STORAGE_ERROR = { ok: false, code: "storage_error", retryable: false };
const NOT_REGISTERED = { ok: false, code: "not_registered", retryable: false };
/** SDK-8 (IMPLEMENTATION §3.4, "The SDK-8 pre-flight probe must use a reserved sentinel"):
 * reserved `installId` for the pre-flight probe record — a value the server can never mint,
 * since real install ids are UUIDv4 and this is deliberately not UUID-shaped. The probe has to
 * go through the (pluggable) storage adapter's real `save()`/`clear()`, so if the process dies
 * between those two calls, a well-formed-but-fake record bearing this sentinel can be left
 * behind. Every consumer of `storage.load()` (`ensureCreds`, `ensureRegistered`) MUST treat a
 * record whose `installId` equals this sentinel as "no credentials", so a crashed probe
 * self-heals on the next call instead of permanently locking the SDK into `unknown_installation`
 * failures against a fake installation. Exported so tests can assert against the same value
 * rather than a duplicated literal. */
export const PREFLIGHT_SENTINEL_INSTALL_ID = "sdk-preflight-probe:not-a-real-install-id";
/** The probe record itself: written and then immediately removed to test storage writability
 * (SDK-8) without disturbing any real credentials — this only runs on the path where
 * `storage.load()` has already reported no (real) existing credentials, so there is nothing
 * legitimate to clobber. */
const PREFLIGHT_PROBE = {
    installId: PREFLIGHT_SENTINEL_INSTALL_ID,
    token: "sdk-preflight-probe:not-a-real-token",
};
/** True when a record loaded from storage is actually just a crashed probe's leftovers, not a
 * real installation (see `PREFLIGHT_SENTINEL_INSTALL_ID` above). */
function isPreflightSentinel(creds) {
    return creds.installId === PREFLIGHT_SENTINEL_INSTALL_ID;
}
export function createCollector(config) {
    const { baseUrl, deployment, storage, correlator } = config;
    const fetchImpl = config.fetch ?? fetch;
    const autoRegister = config.autoRegister ?? true;
    async function rawRequest(method, path, opts) {
        const deploymentId = buildDeploymentId(deployment);
        const headers = { "x-deft-deployment": deploymentId };
        if (correlator !== undefined) {
            headers["x-deft-correlator"] = correlator;
        }
        let requestBody;
        if (opts.bodyObj !== undefined) {
            headers["content-type"] = "application/json";
            const body = { ...opts.bodyObj, deployment_id: deploymentId };
            if (correlator !== undefined) {
                body.correlator = correlator;
            }
            requestBody = JSON.stringify(body);
        }
        if (opts.token !== undefined) {
            headers["authorization"] = `Bearer ${opts.token}`;
        }
        let response;
        try {
            response = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: requestBody });
        }
        catch {
            return TRANSPORT_ERROR;
        }
        let text;
        try {
            text = await response.text();
        }
        catch {
            return TRANSPORT_ERROR;
        }
        let json;
        if (text.length === 0) {
            json = undefined;
        }
        else {
            try {
                json = JSON.parse(text);
            }
            catch {
                // Derived from the HTTP status, not hardcoded (IMPLEMENTATION §3.4 amendment): a
                // non-JSON body still carries a real status, and the load-bearing case is a Cloudflare
                // WAF `block` action returning a non-JSON 403 for the registration rate limit — that
                // must come back non-retryable, not invite the very retry the limit exists to punish.
                return { ok: false, code: "invalid_response", retryable: isRetryableStatus(response.status) };
            }
        }
        if (response.status >= 200 && response.status < 300) {
            return { ok: true, body: json };
        }
        const code = readString(json, "error");
        if (!code)
            return INVALID_RESPONSE;
        const retryable = isRetryableStatus(response.status);
        if (response.status === 429) {
            const header = response.headers.get("retry-after");
            if (header !== null) {
                const seconds = Number(header);
                if (Number.isFinite(seconds)) {
                    return { ok: false, code: code, retryable, retryAfterSeconds: seconds };
                }
            }
        }
        return { ok: false, code: code, retryable };
    }
    // -------------------------------------------------------------------------------------
    // Registration / credential bootstrapping
    // -------------------------------------------------------------------------------------
    /** SDK-8: a real create-then-remove probe through the storage adapter (not a type check) — the
     * common case (storage plainly cannot write) must be caught here, before a once-only,
     * never-retrievable install token is requested from the server at all. */
    async function probeStorageWritable() {
        try {
            await storage.save(PREFLIGHT_PROBE);
            await storage.clear();
            return true;
        }
        catch {
            return false;
        }
    }
    async function doRegister() {
        if (!(await probeStorageWritable()))
            return STORAGE_ERROR;
        const raw = await rawRequest("POST", "/v1/registrations", { bodyObj: {} });
        if (!raw.ok)
            return raw;
        const installId = readString(raw.body, "install_id");
        const token = readString(raw.body, "install_token");
        const state = readString(raw.body, "state");
        if (!installId || !token || !state)
            return INVALID_RESPONSE;
        try {
            await storage.save({ installId, token });
        }
        catch {
            // The pre-flight probe passed but the real save still failed (e.g. disk filled between the
            // two calls) — still a storage failure, not a transport one; the network call already
            // succeeded and minted a token that is now stranded.
            return STORAGE_ERROR;
        }
        return { ok: true, installId, token, state };
    }
    /** Loads stored credentials, registering a brand-new installation only when storage is empty
     * (SDK-3) — the shared "ensure token" step `submit`/`optIn`/`optOut`/`status` all rely on.
     * SDK-9: when `autoRegister` is `false` and storage holds nothing, this must not register —
     * it reports `not_registered` instead, since none of the transport/response/storage codes
     * honestly describe "the caller opted out of implicit registration". */
    async function ensureCreds() {
        const existing = await storage.load();
        // A record bearing the pre-flight sentinel is a crashed probe's leftovers, not a real
        // installation (IMPLEMENTATION §3.4) — treat it exactly like "no credentials" so the SDK
        // self-heals by registering for real, rather than handing a fake install id/token to every
        // subsequent call forever.
        if (existing && !isPreflightSentinel(existing))
            return { ok: true, ...existing };
        if (!autoRegister)
            return NOT_REGISTERED;
        const registered = await doRegister();
        if (!registered.ok)
            return registered;
        return { ok: true, installId: registered.installId, token: registered.token };
    }
    async function ensureRegistered() {
        try {
            const existing = await storage.load();
            if (existing && !isPreflightSentinel(existing)) {
                // Credentials are already stored; per SDK-3 this path must never touch the network. The
                // server-side state isn't known without a call, so it's reported as "unknown" rather
                // than guessed.
                return { ok: true, installId: existing.installId, state: "unknown" };
            }
            const registered = await doRegister();
            if (!registered.ok)
                return registered;
            return { ok: true, installId: registered.installId, state: registered.state };
        }
        catch {
            return TRANSPORT_ERROR;
        }
    }
    // -------------------------------------------------------------------------------------
    // optIn / optOut / status
    // -------------------------------------------------------------------------------------
    async function optIn(args) {
        try {
            const creds = await ensureCreds();
            if (!creds.ok)
                return creds;
            const raw = await rawRequest("POST", `/v1/registrations/${creds.installId}/optin`, {
                token: creds.token,
                bodyObj: {
                    scopes: args.scopes,
                    consent_version: args.consentVersion,
                    contact: args.contact,
                },
            });
            if (!raw.ok)
                return raw;
            const state = readString(raw.body, "state");
            const scopes = readStringArray(raw.body, "scopes");
            const expiresAt = readNumber(raw.body, "expires_at");
            if (!state || !scopes || expiresAt === undefined)
                return INVALID_RESPONSE;
            return { ok: true, state, scopes, expiresAt };
        }
        catch {
            return TRANSPORT_ERROR;
        }
    }
    async function optOut() {
        try {
            const creds = await ensureCreds();
            if (!creds.ok)
                return creds;
            const raw = await rawRequest("POST", `/v1/registrations/${creds.installId}/optout`, {
                token: creds.token,
                bodyObj: {},
            });
            if (!raw.ok)
                return raw;
            const state = readString(raw.body, "state");
            if (!state)
                return INVALID_RESPONSE;
            // Clear only on success (SDK-3) — a rejected opt-out leaves the stored credentials
            // untouched so the caller can retry with the same install id/token.
            await storage.clear();
            return { ok: true, state };
        }
        catch {
            return TRANSPORT_ERROR;
        }
    }
    async function status() {
        try {
            const creds = await ensureCreds();
            if (!creds.ok)
                return creds;
            const raw = await rawRequest("GET", `/v1/registrations/${creds.installId}/status`, {
                token: creds.token,
            });
            if (!raw.ok)
                return raw;
            const state = readString(raw.body, "state");
            const scopes = readStringArray(raw.body, "scopes");
            if (!state || !scopes)
                return INVALID_RESPONSE;
            const expiresAt = readNumber(raw.body, "expires_at");
            const consentVersion = readString(raw.body, "consent_version");
            return {
                ok: true,
                state,
                scopes,
                ...(expiresAt !== undefined ? { expiresAt } : {}),
                ...(consentVersion !== undefined ? { consentVersion } : {}),
            };
        }
        catch {
            return TRANSPORT_ERROR;
        }
    }
    // -------------------------------------------------------------------------------------
    // submit: ensure token -> challenge -> submit, one fresh-challenge retry on nonce_* errors
    // (SDK-2, IMPLEMENTATION §1.9).
    // -------------------------------------------------------------------------------------
    async function submit(scope, payload) {
        try {
            const creds = await ensureCreds();
            if (!creds.ok)
                return creds;
            const getChallenge = async () => {
                const raw = await rawRequest("POST", "/v1/challenge", {
                    token: creds.token,
                    bodyObj: { install_id: creds.installId, scope },
                });
                if (!raw.ok)
                    return raw;
                const nonce = readString(raw.body, "nonce");
                if (!nonce)
                    return INVALID_RESPONSE;
                return { ok: true, nonce };
            };
            const trySubmit = async (nonce) => rawRequest("POST", `/v1/submissions/${scope}`, {
                token: creds.token,
                bodyObj: { install_id: creds.installId, nonce, payload },
            });
            const toSubmitResult = (raw) => {
                const id = readString(raw.body, "id");
                if (!id)
                    return INVALID_RESPONSE;
                const deduplicated = raw.body?.["deduplicated"] === true;
                return deduplicated ? { ok: true, id, deduplicated: true } : { ok: true, id };
            };
            let challenge = await getChallenge();
            if (!challenge.ok)
                return challenge;
            let result = await trySubmit(challenge.nonce);
            if (result.ok)
                return toSubmitResult(result);
            // A single fresh-challenge retry, only for nonce_* rejections — every other failure
            // (quota_exceeded, deployment_invalid, not_opted_in, ...) is surfaced immediately without
            // a second attempt.
            if (isNonceCode(result.code)) {
                challenge = await getChallenge();
                if (!challenge.ok)
                    return challenge;
                result = await trySubmit(challenge.nonce);
                if (result.ok)
                    return toSubmitResult(result);
                return result;
            }
            return result;
        }
        catch {
            return TRANSPORT_ERROR;
        }
    }
    return { ensureRegistered, optIn, optOut, status, submit };
}
//# sourceMappingURL=collector.js.map