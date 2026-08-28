import type { ErrorCode } from "@deft/schemas";
import type { CredentialStorage } from "./storage/types.js";
export interface DeploymentConfig {
    product: string;
    platform: string;
    environment: string;
    version: string;
    customer?: string;
}
export interface CollectorConfig {
    baseUrl: string;
    deployment: DeploymentConfig;
    storage: CredentialStorage;
    /** Defaults to the ambient global `fetch` (Node >= 18 or a Workers runtime); tests and the
     * SDK-6 integration suite pass their own (a mock, or `SELF.fetch` from vitest-pool-workers). */
    fetch?: typeof fetch;
    /** SDK-9: defaults to `true`, preserving SDK-2's existing ensure-token behaviour (submit /
     * status / optIn / optOut mint a fresh installation on empty storage). Set `false` so a
     * consuming product can gate creation of a durable server-side installation behind its own
     * consent flow instead of having it happen as a side effect of the first call. */
    autoRegister?: boolean;
    /** CORR-6: optional opaque install-cluster id. When set, every POST sends identical
     * `X-Deft-Correlator` + body `correlator`. Never folded into the deployment ID (DEP-9). */
    correlator?: string;
}
/** SDK-internal failure codes: never in the server's closed 32-entry table (IMPLEMENTATION
 * §3.4). `transport_error` = fetch itself rejected (network unreachable). `invalid_response` =
 * a response body that isn't parseable JSON, or JSON missing the shape the caller expected.
 * `storage_error` (SDK-8) = credential persistence failed (pre-flight probe, or the post-register
 * save) — distinct from `transport_error` because the network call may have already succeeded
 * and minted a once-only, never-retrievable install token. `not_registered` (SDK-9) =
 * `autoRegister: false` and storage holds no credentials — not a transport failure, not a
 * malformed response, and not a storage failure, so none of the other three describe it
 * honestly. Both `storage_error` and `not_registered` are non-retryable: a byte-identical retry
 * cannot fix either. */
export type SdkErrorCode = "transport_error" | "invalid_response" | "storage_error" | "not_registered";
export interface FailureResult {
    ok: false;
    code: ErrorCode | SdkErrorCode;
    retryable: boolean;
    /** Set only when the server sent `Retry-After` on a 429 (IMPLEMENTATION §3.4). The SDK
     * surfaces this; it never sleeps on it — honoring backoff is the host application's call. */
    retryAfterSeconds?: number;
}
export interface EnsureRegisteredSuccess {
    ok: true;
    installId: string;
    state: string;
}
export type EnsureRegisteredResult = EnsureRegisteredSuccess | FailureResult;
export interface OptInArgs {
    scopes: string[];
    consentVersion: string;
    contact?: {
        email?: string;
        name?: string;
        sms?: string;
    };
}
export interface OptInSuccess {
    ok: true;
    state: string;
    scopes: string[];
    expiresAt: number;
}
export type OptInResult = OptInSuccess | FailureResult;
export interface OptOutSuccess {
    ok: true;
    state: string;
}
export type OptOutResult = OptOutSuccess | FailureResult;
export interface StatusSuccess {
    ok: true;
    state: string;
    scopes: string[];
    expiresAt?: number;
    consentVersion?: string;
}
export type StatusResult = StatusSuccess | FailureResult;
export interface SubmitSuccess {
    ok: true;
    id: string;
    deduplicated?: true;
}
export type SubmitResult = SubmitSuccess | FailureResult;
export interface Collector {
    ensureRegistered(): Promise<EnsureRegisteredResult>;
    optIn(args: OptInArgs): Promise<OptInResult>;
    optOut(): Promise<OptOutResult>;
    status(): Promise<StatusResult>;
    submit(scope: string, payload: unknown): Promise<SubmitResult>;
}
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
export declare const PREFLIGHT_SENTINEL_INSTALL_ID = "sdk-preflight-probe:not-a-real-install-id";
export declare function createCollector(config: CollectorConfig): Collector;
//# sourceMappingURL=collector.d.ts.map