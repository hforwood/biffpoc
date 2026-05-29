import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultScanOptions, readEnv } from "./config.js";
import { databaseEnabled, getImageAssetDb } from "./db.js";
import { appendAiFeedbackMemory } from "./feedback-memory.js";
import { runScan } from "./pipeline.js";
import { parseSpaceTypes } from "./space-types.js";
import { applyReviews, loadLatestSummary, updateReview } from "./storage.js";
import { addMoreToSearch, createSearchRun, getSearchRun, listSearchRuns } from "./search-runs.js";
import type { ContactStatus, SiteReview } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const outDir = path.resolve(process.cwd(), readEnv("WEB_OUT_DIR") ?? "runs/web");
const port = Number.parseInt(readEnv("PORT") ?? "4173", 10);

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/api/assets/:leadId/:kind", async (req, res, next) => {
  if (!databaseEnabled()) {
    next();
    return;
  }

  const kind = req.params.kind === "original" || req.params.kind === "annotated" ? req.params.kind : undefined;
  if (!kind) {
    res.status(404).send("Not found");
    return;
  }

  try {
    const asset = await getImageAssetDb(req.params.leadId, kind);
    if (!asset) {
      res.status(404).send("Not found");
      return;
    }
    res.type(asset.contentType);
    res.set("Cache-Control", "private, max-age=300");
    res.send(asset.data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.use("/assets", express.static(path.join(outDir, "assets")));
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/latest", async (_req, res) => {
  try {
    const summary = await loadLatestSummary(outDir);
    res.json({ summary: summary ?? null });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/searches", async (_req, res) => {
  try {
    const runs = await Promise.all(
      (await listSearchRuns(outDir)).map(async (run) => ({
        ...run,
        summary: run.summary ? await applyReviews(run.summary, outDir) : undefined
      }))
    );
    res.json({ searches: runs });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/searches/:searchId", async (req, res) => {
  try {
    const run = await getSearchRun(outDir, req.params.searchId);
    if (!run) {
      res.status(404).json({ error: "Search not found." });
      return;
    }

    res.json({
      search: {
        ...run,
        summary: run.summary ? await applyReviews(run.summary, outDir) : undefined
      }
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/searches", async (req, res) => {
  try {
    const body = req.body as {
      name?: string;
      postCodes?: string[];
      counties?: string[];
      radiusMiles?: number;
      maxSites?: number;
      limitPerType?: number;
      spaceTypes?: string | string[];
      useAi?: boolean;
      mock?: boolean;
    };

    const search = await createSearchRun(outDir, {
      name: String(body.name ?? "").trim(),
      postCodes: Array.isArray(body.postCodes) ? body.postCodes : [],
      counties: Array.isArray(body.counties) ? body.counties : [],
      radiusMiles: body.radiusMiles ? Number(body.radiusMiles) : undefined,
      maxSites: body.maxSites ? Number(body.maxSites) : 20,
      limitPerType: body.limitPerType ? Number(body.limitPerType) : 2,
      spaceTypes: body.spaceTypes,
      useAi: body.useAi ?? !readEnv("DISABLE_AI"),
      mock: Boolean(body.mock)
    });

    res.json({
      search: {
        ...search,
        summary: search.summary ? await applyReviews(search.summary, outDir) : undefined
      }
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/searches/:searchId/add-more", async (req, res) => {
  try {
    const body = req.body as {
      count?: number;
      useAi?: boolean;
      mock?: boolean;
    };
    const count = Number(body.count ?? 10);
    if (!Number.isFinite(count) || count < 1) {
      res.status(400).json({ error: "Count must be a positive number." });
      return;
    }

    const search = await addMoreToSearch(outDir, req.params.searchId, count, {
      useAi: body.useAi,
      mock: body.mock
    });

    res.json({
      search: {
        ...search,
        summary: search.summary ? await applyReviews(search.summary, outDir) : undefined
      }
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/scan", async (req, res) => {
  try {
    const body = req.body as {
      area?: string;
      radiusMiles?: number;
      spaceTypes?: string | string[];
      limitPerType?: number;
      maxSites?: number;
      useAi?: boolean;
      mock?: boolean;
    };

    const area = String(body.area ?? "").trim();
    if (!area) {
      res.status(400).json({ error: "Area is required." });
      return;
    }

    const spaceTypes = Array.isArray(body.spaceTypes)
      ? body.spaceTypes
      : parseSpaceTypes(body.spaceTypes || readEnv("DEFAULT_SPACE_TYPES"));

    const summary = await runScan(
      defaultScanOptions({
        county: area,
        area,
        radiusMiles: body.radiusMiles ? Number(body.radiusMiles) : undefined,
        spaceTypes,
        limitPerType: Number(body.limitPerType ?? 2),
        maxSites: Number(body.maxSites ?? 20),
        outDir,
        useAi: body.useAi ?? !readEnv("DISABLE_AI"),
        mock: Boolean(body.mock),
        mapsZoom: 20,
        mapsSize: 640
      })
    );

    res.json({ summary: await applyReviews(summary, outDir) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/api/leads/:leadId/review", async (req, res) => {
  try {
    const patch = sanitizeReviewPatch(req.body as Partial<SiteReview>);
    const review = await updateReview(outDir, req.params.leadId, patch);
    if (patch.isGood !== undefined || patch.notes !== undefined) {
      const lead = await findLead(req.params.leadId);
      await appendAiFeedbackMemory(outDir, {
        leadId: req.params.leadId,
        siteName: lead?.site.name,
        spaceType: lead?.site.spaceType,
        address: lead?.site.address,
        isGood: review.isGood,
        notes: review.notes
      });
    }
    res.json({ review });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`BiffPOC interface running at http://localhost:${port}`);
});

function sanitizeReviewPatch(input: Partial<SiteReview>): Partial<SiteReview> {
  const patch: Partial<SiteReview> = {};

  if (input.status !== undefined) {
    if (!isContactStatus(input.status)) {
      throw new Error(`Invalid status: ${input.status}`);
    }
    patch.status = input.status;
  }

  if (input.isGood !== undefined) {
    patch.isGood = Boolean(input.isGood);
  }

  if (input.notes !== undefined) {
    patch.notes = String(input.notes).slice(0, 2000);
  }

  return patch;
}

async function findLead(leadId: string) {
  const runs = await listSearchRuns(outDir);
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
