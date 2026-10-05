import { createRequire } from "node:module";
import { type Collector, createCollector } from "@deft/collection-sdk";
import { BUILD_CHANNEL, COLLECTION_BASE_URL, COLLECTION_ENV } from "../build-info.js";
import { credentialStorage } from "./storage.js";
export const resolveCollectionBaseUrl = (): string => COLLECTION_BASE_URL;
export const resolveCollectionEnv = (): string => COLLECTION_ENV;
export const buildChannel = (): typeof BUILD_CHANNEL => BUILD_CHANNEL;
export function collector(projectRoot: string): Collector {
  let version = "0.0.0";
  try {
    const require = createRequire(import.meta.url);
    version = (require("../../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {}

  return createCollector({
    baseUrl: resolveCollectionBaseUrl(),
    deployment: {
      product: "canonical",
      platform: "cli",
      environment: resolveCollectionEnv(),
      version,
    },
    storage: credentialStorage(projectRoot),
    autoRegister: false,
  });
}
