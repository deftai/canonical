// WP9b — API-1/API-2/API-4: assembles the OpenAPI 3.1 contract document from three sources
// (IMPLEMENTATION §3.5):
//   (a) the shared Zod scope schemas via Zod 4's native `z.toJSONSchema` (packages/schemas,
//       WP9a) — never a hand-maintained copy of the payload shapes;
//   (b) the route manifest exported by `packages/schemas` (packages/schemas/src/routes.ts);
//   (c) the closed `ERROR_CODES` table (packages/schemas), paired with a human-written
//       description per code.
//
// `buildOpenApiDocument()` is a PURE function: no filesystem access, no network, nothing but
// data already imported at module load. That's what lets the WP9b tests call it directly and
// diff it against the checked-in `packages/sdk/openapi.json`, and what lets
// `scripts/generate-openapi.ts` be a thin wrapper that just writes the result to disk.
import { z } from "zod";
import { ERROR_CODES, ROUTE_MANIFEST, SCOPE_SCHEMAS, } from "@deft/schemas";
const API_TITLE = "Deft Collection API";
const API_VERSION = "1.0.0";
// API-5 (IMPLEMENTATION §3.5, "Auth belongs in the manifest, and `security` is derived from it"):
// the name of the components.securitySchemes entry for the per-installation Installation token.
// Five of the six routes require `Authorization: Bearer <install_token>`; only registration is
// open. This is the ONE place the scheme name is spelled — every operation's `security` is
// derived from ROUTE_MANIFEST's `auth` field, never hand-listed per route.
const INSTALLATION_TOKEN_SCHEME = "InstallationToken";
const SECURITY_SCHEMES = {
    [INSTALLATION_TOKEN_SCHEME]: {
        type: "http",
        scheme: "bearer",
        description: "The per-installation Installation token. Returned exactly once, in the response body of " +
            "POST /v1/registrations, and never retrievable again afterward — it is not an API key and " +
            "is not shared across installations. Losing it means registering a new installation. Send " +
            "it as `Authorization: Bearer <install_token>` on every request except registration itself.",
    },
};
// IMPLEMENTATION §3.1: the Workers Route pattern is `api.<host>/collector/v1/*` per environment;
// local dev has no configured API_BASE_PATH and mounts at the bare root instead.
const SERVERS = [
    { url: "https://api.deft-staging.co/collector", description: "Staging" },
    { url: "http://localhost:8787", description: "Local development (wrangler dev)" },
];
// ---------------------------------------------------------------------------------------------
// Shared building blocks (X-Deft-Deployment header, the error envelope, the closed error
// registry description text).
// ---------------------------------------------------------------------------------------------
function deploymentHeaderParam() {
    return {
        name: "X-Deft-Deployment",
        in: "header",
        required: true,
        description: "The caller's deployment identity, `product:platform:environment:version[:customer]` (DEP-1). " +
            "Required on every request; missing or malformed values are rejected with `deployment_invalid` " +
            "before any per-installation state is touched.",
        schema: { type: "string" },
    };
}
function correlatorHeaderParam() {
    return {
        name: "X-Deft-Correlator",
        in: "header",
        required: false,
        description: "Optional opaque install-cluster correlator (CORR-1..CORR-3). When present on a POST it must " +
            "match the body `correlator` field byte-for-byte; a malformed value is rejected with " +
            "`correlator_invalid` before any per-installation state is touched.",
        schema: { type: "string" },
    };
}
function pathParam(name, description, extra) {
    return {
        name,
        in: "path",
        required: true,
        description,
        schema: { type: "string", ...extra },
    };
}
const ERROR_ENVELOPE_SCHEMA = {
    type: "object",
    description: "The shared error envelope every rejected request returns.",
    properties: {
        error: { type: "string", enum: Object.keys(ERROR_CODES) },
        detail: { type: "string", description: "Optional human-readable elaboration." },
        pointer: { type: "string", description: "Optional JSON-pointer-ish path into the request body, for schema_invalid." },
    },
    required: ["error"],
    additionalProperties: false,
};
// A single reused response object for "some non-success outcome happened" — every operation
// gets this at the `default` status key alongside its real success response. Per-route code
// sets are deliberately not enumerated (IMPLEMENTATION §3.5): many codes apply to several
// routes, and pinning them per-operation would be arbitrary busywork. Completeness of the full
// 32-code table lives in the `x-error-codes` root registry below (API-1's actual obligation).
const ERROR_RESPONSE = {
    description: "The request was rejected. `error` is one of the closed error codes documented in the " +
        "`x-error-codes` root extension of this document, alongside its status and a human-readable " +
        "explanation of the cause and remedy.",
    content: {
        "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
        },
    },
};
// API-1: every one of the 32 closed error codes gets a real, specific description — not the
// code echoed back or trivially reworded. Each explains when a client sees it and what to do.
const ERROR_DESCRIPTIONS = {
    invalid_json: "The request body could not be parsed as JSON. Check for truncated or malformed payload text before resending.",
    unsupported_media_type: "The Content-Type header was missing or was not application/json. Send the body as JSON with that exact content type.",
    payload_too_large: "The request body exceeded the size cap for this scope. Trim the payload (e.g. shorten logs or stack traces) and retry.",
    schema_invalid: "The JSON body did not match the schema this route expects. The pointer field, when present, names the offending key; fix the payload shape and retry.",
    token_missing: "No bearer token was supplied. Include an Authorization header of the form 'Bearer <install_token>'.",
    token_mismatch: "The supplied bearer token does not match this installation's stored token. Re-register to obtain a fresh token.",
    unknown_installation: "The install_id in the request does not correspond to any known installation. Register a new installation before retrying.",
    not_opted_in: "This installation has not completed opt-in for any scope yet. Call the optin endpoint before requesting a challenge or submitting data.",
    optin_expired: "The installation's opt-in window has expired. The client must opt in again before it can submit further data.",
    scope_not_consented: "The installation has opted in, but not for this particular scope. Call optin again including this scope.",
    revoked: "This installation has opted out and can no longer submit data. Register a new installation to resume sending data.",
    nonce_invalid: "The supplied nonce is not recognized for this installation and scope. Request a fresh challenge and retry with its nonce.",
    nonce_expired: "The nonce expired before it was used. Request a fresh challenge and submit promptly afterward.",
    nonce_used: "This nonce has already been consumed by an earlier submission. Request a new challenge for every submission attempt.",
    nonce_scope_mismatch: "The nonce was issued for a different scope than the one being submitted. Request a challenge for the correct scope.",
    nonce_install_mismatch: "The nonce was issued to a different installation than the one presenting it. Use the challenge issued to this installation's token.",
    duplicate: "An event with this exact content was already accepted for this installation and scope. The duplicate was acknowledged but not enqueued again.",
    rate_limited: "The caller has been rate-limited. Back off and retry after the number of seconds in the Retry-After header.",
    quota_exceeded: "This installation's daily submission quota has been used up. Retry after the Retry-After header's duration, once the next UTC day begins.",
    too_many_nonces: "Too many outstanding challenge nonces exist for this installation and scope already. Wait for the Retry-After duration before requesting another.",
    scope_disabled: "This scope has been disabled via the operator kill switch. Submissions for it are rejected until an operator re-enables it.",
    service_disabled: "The entire collection service has been disabled via the global kill switch. All submissions are rejected until an operator re-enables it.",
    denied: "This installation is on the deny list and is blocked from issuing challenges or submitting data. Contact the service operator if this is unexpected.",
    method_not_allowed: "The HTTP method used is not supported on this route. Check the API reference for the correct verb for this path.",
    not_found: "The requested route or scope does not exist. Check the URL path and, for submissions, the scope name for typos.",
    internal_error: "An unexpected server error occurred and the request was not processed. Retry later, or contact support if it keeps happening.",
    already_registered: "A registration already exists for the derived identity. Reuse the existing install_id and install_token instead of registering again.",
    https_required: "The request was made over plain HTTP. Resend the exact same request over HTTPS instead.",
    deployment_invalid: "The X-Deft-Deployment header was missing or did not match the required product:platform:environment:version[:customer] grammar. Fix the header value and retry.",
    deployment_mismatch: "The deployment_id field in the request body did not exactly match the X-Deft-Deployment header. Make sure both carry the identical value.",
    correlator_invalid: "The X-Deft-Correlator header or body correlator field did not match the required lowercase alphanumeric-and-hyphen grammar. Fix the value and retry.",
    correlator_mismatch: "The correlator was present in only one of the header or body, or the two values disagreed. Send identical X-Deft-Correlator and body correlator values, or omit both.",
};
function buildErrorCodeRegistry() {
    const registry = {};
    for (const code of Object.keys(ERROR_CODES)) {
        registry[code] = {
            status: ERROR_CODES[code].status,
            description: ERROR_DESCRIPTIONS[code],
        };
    }
    return registry;
}
function scopeComponentName(scope) {
    return `${scope.charAt(0).toUpperCase()}${scope.slice(1)}Payload`;
}
function buildScopePayloadSchemas() {
    const out = {};
    for (const scope of Object.keys(SCOPE_SCHEMAS)) {
        const zodSchema = SCOPE_SCHEMAS[scope].schema;
        const jsonSchema = z.toJSONSchema(zodSchema);
        // Drop the JSON-Schema dialect pointer: OpenAPI 3.1 fixes the schema dialect once at the
        // document level, so a per-schema `$schema` key is redundant noise here.
        const { $schema: _drop, ...rest } = jsonSchema;
        out[scopeComponentName(scope)] = rest;
    }
    return out;
}
const CORRELATOR_BODY_PROP = {
    type: "string",
    description: "Optional install-cluster correlator (CORR-3). When present must equal the X-Deft-Correlator header byte-for-byte.",
};
/**
 * The POST /v1/submissions/{scope} request body: necessarily a union, since one templated path
 * covers three scopes (IMPLEMENTATION §3.5). Exactly one union member per scope, and each
 * member is the accurate, real wire shape — `{install_id, nonce, deployment_id, payload}`, where
 * `payload` is a `$ref` to that scope's own Zod-derived component schema. This is what a real
 * client actually sends and what Swagger UI/Postman render for try-it-out (API-3/API-4): the
 * spec must never advertise a body shape the server would reject, so no bare/unenveloped scope
 * schema is offered as a sibling alternative here (orchestrator ruling, IMPLEMENTATION §3.5 —
 * "where a test helper can't reach a schema, fix the helper, not the deliverable"; QA's
 * `collectPropertySchemas` now descends into `properties` values generically, so the enveloped
 * shape alone is sufficient for contract-parity verification without ever hand-copying the
 * scope's property list into a second, drift-prone place).
 */
