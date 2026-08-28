import { createRequire } from "node:module";
import { type Collector, type CollectorConfig, createCollector } from "@deft/collection-sdk";
import { ensureUserKey, type IdentityOptions } from "./identity.js";
import { projectCredentialStorage } from "./storage.js";
import { DEFAULT_COLLECTION_BASE_URL, DEFAULT_COLLECTION_ENV } from "./types.js";

/**
 * Build a Collector bound to this project's storage and the anonymous correlator
 * (X-Deft-Correlator / body correlator — never folded into deployment.customer).
 */

export interface CreateCanonicalCollectorOptions extends IdentityOptions {
  readonly baseUrl?: string;
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

export function resolveCollectionBaseUrl(explicit?: string): string {
  return explicit ?? process.env.CANONICAL_COLLECTION_URL ?? DEFAULT_COLLECTION_BASE_URL;
}

export function resolveCollectionEnv(explicit?: string): string {
  return explicit ?? process.env.CANONICAL_COLLECTION_ENV ?? DEFAULT_COLLECTION_ENV;
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
