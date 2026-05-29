import { config as loadDotenv } from "dotenv";
import path from "node:path";

import { parseSpaceTypes } from "./space-types.js";
import type { ScanOptions } from "./types.js";

loadDotenv();
loadDotenv({ path: "local.env", override: true });

export interface ApiConfig {
  googleCustomSearchApiKey?: string;
  googleCustomSearchCx?: string;
  googleMapsApiKey?: string;
  firecrawlApiKey?: string;
  aiModel: string;
  disableAi: boolean;
}

export function getApiConfig(): ApiConfig {
  return {
    googleCustomSearchApiKey: readEnv("GOOGLE_CUSTOM_SEARCH_API_KEY"),
    googleCustomSearchCx: readEnv("GOOGLE_CUSTOM_SEARCH_CX"),
    googleMapsApiKey: readEnv("GOOGLE_MAPS_API_KEY"),
    firecrawlApiKey: readEnv("FIRECRAWL_API_KEY"),
    aiModel: readEnv("AI_MODEL") ?? "openai/gpt-5.4",
    disableAi: readBooleanEnv("DISABLE_AI", false)
  };
}

export function defaultScanOptions(overrides: Partial<ScanOptions> = {}): ScanOptions {
  const defaultCounty = readEnv("DEFAULT_COUNTY") ?? "Kent";
  const defaultSpaceTypes = parseSpaceTypes(readEnv("DEFAULT_SPACE_TYPES"));
  const limitPerType = Number.parseInt(readEnv("DEFAULT_LIMIT_PER_TYPE") ?? "2", 10);
  const maxSites = Number.parseInt(readEnv("DEFAULT_MAX_SITES") ?? "20", 10);

  return {
    county: defaultCounty,
    area: defaultCounty,
    radiusMiles: undefined,
    spaceTypes: defaultSpaceTypes,
    limitPerType: Number.isFinite(limitPerType) ? limitPerType : 2,
    maxSites: Number.isFinite(maxSites) ? maxSites : 20,
    outDir: path.resolve(process.cwd(), "runs"),
    useAi: !readBooleanEnv("DISABLE_AI", false),
    mock: false,
    mapsZoom: 20,
    mapsSize: 640,
    ...overrides
  };
}

export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = readEnv(name);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
