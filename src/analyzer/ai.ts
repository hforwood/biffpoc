import { Output, ToolLoopAgent, stepCountIs, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import type { ApiConfig } from "../config.js";
import { PRODUCTS } from "../products.js";
import type { DeadSpaceCandidate, PlaceCandidate, StaticMapContext } from "../types.js";
import { AiSiteAnalysisSchema } from "./schemas.js";

export async function analyzeWithAi(
  config: ApiConfig,
  site: PlaceCandidate,
  staticMap: StaticMapContext | undefined,
  feedbackMemory: string[] = []
): Promise<{ candidates: DeadSpaceCandidate[]; confidence: number; notes: string[] } | undefined> {
  if (config.disableAi) return undefined;

  const agent = new ToolLoopAgent({
    model: modelFromConfig(config),
    instructions: [
      "You are a UK property feasibility analyst for BT Lockers.",
      "Find only plausible dead-space placements: wall-hugged edges, perimeter strips, corners, rear/service yards, screened areas.",
      "Do not use active parking bays, loading bays, entrances, fire exits, obvious pedestrian routes, doors, dropped kerbs, or areas that block sightlines.",
      "Bins, refuse compounds, rear service edges, and screened utility areas can be excellent dead-space signals if access is not blocked.",
      "Height restrictions, canopies, underground/covered parking, green-space views, entrances, fire routes, and sightlines reduce viability.",
      "Return cautious dimensions in metres. Include annotation line coordinates as normalized image positions from 0 to 1 for red-line overlay drawing. If the imagery/context is weak, lower confidence instead of inventing certainty."
    ].join(" "),
    stopWhen: stepCountIs(8),
    tools: {
      productMatrix: tool({
        description: "Returns BT Lockers dimensions and annual revenue data.",
        inputSchema: z.object({}),
        execute: async () => PRODUCTS
      }),
      scaleContext: tool({
        description: "Returns the Google Static Maps scale context for the current site.",
        inputSchema: z.object({}),
        execute: async () => staticMapMetadata(staticMap)
      })
    },
    output: Output.object({
      schema: AiSiteAnalysisSchema
    })
  });

  const text = [
    `Assess this site for BT Lockers dead-space potential.`,
    `Site name: ${site.name}`,
    `Address: ${site.address ?? "unknown"}`,
    `Space type: ${site.spaceType}`,
    `Google types: ${site.types.join(", ") || "unknown"}`,
    `Maps URI: ${site.googleMapsUri ?? "unknown"}`,
    staticMap
      ? `Static map scale: ${staticMap.widthMeters.toFixed(1)}m square coverage, ${staticMap.metersPerReturnedPixel.toFixed(3)}m per returned pixel, zoom ${staticMap.zoom}, scale ${staticMap.scale}.`
      : "No static map image available. Use only conservative category assumptions.",
    feedbackMemory.length
      ? `Past user AI Feedback memory to learn from:\n${feedbackMemory.map((item) => `- ${item}`).join("\n")}`
      : "No past user AI Feedback memory is available yet.",
    "Use the productMatrix and scaleContext tools before finalizing.",
    "Return candidate dead-space areas only. For each candidate, include a red-line annotation across the placement area using normalized image coordinates. The downstream code will select the exact locker product from the matrix."
  ].join("\n");

  const content: Array<Record<string, unknown>> = [{ type: "text", text }];
  if (staticMap?.imageBase64) {
    content.push({
      type: "image",
      image: Buffer.from(staticMap.imageBase64, "base64"),
      mediaType: staticMap.contentType ?? "image/png"
    });
  }

  const result = await agent.generate({
    messages: [
      {
        role: "user",
        content
      }
    ] as never
  });

  const parsed = AiSiteAnalysisSchema.safeParse((result as { output?: unknown }).output);
  if (!parsed.success) return undefined;

  return {
    candidates: parsed.data.deadSpaceCandidates,
    confidence: parsed.data.confidence,
    notes: parsed.data.notes
  };
}

function modelFromConfig(config: ApiConfig) {
  if (config.openAiApiKey && config.aiModel.startsWith("openai/")) {
    return openai(config.aiModel.replace(/^openai\//, ""));
  }

  return config.aiModel;
}

function staticMapMetadata(staticMap: StaticMapContext | undefined) {
  if (!staticMap) return { unavailable: true };

  return {
    url: staticMap.url,
    center: staticMap.center,
    zoom: staticMap.zoom,
    cssSizePx: staticMap.cssSizePx,
    scale: staticMap.scale,
    widthMeters: staticMap.widthMeters,
    heightMeters: staticMap.heightMeters,
    metersPerCssPixel: staticMap.metersPerCssPixel,
    metersPerReturnedPixel: staticMap.metersPerReturnedPixel,
    contentType: staticMap.contentType,
    imageProvided: Boolean(staticMap.imageBase64)
  };
}
