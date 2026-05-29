import { defaultScanOptions, readEnv } from "../../src/config.js";
import { runScan } from "../../src/pipeline.js";
import { parseSpaceTypes } from "../../src/space-types.js";

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
    const summary = await runScan(
      defaultScanOptions({
        county: readEnv("DEFAULT_COUNTY") ?? "Kent",
        area: readEnv("DEFAULT_AREA") ?? readEnv("DEFAULT_COUNTY") ?? "Kent",
        radiusMiles: readEnv("DEFAULT_RADIUS_MILES")
          ? Number.parseFloat(readEnv("DEFAULT_RADIUS_MILES")!)
          : undefined,
        spaceTypes: parseSpaceTypes(readEnv("DEFAULT_SPACE_TYPES")),
        limitPerType: Number.parseInt(readEnv("DEFAULT_LIMIT_PER_TYPE") ?? "2", 10),
        maxSites: Number.parseInt(readEnv("DEFAULT_MAX_SITES") ?? "20", 10),
        outDir: readEnv("REPORT_OUT_DIR") ?? "/tmp/biffpoc-runs",
        useAi: readEnv("DISABLE_AI") !== "true",
        mock: false
      })
    );

    res.status(200).json({
      ok: true,
      county: summary.county,
      generatedAt: summary.generatedAt,
      totals: summary.totals
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
