import { createRequire } from "node:module";
import { type Collector, type CollectorConfig, createCollector } from "@deft/collection-sdk";
import { BUILD_CHANNEL, COLLECTION_BASE_URL, COLLECTION_ENV } from "../build-info.js";
import { credentialStorage } from "./storage.js";

/**
 * Single Collector factory for this project (ARC-3). Host + environment are
 * bake-time constants; no correlator; autoRegister is always false.
 */

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
  return explicit ?? COLLECTION_BASE_URL;
}

export function resolveCollectionEnv(explicit?: string): string {
  return explicit ?? COLLECTION_ENV;
}

export function buildChannel(): typeof BUILD_CHANNEL {
  return BUILD_CHANNEL;
}

/** The only createCollector call site. */
export function collector(projectRoot: string): Collector {
  const config: CollectorConfig = {
    baseUrl: resolveCollectionBaseUrl(),
    deployment: {
      product: "canonical",
      platform: "cli",
      environment: resolveCollectionEnv(),
      version: packageVersion(),
    },
    storage: credentialStorage(projectRoot),
    autoRegister: false,
  };
  return createCollector(config);
}
