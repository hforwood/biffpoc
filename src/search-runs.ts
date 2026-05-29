import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { defaultScanOptions } from "./config.js";
import { databaseEnabled, getSearchRunDb, listSearchRunsDb, upsertSearchRunDb } from "./db.js";
import { runScan } from "./pipeline.js";
import { parseSpaceTypes } from "./space-types.js";
import type { ScanSummary, SiteLead } from "./types.js";
import { stableLeadKey } from "./utils/stable-key.js";

export type SearchRunStatus = "running" | "completed" | "error";

export interface CreateSearchRunInput {
  name: string;
  postCodes: string[];
  counties: string[];
  radiusMiles?: number;
  maxSites?: number;
  limitPerType?: number;
  spaceTypes?: string | string[];
  useAi?: boolean;
  mock?: boolean;
}

export interface SearchRunRequest {
  maxSites: number;
  limitPerType: number;
  spaceTypes: string[];
  useAi: boolean;
  mock: boolean;
}

export interface SearchRun {
  id: string;
  name: string;
  status: SearchRunStatus;
  createdAt: string;
  updatedAt: string;
  postCodes: string[];
  counties: string[];
  radiusMiles?: number;
  request?: SearchRunRequest;
  error?: string;
  summary?: ScanSummary;
}

export async function listSearchRuns(outDir: string): Promise<SearchRun[]> {
  if (databaseEnabled()) return listSearchRunsDb();
  return readSearchRuns(outDir);
}

export async function getSearchRun(outDir: string, id: string): Promise<SearchRun | undefined> {
  if (databaseEnabled()) return getSearchRunDb(id);
  const runs = await readSearchRuns(outDir);
  return runs.find((run) => run.id === id);
}

