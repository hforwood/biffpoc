import type { IncomingMessage } from "node:http";
import path from "node:path";

import { readEnv } from "./config.js";
import { databaseEnabled, getImageAssetDb } from "./db.js";
import { appendAiFeedbackMemory } from "./feedback-memory.js";
import { getSnapshotObject } from "./object-storage.js";
import { addMoreToSearch, createSearchRun, getSearchRun, listSearchRuns } from "./search-runs.js";
import { applyReviews, loadLatestSummary, updateReview } from "./storage.js";
import type { ContactStatus, SiteReview } from "./types.js";

export const webOutDir = path.resolve(process.cwd(), readEnv("WEB_OUT_DIR") ?? defaultWebOutDir());

export interface ApiRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  send(body: string | Buffer): void;
  setHeader(name: string, value: string): void;
}

export async function searchesPayload(): Promise<unknown> {
  const runs = await Promise.all(
    (await listSearchRuns(webOutDir)).map(async (run) => ({
      ...run,
      summary: run.summary ? await applyReviews(run.summary, webOutDir) : undefined
    }))
  );
  return { searches: runs };
}

export async function latestPayload(): Promise<unknown> {
  return { summary: (await loadLatestSummary(webOutDir)) ?? null };
}

export async function getSearchPayload(searchId: string): Promise<unknown> {
  const run = await getSearchRun(webOutDir, searchId);
  if (!run) throw statusError("Search not found.", 404);

  return {
    search: {
      ...run,
      summary: run.summary ? await applyReviews(run.summary, webOutDir) : undefined
    }
  };
}

export async function createSearchPayload(body: Record<string, unknown>): Promise<unknown> {
  const postCodes = Array.isArray(body.postCodes) ? body.postCodes.map(String).filter(Boolean) : [];
  const counties = Array.isArray(body.counties) ? body.counties.map(String).filter(Boolean) : [];
  const radiusMiles = body.radiusMiles ? Number(body.radiusMiles) : undefined;

  if (!postCodes.length && !counties.length) {
    throw statusError("Enter at least one post code or select at least one county.", 400);
  }

  if (!radiusMiles || !Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    throw statusError("Enter a search radius in miles.", 400);
  }

  const search = await createSearchRun(webOutDir, {
    name: String(body.name ?? "").trim(),
    postCodes,
    counties,
    radiusMiles,
    maxSites: body.maxSites ? Number(body.maxSites) : 20,
    limitPerType: body.limitPerType ? Number(body.limitPerType) : 2,
    spaceTypes: Array.isArray(body.spaceTypes) ? body.spaceTypes.map(String) : stringOrUndefined(body.spaceTypes),
    useAi: typeof body.useAi === "boolean" ? body.useAi : !readEnv("DISABLE_AI"),
    mock: Boolean(body.mock)
  });

  return {
    search: {
      ...search,
      summary: search.summary ? await applyReviews(search.summary, webOutDir) : undefined
    }
  };
}

export async function addMorePayload(searchId: string, body: Record<string, unknown>): Promise<unknown> {
  const count = Number(body.count ?? 10);
  if (!Number.isFinite(count) || count < 1) {
    throw statusError("Count must be a positive number.", 400);
  }

  const search = await addMoreToSearch(webOutDir, searchId, count, {
    useAi: typeof body.useAi === "boolean" ? body.useAi : undefined,
    mock: typeof body.mock === "boolean" ? body.mock : undefined
  });

  return {
    search: {
      ...search,
      summary: search.summary ? await applyReviews(search.summary, webOutDir) : undefined
    }
  };
}

export async function updateLeadReviewPayload(leadId: string, body: Record<string, unknown>): Promise<unknown> {
  const patch = sanitizeReviewPatch(body as Partial<SiteReview>);
  const review = await updateReview(webOutDir, leadId, patch);

  if (patch.isGood !== undefined || patch.notes !== undefined) {
    const lead = await findLead(leadId);
    await appendAiFeedbackMemory(webOutDir, {
      leadId,
      siteName: lead?.site.name,
      spaceType: lead?.site.spaceType,
      address: lead?.site.address,
      isGood: review.isGood,
      notes: review.notes
    });
  }

  return { review };
}

export async function sendImageAsset(res: ApiResponse, leadId: string, kind: string): Promise<void> {
  if (kind !== "original" && kind !== "annotated") throw statusError("Image not found.", 404);

  const asset =
    (await tryGetSnapshotObject(leadId, kind)) ??
    (databaseEnabled() ? await getImageAssetDb(leadId, kind) : undefined);
  if (!asset) throw statusError("Image not found.", 404);

  res.setHeader("Content-Type", asset.contentType);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(asset.data);
}

export async function readJsonBody(req: ApiRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  if (typeof req.body === "string") return parseJson(req.body);

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? parseJson(text) : {};
}

export function param(req: ApiRequest, name: string): string {
  const value = req.query?.[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function sendJson(res: ApiResponse, payload: unknown, status = 200): void {
  res.status(status).json(payload);
}

export function sendError(res: ApiResponse, error: unknown): void {
  const status = error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 500;
  res.status(Number.isFinite(status) ? status : 500).json({
    error: error instanceof Error ? error.message : String(error)
  });
}

export function rejectMethod(res: ApiResponse): void {
  res.status(405).json({ error: "Method not allowed." });
}

function sanitizeReviewPatch(input: Partial<SiteReview>): Partial<SiteReview> {
  const patch: Partial<SiteReview> = {};

  if (input.status !== undefined) {
    if (!isContactStatus(input.status)) throw statusError(`Invalid status: ${input.status}`, 400);
    patch.status = input.status;
  }

  if (input.isGood !== undefined) patch.isGood = Boolean(input.isGood);
  if (input.notes !== undefined) patch.notes = String(input.notes).slice(0, 2000);

  return patch;
}

async function findLead(leadId: string) {
  const runs = await listSearchRuns(webOutDir);
  for (const run of runs) {
    const lead = run.summary?.leads.find((item) => item.id === leadId);
    if (lead) return lead;
  }
  return undefined;
}

function isContactStatus(value: unknown): value is ContactStatus {
  return (
    value === "identified" ||
    value === "contacted" ||
    value === "call_booked" ||
    value === "rejected" ||
    value === "site_visit" ||
    value === "closed_won"
  );
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw statusError("Request body is not valid JSON.", 400);
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function tryGetSnapshotObject(leadId: string, kind: "original" | "annotated") {
  try {
    return await getSnapshotObject(leadId, kind);
  } catch (error) {
    console.warn(
      `Supabase S3 snapshot read failed; falling back to Postgres image storage: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

function statusError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function defaultWebOutDir(): string {
  return readEnv("VERCEL") ? "/tmp/biffpoc-web" : "runs/web";
}
