import { PRODUCTS } from "../products.js";
import type { DeadSpaceCandidate, ProductFit, ProductOption, SiteAnalysis, SiteScore } from "../types.js";
import { clamp } from "../utils/text.js";

const CATEGORY_DEFAULTS: Array<{
  match: RegExp;
  lengthM: number;
  depthM: number;
  placement: DeadSpaceCandidate["placement"];
  confidence: number;
  note: string;
}> = [
  {
    match: /supermarket|retail park|shopping|diy|trade store|garden centre/i,
    lengthM: 20,
    depthM: 1.4,
    placement: "edge",
    confidence: 0.52,
    note: "Large-format retail sites often have perimeter edges, trolley bay margins, or rear elevations that may support a straight run."
  },
  {
    match: /industrial|business park|office park|warehouse|logistics|depot|self-storage|builder/i,
    lengthM: 20,
    depthM: 2.2,
    placement: "service_yard",
    confidence: 0.55,
    note: "Commercial yards frequently have fence-line or wall-hugged surplus space, subject to HGV tracking and fire routes."
  },
  {
    match: /council car park|park & ride|train station|airport parking/i,
    lengthM: 15,
    depthM: 1.2,
    placement: "edge",
    confidence: 0.5,
    note: "Public parking assets can have perimeter space, but permissions and pedestrian routes are material constraints."
  },
  {
    match: /pub|hotel|community|village hall|church|farm shop/i,
    lengthM: 6,
    depthM: 1.1,
    placement: "wall",
    confidence: 0.45,
    note: "Smaller hospitality/community sites may support a modest wall-hugged run away from entrances and accessible routes."
  },
  {
    match: /sports|football|rugby|cricket|tennis|golf|leisure|stadium|racecourse/i,
    lengthM: 12,
    depthM: 1.5,
    placement: "edge",
    confidence: 0.48,
    note: "Sports and leisure sites often have perimeter car park or clubhouse wall space outside peak access flows."
  },
  {
    match: /school|college|university|hospital|nhs/i,
    lengthM: 10,
    depthM: 1.2,
    placement: "screened_area",
    confidence: 0.38,
    note: "Institutional sites may have suitable service edges, but safeguarding, emergency access, and estates approval reduce confidence."
  },
  {
    match: /former|abandoned|closed|empty|low-use/i,
    lengthM: 20,
    depthM: 3,
    placement: "rear_yard",
    confidence: 0.42,
    note: "Vacant or former sites can have more physical space, but legal control, security, and utility status need validation."
  },
  {
    match: /petrol|forecourt|car wash|tyre|mot|garage/i,
    lengthM: 6,
    depthM: 1,
    placement: "wall",
    confidence: 0.34,
    note: "Automotive sites are constrained by vehicle circulation, fuel safety zones, and sightlines, so only small wall runs are assumed."
  }
];

export function heuristicDeadSpace(spaceType: string, placeTypes: string[]): DeadSpaceCandidate[] {
  const haystack = `${spaceType} ${placeTypes.join(" ")}`;
  const matched = CATEGORY_DEFAULTS.find((item) => item.match.test(haystack)) ?? {
    lengthM: 8,
    depthM: 1.1,
    placement: "unknown" as const,
    confidence: 0.35,
    note: "Generic conservative estimate; inspect satellite imagery and site access before treating this as a qualified opportunity."
  };

  return [
    {
      label: "Primary perimeter opportunity",
      placement: matched.placement,
      estimatedLengthM: matched.lengthM,
      estimatedDepthM: matched.depthM,
      confidence: matched.confidence,
      notes: matched.note,
      risks: [
        "Validate against marked parking bays, loading routes, entrances, dropped kerbs, and fire access.",
        "Confirm land ownership and leaseholder authority before outreach."
      ],
      annotation: defaultAnnotationForPlacement(matched.placement)
    }
  ];
}

export function buildSiteAnalysis(
  candidates: DeadSpaceCandidate[],
  analysisMode: SiteAnalysis["analysisMode"],
  notes: string[] = []
): SiteAnalysis {
  const candidatesWithAnnotations = candidates.map((candidate, index) => ({
    ...candidate,
    annotation: candidate.annotation ?? defaultAnnotationForPlacement(candidate.placement, index)
  }));
  const selectedFits = candidatesWithAnnotations.flatMap((candidate) => chooseFitsForCandidate(candidate));
  const estimatedDeadSpaceM2 = candidatesWithAnnotations.reduce(
    (sum, candidate) => sum + candidate.estimatedLengthM * candidate.estimatedDepthM,
    0
  );
  const totals = {
    totalModules: selectedFits.reduce((sum, fit) => sum + fit.totalModules, 0),
    totalRevenueYear: selectedFits.reduce((sum, fit) => sum + fit.totalRevenueYear, 0),
    paidToSpaceOwnerYear: selectedFits.reduce((sum, fit) => sum + fit.paidToSpaceOwnerYear, 0),
    biffenRevenueYear: selectedFits.reduce((sum, fit) => sum + fit.biffenRevenueYear, 0)
  };
  const confidence = selectedFits.length
    ? clamp(candidatesWithAnnotations.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidatesWithAnnotations.length, 0, 1)
    : 0;

  return {
    analysisMode,
    deadSpaceCandidates: candidatesWithAnnotations,
    selectedFits,
    estimatedDeadSpaceM2,
    ...totals,
    confidence,
    score: scoreSite(candidatesWithAnnotations, totals.biffenRevenueYear, confidence, estimatedDeadSpaceM2),
    notes
  };
}

