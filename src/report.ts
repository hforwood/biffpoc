import fs from "node:fs/promises";
import path from "node:path";

import { formatGbp } from "./products.js";
import type { ScanSummary, SiteLead } from "./types.js";
import { slugify } from "./utils/text.js";

export async function writeReports(summary: ScanSummary, outDir: string): Promise<{ jsonPath: string; csvPath: string }> {
  await fs.mkdir(outDir, { recursive: true });

  const stamp = summary.generatedAt.replace(/[:.]/g, "-");
  const base = `${stamp}-${slugify(summary.county)}`;
  const jsonPath = path.join(outDir, `${base}.json`);
  const csvPath = path.join(outDir, `${base}.csv`);

  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fs.writeFile(csvPath, toCsv(summary), "utf8");

  return { jsonPath, csvPath };
}

export function printSummary(summary: ScanSummary): void {
  console.log(`\nArea: ${summary.options.area || summary.county}`);
  console.log(`Sites: ${summary.totals.sites}`);
  console.log(`Modules: ${summary.totals.totalModules}`);
  console.log(`Total revenue/year: ${formatGbp(summary.totals.totalRevenueYear)}`);
  console.log(`Paid to space owners/year: ${formatGbp(summary.totals.paidToSpaceOwnerYear)}`);
  console.log(`Biffen revenue/year: ${formatGbp(summary.totals.biffenRevenueYear)}\n`);

  console.table(
    summary.leads.map((lead) => ({
      site: lead.site.name,
      type: lead.site.spaceType,
      contact: lead.contact.phoneNumber ?? lead.contact.emailAddress ?? lead.contact.contactFormUrl ?? "",
      sizeM2: lead.analysis.estimatedDeadSpaceM2.toFixed(1),
      modules: lead.analysis.totalModules,
      product: lead.analysis.selectedFits.map((fit) => `${fit.quantity}x ${fit.product.product}`).join("; "),
      total: formatGbp(lead.analysis.totalRevenueYear),
      owner: formatGbp(lead.analysis.paidToSpaceOwnerYear),
      biffen: formatGbp(lead.analysis.biffenRevenueYear),
      score: lead.analysis.score.total,
      status: lead.review.status,
      carPark: lead.criteria?.hasCarPark ? "true" : "false",
      nearbyHousing: lead.criteria?.nearbyHousing ? "true" : "false",
      confidence: lead.analysis.confidence.toFixed(2),
      mode: lead.analysis.analysisMode
    }))
  );
}

function toCsv(summary: ScanSummary): string {
  const rows = [
    [
      "site_name",
      "space_type",
      "address",
      "phone",
      "email",
      "contact_form_url",
      "website",
      "google_maps_uri",
      "latitude",
      "longitude",
      "distance_miles",
      "contact_status",
      "car_park",
      "nearby_housing",
      "marked_good",
      "analysis_mode",
      "confidence",
      "site_size_m2",
      "site_score",
      "total_modules",
      "recommended_products",
      "total_revenue_year",
      "paid_to_space_owner_year",
      "biffen_revenue_year",
      "dead_space_notes"
    ],
    ...summary.leads.map((lead) => leadToCsvRow(lead))
  ];

  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function leadToCsvRow(lead: SiteLead): Array<string | number | undefined> {
  return [
    lead.site.name,
    lead.site.spaceType,
    lead.site.address,
    lead.contact.phoneNumber,
    lead.contact.emailAddress,
    lead.contact.contactFormUrl,
    lead.site.websiteUri,
    lead.site.googleMapsUri,
    lead.site.location?.latitude,
    lead.site.location?.longitude,
    lead.site.distanceMiles?.toFixed(2),
    lead.review.status,
    String(Boolean(lead.criteria?.hasCarPark)),
    String(Boolean(lead.criteria?.nearbyHousing)),
    lead.review.isGood === undefined ? "" : String(lead.review.isGood),
    lead.analysis.analysisMode,
    lead.analysis.confidence.toFixed(2),
    lead.analysis.estimatedDeadSpaceM2.toFixed(1),
    lead.analysis.score.total,
    lead.analysis.totalModules,
    lead.analysis.selectedFits.map((fit) => `${fit.quantity}x ${fit.product.product}`).join("; "),
    lead.analysis.totalRevenueYear,
    lead.analysis.paidToSpaceOwnerYear,
    lead.analysis.biffenRevenueYear,
    lead.analysis.deadSpaceCandidates.map((candidate) => `${candidate.label}: ${candidate.notes}`).join(" | ")
  ];
}

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
