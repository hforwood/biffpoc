#!/usr/bin/env node
import { Command } from "commander";
import cron from "node-cron";
import path from "node:path";

import { defaultScanOptions } from "./config.js";
import { printProductMatrix } from "./products.js";
import { runScan } from "./pipeline.js";
import { SPACE_TYPES, parseSpaceTypes } from "./space-types.js";
import type { ScanOptions } from "./types.js";

const program = new Command();

program
  .name("biffpoc")
  .description("BT Lockers site discovery and revenue estimation CLI")
  .version("0.1.0");

program
  .command("space-types")
  .description("List supported space types")
  .action(() => {
    for (const type of SPACE_TYPES) {
      console.log(`- ${type}`);
    }
  });

program
  .command("products")
  .description("Print the BT Lockers product matrix")
  .action(() => {
    printProductMatrix();
  });

program
  .command("scan")
  .description("Run a one-off area scan")
  .option("-a, --area <area>", "Town, area, county, or UK postcode to scan, e.g. Preston or PR1 1AA")
  .option("-c, --county <county>", "Backward-compatible alias for --area")
  .option("-r, --radius <miles>", "Mile radius from the area/postcode centre", numberOption)
  .option("-t, --space-types <types>", "Comma-separated space types or 'all'", "all")
  .option("-l, --limit-per-type <n>", "Places results per space type", numberOption, 2)
  .option("-m, --max-sites <n>", "Maximum deduplicated sites to analyze", numberOption, 20)
  .option("-o, --out-dir <dir>", "Output directory", "runs")
  .option("--maps-zoom <n>", "Google Static Maps zoom for site analysis", numberOption, 20)
  .option("--maps-size <n>", "Google Static Maps CSS size in pixels", numberOption, 640)
  .option("--mock", "Use mock places and skip external APIs", false)
  .option("--no-ai", "Disable AI-assisted map analysis")
  .action(async (raw) => {
    const options = buildOptions(raw);
    const summary = await runScan(options);
    const { printSummary } = await import("./report.js");
    printSummary(summary);
  });

program
  .command("schedule")
  .description("Run scans on a local cron schedule while this process stays alive")
  .option("-a, --area <area>", "Town, area, county, or UK postcode to scan, e.g. Preston or PR1 1AA")
  .option("-c, --county <county>", "Backward-compatible alias for --area")
  .option("-r, --radius <miles>", "Mile radius from the area/postcode centre", numberOption)
  .requiredOption("--cron <expr>", "Five-field cron expression, e.g. '0 8 * * 1-5'")
  .option("-t, --space-types <types>", "Comma-separated space types or 'all'", "all")
  .option("-l, --limit-per-type <n>", "Places results per space type", numberOption, 2)
  .option("-m, --max-sites <n>", "Maximum deduplicated sites to analyze", numberOption, 20)
  .option("-o, --out-dir <dir>", "Output directory", "runs")
  .option("--maps-zoom <n>", "Google Static Maps zoom for site analysis", numberOption, 20)
  .option("--maps-size <n>", "Google Static Maps CSS size in pixels", numberOption, 640)
  .option("--mock", "Use mock places and skip external APIs", false)
  .option("--no-ai", "Disable AI-assisted map analysis")
  .action((raw) => {
    if (!cron.validate(raw.cron)) {
      throw new Error(`Invalid cron expression: ${raw.cron}`);
    }

    const options = buildOptions(raw);
    console.log(`Scheduling ${options.area} scan with cron: ${raw.cron}`);

    cron.schedule(raw.cron, async () => {
      const startedAt = new Date().toISOString();
      console.log(`[${startedAt}] Starting scheduled scan for ${options.area}`);

      try {
        const summary = await runScan(options);
        console.log(
          `[${new Date().toISOString()}] Finished: ${summary.totals.sites} sites, ${summary.totals.totalModules} modules`
        );
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Scheduled scan failed`, error);
      }
    });

    console.log("Scheduler active. Press Ctrl+C to stop.");
    process.stdin.resume();
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

function buildOptions(raw: Record<string, unknown>): ScanOptions {
  const area = String(raw.area ?? raw.county ?? "").trim();
  if (!area) {
    throw new Error("Provide an area with --area, e.g. --area Preston or --area \"PR1 1AA\".");
  }

  const county = String(raw.county ?? area);
  return defaultScanOptions({
    county,
    area,
    radiusMiles: raw.radius === undefined ? undefined : Number(raw.radius),
    spaceTypes: parseSpaceTypes(String(raw.spaceTypes ?? "all")),
    limitPerType: Number(raw.limitPerType),
    maxSites: Number(raw.maxSites),
    outDir: path.resolve(process.cwd(), String(raw.outDir ?? "runs")),
    useAi: Boolean(raw.ai),
    mock: Boolean(raw.mock),
    mapsZoom: Number(raw.mapsZoom),
    mapsSize: Number(raw.mapsSize)
  });
}

function numberOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number, received: ${value}`);
  }
  return parsed;
}