function scoreSite(
  candidates: DeadSpaceCandidate[],
  biffenRevenueYear: number,
  confidence: number,
  estimatedDeadSpaceM2: number
): SiteScore {
  const allText = candidates
    .flatMap((candidate) => [candidate.placement, candidate.notes, ...candidate.risks])
    .join(" ")
    .toLowerCase();

  const deadSpace = Math.round(clamp(estimatedDeadSpaceM2 / 45, 0, 1) * 25);
  const revenue = Math.round(clamp(biffenRevenueYear / 2200, 0, 1) * 25);
  const confidenceScore = Math.round(confidence * 15);

  let viability = 25;
  const rationale: string[] = [];

  if (/bin|bins|refuse|waste|service_yard|rear_yard|screened|utility/.test(allText)) {
    viability += 8;
    rationale.push("Service/refuse/rear-yard context is treated as strong dead-space potential.");
  }

  if (/entrance|door|fire|loading|dropped kerb|pedestrian|sightline|sight line|access route/.test(allText)) {
    viability -= 9;
    rationale.push("Access, fire-route, entrance, loading, or pedestrian constraints reduce viability.");
  }

  if (/green space|greenspace|view|vista|parkland|landscape/.test(allText)) {
    viability -= 6;
    rationale.push("Potential impact on views or green-space frontage reduces viability.");
  }

  const heightRestrictionRisk = /height|canopy|barrier|covered|underground|multi-storey|multistorey/.test(allText) ? 8 : 0;
  if (heightRestrictionRisk) {
    viability -= heightRestrictionRisk;
    rationale.push("Height restriction language detected; 2.2m locker height needs manual validation.");
  }

  const nuisanceRisk = /nuisance|neighbour|noise|residential|school|hospital|safeguarding/.test(allText) ? 7 : 0;
  if (nuisanceRisk) {
    viability -= nuisanceRisk;
    rationale.push("Neighbour, safeguarding, health-estate, or nuisance risk detected.");
  }

  viability = Math.round(clamp(viability, 0, 35));
  const total = Math.round(clamp(deadSpace + revenue + viability + confidenceScore, 0, 100));

  if (rationale.length === 0) {
    rationale.push("Score is driven by estimated dead-space area, revenue capacity, and confidence.");
  }

  return {
    total,
    deadSpace,
    revenue,
    viability,
    confidence: confidenceScore,
    nuisanceRisk,
    heightRestrictionRisk,
    rationale
  };
}

function chooseFitsForCandidate(candidate: DeadSpaceCandidate): ProductFit[] {
  const products = PRODUCTS.filter((product) => productFits(product, candidate)).sort(
    (a, b) => b.biffenRevenueYear - a.biffenRevenueYear
  );

  const best = products[0];
  if (!best) return [];

  const quantity = best.family === "straight" ? Math.max(1, Math.floor(candidate.estimatedLengthM / best.footprintLengthM)) : 1;

  return [
    {
      candidateLabel: candidate.label,
      product: best,
      quantity,
      totalModules: best.modules * quantity,
      totalRevenueYear: best.totalRevenueYear * quantity,
      paidToSpaceOwnerYear: best.paidToSpaceOwnerYear * quantity,
      biffenRevenueYear: best.biffenRevenueYear * quantity,
      rationale: rationale(best, candidate, quantity)
    }
  ];
}

function productFits(product: ProductOption, candidate: DeadSpaceCandidate): boolean {
  const length = candidate.estimatedLengthM;
  const depth = candidate.estimatedDepthM;

  if (product.family === "straight") {
    return product.footprintLengthM <= length && product.footprintDepthM <= depth;
  }

  if (candidate.placement !== "corner" && candidate.placement !== "rear_yard" && candidate.placement !== "service_yard") {
    return false;
  }

  return (
    (product.footprintLengthM <= length && product.footprintDepthM <= depth) ||
    (product.footprintDepthM <= length && product.footprintLengthM <= depth)
  );
}

function rationale(product: ProductOption, candidate: DeadSpaceCandidate, quantity: number): string {
  const qty = quantity > 1 ? `${quantity} x ` : "";
  return `${qty}${product.product} fits within estimated ${candidate.estimatedLengthM}m x ${candidate.estimatedDepthM}m ${candidate.placement} space while keeping to wall/edge placement assumptions.`;
}

function defaultAnnotationForPlacement(
  placement: DeadSpaceCandidate["placement"],
  index = 0
): DeadSpaceCandidate["annotation"] {
  const offset = Math.min(index * 0.08, 0.24);

  switch (placement) {
    case "wall":
      return { label: "Wall run", x1: 0.18, y1: 0.78 - offset, x2: 0.82, y2: 0.78 - offset, stroke: "#ff1f1f" };
    case "corner":
      return { label: "Corner run", x1: 0.18, y1: 0.8 - offset, x2: 0.5, y2: 0.8 - offset, stroke: "#ff1f1f" };
    case "rear_yard":
    case "service_yard":
      return { label: "Rear/service edge", x1: 0.2, y1: 0.22 + offset, x2: 0.78, y2: 0.22 + offset, stroke: "#ff1f1f" };
    case "screened_area":
      return { label: "Screened edge", x1: 0.68, y1: 0.2 + offset, x2: 0.68, y2: 0.76, stroke: "#ff1f1f" };
    case "edge":
    case "unknown":
    default:
      return { label: "Perimeter edge", x1: 0.14, y1: 0.86 - offset, x2: 0.86, y2: 0.86 - offset, stroke: "#ff1f1f" };
  }
}
