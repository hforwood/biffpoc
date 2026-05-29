import { readEnv } from "../../src/config.js";
import { createSearchRun } from "../../src/search-runs.js";
import { parseSpaceTypes } from "../../src/space-types.js";

export const maxDuration = 300;

interface VercelRequestLike {
  headers: Record<string, string | string[] | undefined>;
}

interface VercelResponseLike {
  status(code: number): VercelResponseLike;
  json(body: unknown): void;
  send(body: string): void;
}

export default async function handler(req: VercelRequestLike, res: VercelResponseLike): Promise<void> {
  const secret = readEnv("CRON_SECRET");
  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!secret || authorization !== `Bearer ${secret}`) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const area = readEnv("DEFAULT_AREA") ?? readEnv("DEFAULT_COUNTY") ?? "Kent";
    const run = await createSearchRun(readEnv("REPORT_OUT_DIR") ?? "/tmp/biffpoc-runs", {
      name: `${area} Scheduled Search`,
      postCodes: [],
      counties: [area],
      radiusMiles: readEnv("DEFAULT_RADIUS_MILES") ? Number.parseFloat(readEnv("DEFAULT_RADIUS_MILES")!) : undefined,
      spaceTypes: parseSpaceTypes(readEnv("DEFAULT_SPACE_TYPES")),
      limitPerType: Number.parseInt(readEnv("DEFAULT_LIMIT_PER_TYPE") ?? "2", 10),
      maxSites: Number.parseInt(readEnv("DEFAULT_MAX_SITES") ?? "20", 10),
      useAi: readEnv("DISABLE_AI") !== "true",
      mock: false
    });

    res.status(200).json({
      ok: true,
      searchId: run.id,
      status: run.status,
      generatedAt: run.updatedAt,
      totals: run.summary?.totals
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
