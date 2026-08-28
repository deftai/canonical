export interface RouteManifestEntry {
    method: "GET" | "POST";
    path: string;
    /** True for the one templated path whose final segment is a scope name, not a resource id. */
    scopeParam?: boolean;
    /**
     * Auth-ness is a server fact, not documentation trivia (IMPLEMENTATION §3.5, "Auth belongs in
     * the manifest, and `security` is derived from it"): "bearer" means the route requires
     * `Authorization: Bearer <install_token>`, "none" means it is deliberately open. The OpenAPI
     * generator derives each operation's `security` from this field rather than hand-maintaining a
     * parallel list.
     */
    auth: "bearer" | "none";
}
export declare const ROUTE_MANIFEST: ReadonlyArray<RouteManifestEntry>;
//# sourceMappingURL=routes.d.ts.map