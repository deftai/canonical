import type { CredentialStorage } from "./types.js";
/** Each call returns an independent store — two `memoryStorage()` instances never share state
 * (SDK-3). */
export declare function memoryStorage(): CredentialStorage;
//# sourceMappingURL=memory.d.ts.map