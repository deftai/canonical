// @deft/collection-sdk — the client surface for the collection API (IMPLEMENTATION §3.4,
// SDK-2..SDK-7): `createCollector`, plus the pluggable credential-storage adapters (SDK-3).
//
// This file is imported two ways: as a normal Node module by packages/sdk/test/** (mocked
// `fetch`), and directly inside workerd by packages/server/test/sdk-integration/full-flow.test.ts
// (SDK-6), which wires the real Worker's `SELF.fetch` into `config.fetch`. Nothing this module
// imports at the top level may assume a Node-only global (e.g. `node:fs`) — see
// src/storage/file.ts for how `fileStorage`'s filesystem access is kept lazy so it never runs
// (and is never even resolved) unless a host actually calls it.
export { createCollector, PREFLIGHT_SENTINEL_INSTALL_ID, } from "./collector.js";
export { memoryStorage } from "./storage/memory.js";
export { fileStorage } from "./storage/file.js";
//# sourceMappingURL=index.js.map