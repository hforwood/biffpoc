import { z } from "zod";

export const DeadSpaceCandidateSchema = z.object({
  label: z.string(),
  placement: z.enum(["edge", "wall", "corner", "rear_yard", "service_yard", "screened_area", "unknown"]),
  estimatedLengthM: z.number().nonnegative(),
  estimatedDepthM: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
  risks: z.array(z.string()).default([]),
  annotation: z
    .object({
      label: z.string(),
      x1: z.number().min(0).max(1),
      y1: z.number().min(0).max(1),
      x2: z.number().min(0).max(1),
      y2: z.number().min(0).max(1),
      stroke: z.string().optional()
    })
    .optional()
});

export const AiSiteAnalysisSchema = z.object({
  deadSpaceCandidates: z.array(DeadSpaceCandidateSchema),
  confidence: z.number().min(0).max(1),
  notes: z.array(z.string()).default([])
});

export type AiSiteAnalysisOutput = z.infer<typeof AiSiteAnalysisSchema>;
