// SDK-3: an in-memory CredentialStorage adapter. Used by the SDK's own unit tests (no real
// filesystem or network) and available to any host that wants ephemeral, process-local
// credential storage.
/** Each call returns an independent store — two `memoryStorage()` instances never share state
 * (SDK-3). */
export function memoryStorage() {
    let current = null;
    return {
        async load() {
            return current;
        },
        async save(creds) {
            current = creds;
        },
        async clear() {
            current = null;
        },
    };
}
//# sourceMappingURL=memory.js.map