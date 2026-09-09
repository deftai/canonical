import { createRequire } from "node:module";
import { type Collector, type CollectorConfig, createCollector } from "@deft/collection-sdk";
import { BUILD_CHANNEL, COLLECTION_BASE_URL, COLLECTION_ENV } from "../build-info.js";
import { ensureUserKey, type IdentityOptions } from "./identity.js";
import { projectCredentialStorage } from "./storage.js";

/**
 * Build a Collector bound to this project's storage and the anonymous correlator
 * (X-Deft-Correlator / body correlator — never folded into deployment.customer).
 *
 * Collector host + deployment environment are bake-time constants from
 * `CANONICAL_BUILD_CHANNEL` (see scripts/write-build-info.mjs). They are not
 * overridden by process env — published builds are channel-hardcoded.
 */

export interface CreateCanonicalCollectorOptions extends IdentityOptions {
  /** Test-only override. Production CLI never passes this. */
  readonly baseUrl?: string;
  /** Test-only override. Production CLI never passes this. */
  readonly environment?: string;
  readonly version?: string;
  readonly fetch?: typeof fetch;
  /** Defaults to false — register only after explicit opt-in. */
  readonly autoRegister?: boolean;
}

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Baked collector base URL for this build channel (explicit opts for tests only). */
export function resolveCollectionBaseUrl(explicit?: string): string {
  return explicit ?? COLLECTION_BASE_URL;
}

/** Baked deployment environment segment for this build channel. */
export function resolveCollectionEnv(explicit?: string): string {
  return explicit ?? COLLECTION_ENV;
}

export function buildChannel(): typeof BUILD_CHANNEL {
  return BUILD_CHANNEL;
}

export function createCanonicalCollector(
  projectRoot: string,
  opts: CreateCanonicalCollectorOptions = {},
): Collector {
  const correlator = ensureUserKey({ configDir: opts.configDir });
  const config: CollectorConfig = {
    baseUrl: resolveCollectionBaseUrl(opts.baseUrl),
    deployment: {
      product: "canonical",
      platform: "cli",
      environment: resolveCollectionEnv(opts.environment),
      version: opts.version ?? packageVersion(),
    },
    correlator,
    storage: projectCredentialStorage(projectRoot),
    autoRegister: opts.autoRegister ?? false,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  };
  return createCollector(config);
}