export async function createSearchRun(outDir: string, input: CreateSearchRunInput): Promise<SearchRun> {
  const createdAt = new Date().toISOString();
  const id = randomUUID();
  const run: SearchRun = {
    id,
    name: input.name.trim() || defaultSearchName(input),
    status: "running",
    createdAt,
    updatedAt: createdAt,
    postCodes: cleanList(input.postCodes),
    counties: cleanList(input.counties).filter((county) => county.toLowerCase() !== "all"),
    radiusMiles: input.radiusMiles,
    request: normalizedRequest(input)
  };

  await upsertSearchRun(outDir, run);

  try {
    const summary = await runAggregateScan(outDir, run, input);
    const completed: SearchRun = {
      ...run,
      status: "completed",
      updatedAt: new Date().toISOString(),
      summary
    };
    await upsertSearchRun(outDir, completed);
    return completed;
  } catch (error) {
    const failed: SearchRun = {
      ...run,
      status: "error",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
    await upsertSearchRun(outDir, failed);
    return failed;
  }
}

export async function addMoreToSearch(
  outDir: string,
  id: string,
  count: number,
  overrides: Pick<CreateSearchRunInput, "useAi" | "mock"> = {}
): Promise<SearchRun> {
  const run = await getSearchRun(outDir, id);
  if (!run) {
    throw new Error("Search not found.");
  }

  const addCount = Math.max(1, Math.min(Math.floor(count), 250));
  const existingLeads = run.summary?.leads ?? [];
  const existingKeys = new Set(existingLeads.map(stableLeadKey));
  const request: SearchRunRequest = run.request ?? normalizedRequest({
    name: run.name,
    postCodes: run.postCodes,
    counties: run.counties,
    radiusMiles: run.radiusMiles,
    maxSites: Math.max(existingLeads.length + addCount, 20),
    limitPerType: 2,
    spaceTypes: run.summary?.options.spaceTypes ?? "all",
    useAi: true,
    mock: false
  });
  const areas = [...run.postCodes, ...run.counties];
  const areaCount = Math.max(areas.length || 1, 1);
  const typeCount = Math.max(request.spaceTypes.length, 1);
  const expandedMaxSites = existingLeads.length + addCount * 3;
  const expandedLimitPerType = Math.min(
    20,
    Math.max(request.limitPerType, Math.ceil(expandedMaxSites / Math.max(areaCount * typeCount, 1)) + 2)
  );
  const running: SearchRun = {
    ...run,
    status: "running",
    updatedAt: new Date().toISOString(),
    error: undefined
  };
  await upsertSearchRun(outDir, running);

  try {
    const freshSummary = await runAggregateScan(outDir, running, {
      name: run.name,
      postCodes: run.postCodes,
      counties: run.counties,
      radiusMiles: run.radiusMiles,
      maxSites: expandedMaxSites,
      limitPerType: expandedLimitPerType,
      spaceTypes: request.spaceTypes,
      useAi: overrides.useAi ?? request.useAi,
      mock: overrides.mock ?? request.mock
    });
    const freshLeads = freshSummary.leads.filter((lead) => !existingKeys.has(stableLeadKey(lead)));
    const appendedLeads = freshLeads.slice(0, addCount);
    const leads = [...existingLeads, ...appendedLeads];
    const summary: ScanSummary = {
      ...(run.summary ?? freshSummary),
      generatedAt: new Date().toISOString(),
      options: {
        ...freshSummary.options,
        maxSites: leads.length
      },
      leads,
      totals: totalsFor(leads)
    };
    const completed: SearchRun = {
      ...run,
      status: "completed",
      updatedAt: new Date().toISOString(),
      error: appendedLeads.length === 0 ? "No new non-duplicate sites found." : undefined,
      request: {
        ...request,
        maxSites: leads.length,
        limitPerType: expandedLimitPerType,
        useAi: overrides.useAi ?? request.useAi,
        mock: overrides.mock ?? request.mock
      },
      summary
    };
    await upsertSearchRun(outDir, completed);
    return completed;
  } catch (error) {
    const failed: SearchRun = {
      ...run,
      status: "error",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
    await upsertSearchRun(outDir, failed);
    return failed;
  }
}

async function runAggregateScan(
  outDir: string,
  run: SearchRun,
  input: CreateSearchRunInput
): Promise<ScanSummary> {
  const areas = [...run.postCodes, ...run.counties];
  const scanAreas = areas.length > 0 ? areas : [run.name];
  const maxSites = Number(input.maxSites ?? 20);
  const perAreaMaxSites = Math.max(1, Math.ceil(maxSites / scanAreas.length));
  const spaceTypes = Array.isArray(input.spaceTypes) ? input.spaceTypes : parseSpaceTypes(input.spaceTypes);

  const summaries: ScanSummary[] = [];
  for (const area of scanAreas) {
    summaries.push(
      await runScan(
        defaultScanOptions({
          county: area,
          area,
          radiusMiles: run.radiusMiles,
          outDir,
          spaceTypes,
          limitPerType: Number(input.limitPerType ?? 2),
          maxSites: perAreaMaxSites,
          useAi: input.useAi ?? true,
          mock: Boolean(input.mock),
          mapsZoom: 20,
          mapsSize: 640
        })
      )
    );
  }

  return mergeSummaries(run, summaries, maxSites);
}

function mergeSummaries(run: SearchRun, summaries: ScanSummary[], maxSites: number): ScanSummary {
  const leads = summaries
    .flatMap((summary, summaryIndex) =>
      summary.leads.map((lead) => ({
        ...lead,
        id: `${summaryIndex + 1}-${lead.id}`
      }))
    )
    .slice(0, maxSites);

  return {
    county: run.name,
    generatedAt: new Date().toISOString(),
    options: {
      ...summaries[0]?.options,
      county: run.name,
      area: run.name,
      radiusMiles: run.radiusMiles,
      maxSites,
      outDir: summaries[0]?.options.outDir ?? "",
      spaceTypes: summaries[0]?.options.spaceTypes ?? []
    },
    leads,
    totals: totalsFor(leads)
  };
}

function totalsFor(leads: SiteLead[]): ScanSummary["totals"] {
  return {
    sites: leads.length,
    totalModules: leads.reduce((sum, lead) => sum + lead.analysis.totalModules, 0),
    totalRevenueYear: leads.reduce((sum, lead) => sum + lead.analysis.totalRevenueYear, 0),
    paidToSpaceOwnerYear: leads.reduce((sum, lead) => sum + lead.analysis.paidToSpaceOwnerYear, 0),
    biffenRevenueYear: leads.reduce((sum, lead) => sum + lead.analysis.biffenRevenueYear, 0)
  };
}

async function readSearchRuns(outDir: string): Promise<SearchRun[]> {
  try {
    const raw = await fs.readFile(searchRunsPath(outDir), "utf8");
    return JSON.parse(raw) as SearchRun[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function upsertSearchRun(outDir: string, run: SearchRun): Promise<void> {
  if (databaseEnabled()) {
    await upsertSearchRunDb(run);
    return;
  }

  const runs = await readSearchRuns(outDir);
  const next = [run, ...runs.filter((item) => item.id !== run.id)];
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(searchRunsPath(outDir), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function searchRunsPath(outDir: string): string {
  return path.join(outDir, "searches.json");
}

function cleanList(items: string[] | undefined): string[] {
  return [...new Set((items ?? []).map((item) => item.trim()).filter(Boolean))];
}

function defaultSearchName(input: CreateSearchRunInput): string {
  const firstArea = cleanList(input.postCodes)[0] ?? cleanList(input.counties)[0];
  return firstArea ? `${firstArea} Sites` : "Untitled Search";
}

function normalizedRequest(input: CreateSearchRunInput): SearchRunRequest {
  return {
    maxSites: Number(input.maxSites ?? 20),
    limitPerType: Number(input.limitPerType ?? 2),
    spaceTypes: Array.isArray(input.spaceTypes) ? input.spaceTypes : parseSpaceTypes(input.spaceTypes),
    useAi: input.useAi ?? true,
    mock: Boolean(input.mock)
  };
}
