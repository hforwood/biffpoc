import fs from "node:fs/promises";
import path from "node:path";

import { databaseEnabled, loadReviewsDb, listSearchRunsDb, updateReviewDb } from "./db.js";
import type { SiteReview, ScanSummary } from "./types.js";

type ReviewMap = Record<string, SiteReview>;

const DEFAULT_REVIEW: SiteReview = {
  status: "identified"
};

export async function loadLatestSummary(outDir: string): Promise<ScanSummary | undefined> {
  if (databaseEnabled()) {
    const latest = (await listSearchRunsDb()).find((run) => run.summary);
    return latest?.summary ? applyReviews(latest.summary, outDir) : undefined;
  }

  const files = await listJsonReports(outDir);
  if (files.length === 0) return undefined;

  const latest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  const raw = await fs.readFile(latest.path, "utf8");
  const summary = JSON.parse(raw) as ScanSummary;
  return applyReviews(summary, outDir);
}

export async function applyReviews(summary: ScanSummary, outDir: string): Promise<ScanSummary> {
  const reviews = await loadReviews(outDir);

  return {
    ...summary,
    leads: summary.leads.map((lead) => ({
      ...lead,
      review: reviews[lead.id] ?? lead.review ?? DEFAULT_REVIEW
    }))
  };
}

export async function updateReview(outDir: string, leadId: string, patch: Partial<SiteReview>): Promise<SiteReview> {
  const reviews = await loadReviews(outDir);
  const next: SiteReview = {
    ...DEFAULT_REVIEW,
    ...(reviews[leadId] ?? {}),
    ...patch,
    updatedAt: new Date().toISOString()
  };

  reviews[leadId] = next;
  if (databaseEnabled()) {
    await updateReviewDb(leadId, next);
  } else {
    await saveReviews(outDir, reviews);
  }
  return next;
}

async function loadReviews(outDir: string): Promise<ReviewMap> {
  if (databaseEnabled()) {
    return loadReviewsDb();
  }

  try {
    const raw = await fs.readFile(reviewPath(outDir), "utf8");
    return JSON.parse(raw) as ReviewMap;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function saveReviews(outDir: string, reviews: ReviewMap): Promise<void> {
  if (databaseEnabled()) return;

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(reviewPath(outDir), `${JSON.stringify(reviews, null, 2)}\n`, "utf8");
}

async function listJsonReports(outDir: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  try {
    const entries = await fs.readdir(outDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "reviews.json")
        .map(async (entry) => {
          const filePath = path.join(outDir, entry.name);
          const stat = await fs.stat(filePath);
          return { path: filePath, mtimeMs: stat.mtimeMs };
        })
    );
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function reviewPath(outDir: string): string {
  return path.join(outDir, "reviews.json");
}
