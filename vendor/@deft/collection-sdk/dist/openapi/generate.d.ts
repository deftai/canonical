/**
 * Assembles the full OpenAPI 3.1 document. Pure: reads only already-imported module-level data
 * (ROUTE_MANIFEST, SCOPE_SCHEMAS, ERROR_CODES) — no filesystem, no network — so both the test
 * suite and `scripts/generate-openapi.ts` can call it directly.
 */
export declare function buildOpenApiDocument(): object;
//# sourceMappingURL=generate.d.ts.map