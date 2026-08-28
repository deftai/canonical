// WP9b (API-1, API-2), moved to packages/schemas at WP11a (IMPLEMENTATION §3.5, orchestrator
// decision "The route manifest lives in packages/schemas, not packages/server"): the fixed list
// of routes this Worker serves, in OpenAPI path-template form. This is the ONE source of truth
// `packages/sdk/src/openapi/generate.ts` reads to build the `paths` section of the OpenAPI
// document, and what the WP9b parity tests diff against an independent ground truth
// (`packages/sdk/test/openapi/helpers.ts` EXPECTED_ROUTES) in both directions — so this file must
// describe reality, not just agree with itself.
//
// This module is data-only (no imports) and shared server/client contract data — the manifest was
// originally placed in packages/server as "a manifest exported by the Worker", but no server code
// ever imported it; its only consumers are the SDK's OpenAPI generator and its parity test. That
// cross-package relative import forced `rootDir: ".."` in packages/sdk/tsconfig.build.json, which
// emitted a compiled copy of the server file into the published SDK bundle — a live SDK-7
// violation. Living here instead means the SDK depends on it the same way it depends on every
// other piece of shared wire grammar: through `@deft/schemas`, not a reach across a package
// boundary.
export const ROUTE_MANIFEST = [
    { method: "POST", path: "/v1/registrations", auth: "none" },
    { method: "POST", path: "/v1/registrations/{id}/optin", auth: "bearer" },
    { method: "POST", path: "/v1/registrations/{id}/optout", auth: "bearer" },
    { method: "GET", path: "/v1/registrations/{id}/status", auth: "bearer" },
    { method: "POST", path: "/v1/challenge", auth: "bearer" },
    { method: "POST", path: "/v1/submissions/{scope}", scopeParam: true, auth: "bearer" },
];
//# sourceMappingURL=routes.js.map