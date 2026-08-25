import "server-only";

import { env } from "@/config/env.server";

import { LocalMetadataProvider } from "./local.provider";
import { TmdbMetadataProvider } from "./tmdb.provider";
import type { MetadataProvider } from "./types";

/**
 * Provider factory. The single place that knows which implementation is live —
 * everything else depends on the `MetadataProvider` interface.
 */
function createMetadataProvider(): MetadataProvider {
  switch (env.METADATA_PROVIDER) {
    case "tmdb":
      return new TmdbMetadataProvider();
    case "local":
    default:
      return new LocalMetadataProvider();
  }
}

declare global {
  var __watchgoblinMetadata: MetadataProvider | undefined;
}

export const metadataProvider: MetadataProvider =
  globalThis.__watchgoblinMetadata ??
  (globalThis.__watchgoblinMetadata = createMetadataProvider());

export * from "./types";