function buildSubmissionsRequestBodySchema() {
    const scopes = Object.keys(SCOPE_SCHEMAS);
    const envelopeVariants = scopes.map((scope) => ({
        title: `${scope} submission`,
        type: "object",
        properties: {
            install_id: { type: "string", minLength: 1 },
            nonce: { type: "string", minLength: 1 },
            deployment_id: { type: "string", minLength: 1 },
            correlator: CORRELATOR_BODY_PROP,
            payload: { $ref: `#/components/schemas/${scopeComponentName(scope)}` },
        },
        required: ["install_id", "nonce", "deployment_id", "payload"],
        additionalProperties: false,
    }));
    return { oneOf: envelopeVariants };
}
// ---------------------------------------------------------------------------------------------
// Per-route response body schemas (hand-described: these bodies aren't shared Zod schemas —
// only the submissions payload is, per IMPLEMENTATION §3.5 — but they must still match what the
// route handlers actually return, see packages/server/src/routes/*.ts).
// ---------------------------------------------------------------------------------------------
const REGISTER_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        install_id: { type: "string" },
        install_token: { type: "string" },
        state: { type: "string", enum: ["pending"] },
    },
    required: ["install_id", "install_token", "state"],
};
const OPTIN_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        state: { type: "string", enum: ["active"] },
        scopes: { type: "array", items: { type: "string" } },
        expires_at: { type: "integer", description: "Epoch milliseconds." },
        contact_verified: { type: "boolean" },
    },
    required: ["state", "scopes", "expires_at", "contact_verified"],
};
const OPTOUT_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        state: { type: "string", enum: ["revoked"] },
    },
    required: ["state"],
};
const STATUS_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        state: { type: "string" },
        scopes: { type: "array", items: { type: "string" } },
        expires_at: { type: ["integer", "null"], description: "Epoch milliseconds, or null if never opted in." },
        consent_version: { type: ["string", "null"] },
        contact_verified: { type: "boolean" },
    },
    required: ["state", "scopes", "expires_at", "consent_version", "contact_verified"],
};
const CHALLENGE_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        nonce: { type: "string" },
        ttl_seconds: { type: "integer" },
    },
    required: ["nonce", "ttl_seconds"],
};
const SUBMISSIONS_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        id: { type: "string", description: "Server-minted event id." },
        deduplicated: { type: "boolean", description: "True when this exact payload was already accepted before." },
    },
    required: ["id"],
};
// ---------------------------------------------------------------------------------------------
// Per-route request body schemas (hand-described from packages/server/src/routes/*.ts's local
// Zod schemas — these bodies have no shared-package counterpart to derive from).
// ---------------------------------------------------------------------------------------------
const REGISTER_REQUEST_SCHEMA = {
    type: "object",
    properties: {
        deployment_id: { type: "string", minLength: 1 },
        correlator: CORRELATOR_BODY_PROP,
    },
    required: ["deployment_id"],
    additionalProperties: false,
};
const CONTACT_SCHEMA = {
    type: "object",
    properties: {
        email: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        sms: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
};
const OPTIN_REQUEST_SCHEMA = {
    type: "object",
    properties: {
        scopes: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
        consent_version: { type: "string", minLength: 1 },
        contact: CONTACT_SCHEMA,
        deployment_id: { type: "string", minLength: 1 },
        correlator: CORRELATOR_BODY_PROP,
    },
    required: ["scopes", "consent_version", "deployment_id"],
    additionalProperties: false,
};
const OPTOUT_REQUEST_SCHEMA = {
    type: "object",
    properties: {
        deployment_id: { type: "string", minLength: 1 },
        correlator: CORRELATOR_BODY_PROP,
    },
    required: ["deployment_id"],
    additionalProperties: false,
};
const CHALLENGE_REQUEST_SCHEMA = {
    type: "object",
    properties: {
        install_id: { type: "string", minLength: 1 },
        scope: { type: "string", minLength: 1 },
        deployment_id: { type: "string", minLength: 1 },
        correlator: CORRELATOR_BODY_PROP,
    },
    required: ["install_id", "scope", "deployment_id"],
    additionalProperties: false,
};
// API-5: per-operation `security`, derived from ROUTE_MANIFEST's `auth` field — never a
// hand-maintained parallel list. `"none"` gets an EXPLICIT empty array (deliberately open, not
// "undocumented"); `"bearer"` gets `[{ <scheme>: [] }]`. Preferring explicit per-operation
// `security` over a root-level default + per-route overrides is deliberate, per IMPLEMENTATION
// §3.5, so parity tests can assert it directly on each operation.
function securityFor(auth) {
    if (auth === "none")
        return [];
    return [{ [INSTALLATION_TOKEN_SCHEME]: [] }];
}
function buildOperation(spec, auth) {
    const parameters = [
        deploymentHeaderParam(),
        correlatorHeaderParam(),
        ...(spec.extraParams ?? []),
    ];
    const operation = {
        operationId: spec.operationId,
        summary: spec.summary,
        // Present-and-empty vs. absent matters (API-5): an omitted key means "undocumented" to a
        // generator, an empty array means "deliberately open". Always assign it explicitly.
        security: securityFor(auth),
        parameters,
        responses: {
            [String(spec.successStatus)]: {
                description: spec.summary,
                content: {
                    "application/json": { schema: spec.successSchema },
                },
            },
            default: ERROR_RESPONSE,
        },
    };
    if (spec.requestSchema) {
        operation.requestBody = {
            required: true,
            content: {
                "application/json": { schema: spec.requestSchema },
            },
        };
    }
    return operation;
}
function operationSpecs() {
    return [
        {
            route: { method: "POST", path: "/v1/registrations" },
            operationId: "createRegistration",
            summary: "Register a new installation and receive its install token.",
            successStatus: 201,
            successSchema: REGISTER_RESPONSE_SCHEMA,
            requestSchema: REGISTER_REQUEST_SCHEMA,
        },
        {
            route: { method: "POST", path: "/v1/registrations/{id}/optin" },
            operationId: "optInRegistration",
            summary: "Opt an installation in to one or more data-collection scopes.",
            successStatus: 200,
            successSchema: OPTIN_RESPONSE_SCHEMA,
            requestSchema: OPTIN_REQUEST_SCHEMA,
            extraParams: [pathParam("id", "The installation id returned at registration.")],
        },
        {
            route: { method: "POST", path: "/v1/registrations/{id}/optout" },
            operationId: "optOutRegistration",
            summary: "Opt an installation out of data collection, revoking its token.",
            successStatus: 200,
            successSchema: OPTOUT_RESPONSE_SCHEMA,
            requestSchema: OPTOUT_REQUEST_SCHEMA,
            extraParams: [pathParam("id", "The installation id returned at registration.")],
        },
        {
            route: { method: "GET", path: "/v1/registrations/{id}/status" },
            operationId: "getRegistrationStatus",
            summary: "Read an installation's current opt-in state (no side effects).",
            successStatus: 200,
            successSchema: STATUS_RESPONSE_SCHEMA,
            extraParams: [pathParam("id", "The installation id returned at registration.")],
        },
        {
            route: { method: "POST", path: "/v1/challenge" },
            operationId: "createChallenge",
            summary: "Request a single-use nonce, scoped to one installation and scope.",
            successStatus: 200,
            successSchema: CHALLENGE_RESPONSE_SCHEMA,
            requestSchema: CHALLENGE_REQUEST_SCHEMA,
        },
        {
            route: { method: "POST", path: "/v1/submissions/{scope}", scopeParam: true },
            operationId: "createSubmission",
            summary: "Submit one event's payload for a scope, consuming a previously issued nonce.",
            successStatus: 202,
            successSchema: SUBMISSIONS_RESPONSE_SCHEMA,
            requestSchema: buildSubmissionsRequestBodySchema(),
            extraParams: [
                pathParam("scope", "The submission scope.", { enum: Object.keys(SCOPE_SCHEMAS) }),
            ],
        },
    ];
}
/**
 * Assembles the full OpenAPI 3.1 document. Pure: reads only already-imported module-level data
 * (ROUTE_MANIFEST, SCOPE_SCHEMAS, ERROR_CODES) — no filesystem, no network — so both the test
 * suite and `scripts/generate-openapi.ts` can call it directly.
 */
export function buildOpenApiDocument() {
    const specs = operationSpecs();
    // ROUTE_MANIFEST is the actual source of truth for *what routes exist*; specs above supply the
    // documentation detail for each. Building `paths` by walking ROUTE_MANIFEST (rather than just
    // the specs list) means an undocumented manifest addition fails loudly (no spec found) instead
    // of silently producing a spec that's missing a route.
    const paths = {};
    for (const route of ROUTE_MANIFEST) {
        const spec = specs.find((s) => s.route.method === route.method && s.route.path === route.path);
        if (!spec) {
            throw new Error(`No OpenAPI operation spec defined for ${route.method} ${route.path}`);
        }
        const pathItem = (paths[route.path] ??= {});
        pathItem[route.method.toLowerCase()] = buildOperation(spec, route.auth);
    }
    return {
        openapi: "3.1.0",
        info: {
            title: API_TITLE,
            version: API_VERSION,
            description: "The Deft collection endpoint: per-installation registration/opt-in/opt-out, single-use " +
                "challenge nonces, and scoped event submission.",
        },
        servers: SERVERS,
        paths,
        components: {
            schemas: {
                ErrorEnvelope: ERROR_ENVELOPE_SCHEMA,
                ...buildScopePayloadSchemas(),
            },
            securitySchemes: SECURITY_SCHEMES,
        },
        "x-error-codes": buildErrorCodeRegistry(),
    };
}
//# sourceMappingURL=generate.js.map