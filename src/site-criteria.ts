import { Output, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import type { ApiConfig } from "./config.js";
import type { PlaceCandidate, SiteCriteria, StaticMapContext } from "./types.js";
import { clamp } from "./utils/text.js";

const SiteCriteriaSchema = z.object({
  nearbyHousing: z.boolean(),
  hasCarPark: z.boolean(),
  confidence: z.number().min(0).max(1),
  notes: z.array(z.string()).max(4)
});

export async function analyzeSiteCriteria(params: {
  config: ApiConfig;
  site: PlaceCandidate;
  staticMap?: StaticMapContext;
  mock?: boolean;
}): Promise<SiteCriteria> {
  if (params.mock) return mockCriteria(params.site);
  if (params.config.disableAi || !params.staticMap?.imageBase64) return heuristicCriteria(params.site);

  try {
    const { output } = await generateText({
      model: modelFromConfig(params.config),
      output: Output.object({ schema: SiteCriteriaSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Assess this UK site from the satellite map only for two criteria.",
                "Return hasCarPark=true when there is a visible car park or parking area associated with the site.",
                "Return nearbyHousing=true when there are many residential houses close to the site boundary. A few isolated houses should be false unless the site is clearly embedded in housing.",
                "Do not assess locker placements, revenue, or dead-space lines.",
                `Site name: ${params.site.name}`,
                `Address: ${params.site.address ?? "unknown"}`,
                `Space type: ${params.site.spaceType}`,
                `Google place types: ${params.site.types.join(", ") || "unknown"}`,
                `Map scale: ${params.staticMap.widthMeters.toFixed(1)}m square at zoom ${params.staticMap.zoom}.`,
                "Keep notes short and specific."
              ].join("\n")
            },
            {
              type: "image",
              image: Buffer.from(params.staticMap.imageBase64, "base64"),
              mediaType: params.staticMap.contentType ?? "image/png"
            }
          ]
        }
      ] as never
    });

    const parsed = SiteCriteriaSchema.parse(output);
    return {
      nearbyHousing: parsed.nearbyHousing,
      hasCarPark: parsed.hasCarPark,
      confidence: clamp(parsed.confidence, 0, 1),
      notes: parsed.notes,
      source: "ai"
    };
  } catch (error) {
    console.warn(
      `AI criteria failed for "${params.site.name}": ${error instanceof Error ? error.message : String(error)}`
    );
    return heuristicCriteria(params.site);
  }
}

export function heuristicCriteria(site: PlaceCandidate): SiteCriteria {
  const haystack = `${site.name} ${site.address ?? ""} ${site.spaceType} ${site.types.join(" ")}`.toLowerCase();
  const hasCarPark =
    /car park|parking|park & ride|supermarket|retail|football|rugby|cricket|sports|club|leisure|hotel|pub|garden centre|station|airport|cinema|bowling|diy|trade store|hospital|university|college|school|church|community|village hall/.test(
      haystack
    );
  const nearbyHousing = /residential|housing estate|estate|village|high street|town centre|community|church|school/.test(
    haystack
  );

  return {
    hasCarPark,
    nearbyHousing,
    confidence: 0.35,
    notes: ["Heuristic criteria: confirm car park and nearby housing in the embedded map."],
    source: "heuristic"
  };
}

function mockCriteria(site: PlaceCandidate): SiteCriteria {
  return {
    ...heuristicCriteria(site),
    confidence: 0.7,
    notes: ["Mock criteria for local testing."],
    source: "mock"
  };
}

function modelFromConfig(config: ApiConfig) {
  if (config.openAiApiKey && config.aiModel.startsWith("openai/")) {
    return openai(config.aiModel.replace(/^openai\//, ""));
  }

  return config.aiModel;
}
