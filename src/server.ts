import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultScanOptions, readEnv } from "./config.js";
import { databaseEnabled, getImageAssetDb } from "./db.js";
import { appendAiFeedbackMemory } from "./feedback-memory.js";
import { importSitesIntoSearch } from "./import-sites.js";
import { getLeadProfile, getOwnerProfileByToken, updateLeadProfile, updateOwnerProfileByToken } from "./lead-profiles.js";
import { getSnapshotObject, type SnapshotKind } from "./object-storage.js";
import { runScan } from "./pipeline.js";
import {
  createProject,
  deleteProject,
  getContractorProject,
  getProjectWithSites,
  listProjects,
  syncProject,
  updateContractorProjectSite,
  updateProject,
  updateProjectSite
} from "./projects.js";
import { parseSpaceTypes } from "./space-types.js";
import { applyReviews, loadLatestSummary, updateReview } from "./storage.js";
import { addMoreToSearch, createSearchRun, getSearchRun, listSearchRuns } from "./search-runs.js";
import type { ContactStatus, SiteReview } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const outDir = path.resolve(process.cwd(), readEnv("WEB_OUT_DIR") ?? defaultWebOutDir());
const port = Number.parseInt(readEnv("PORT") ?? "4173", 10);

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/api/assets/:leadId/:kind", async (req, res, next) => {
  if (!isSnapshotKind(req.params.kind)) {
    next();
    return;
  }
  const kind = req.params.kind;

  try {
    const asset =
      (await tryGetSnapshotObject(req.params.leadId, kind)) ??
      (databaseEnabled() && isPrimaryImageKind(kind) ? await getImageAssetDb(req.params.leadId, kind) : undefined);
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
    const postCodes = Array.isArray(body.postCodes) ? body.postCodes : [];
    const counties = Array.isArray(body.counties) ? body.counties : [];
    const radiusMiles = body.radiusMiles ? Number(body.radiusMiles) : undefined;

    if (!postCodes.length && !counties.length) {
      res.status(400).json({ error: "Enter at least one post code or select at least one county." });
      return;
    }

    if (!radiusMiles || !Number.isFinite(radiusMiles) || radiusMiles <= 0) {
      res.status(400).json({ error: "Enter a search radius in miles." });
      return;
    }

    const search = await createSearchRun(outDir, {
      name: String(body.name ?? "").trim(),
      postCodes,
      counties,
      radiusMiles,
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

app.post("/api/searches/:searchId/import", async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows)
      ? req.body.rows.filter((row: unknown): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      : [];
    if (!rows.length) {
      res.status(400).json({ error: "Upload at least one site row." });
      return;
    }

    const search = await importSitesIntoSearch(outDir, req.params.searchId, rows, {
      useAi: typeof req.body?.useAi === "boolean" ? req.body.useAi : undefined,
      mock: typeof req.body?.mock === "boolean" ? req.body.mock : false
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

app.get("/api/projects", async (_req, res) => {
  try {
    res.json({ projects: await listProjects(outDir) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const postCodes = Array.isArray(req.body?.postCodes)
      ? req.body.postCodes.map(String)
      : String(req.body?.postCodes ?? "")
          .split(/,|\n/)
          .map((item) => item.trim())
          .filter(Boolean);
    if (!postCodes.length) {
      res.status(400).json({ error: "Add at least one postcode." });
      return;
    }
    res.json({
      project: await createProject(outDir, {
        name: String(req.body?.name ?? "").trim(),
        postCodes
      })
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/projects/:projectId", async (req, res) => {
  try {
    const project = await getProjectWithSites(outDir, req.params.projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ project });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/api/projects/:projectId", async (req, res) => {
  try {
    res.json({
      project: await updateProject(outDir, req.params.projectId, {
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        postCodes: Array.isArray(req.body?.postCodes) ? req.body.postCodes.map(String) : undefined
      })
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/api/projects/:projectId", async (req, res) => {
  try {
    await deleteProject(outDir, req.params.projectId);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/projects/:projectId/sync", async (req, res) => {
  try {
    res.json({ project: await syncProject(outDir, req.params.projectId) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/api/projects/:projectId/sites/:leadId", async (req, res) => {
  try {
    res.json({
      project: await updateProjectSite(outDir, req.params.projectId, req.params.leadId, {
        contractorStatus: req.body?.contractorStatus,
        estimatedInstallationDate: req.body?.estimatedInstallationDate,
        agreementFileUrl: req.body?.agreementFileUrl,
        agreementFileName: req.body?.agreementFileName
      })
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/contractor/:token", async (req, res) => {
  try {
    const project = await getContractorProject(outDir, req.params.token);
    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json({ project });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/api/contractor/:token/sites/:leadId", async (req, res) => {
  try {
    const status = req.body?.status;
    if (status !== "for_review" && status !== "rejected" && status !== "interested") {
      res.status(400).json({ error: "Invalid contractor status." });
      return;
    }
    res.json({ project: await updateContractorProjectSite(outDir, req.params.token, req.params.leadId, status) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
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

app.get("/api/leads/:leadId/profile", async (req, res) => {
  try {
    const payload = await getLeadProfile(outDir, req.params.leadId);
    res.json(payload);
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/api/leads/:leadId/profile", async (req, res) => {
  try {
    const payload = await updateLeadProfile(outDir, req.params.leadId, req.body, "admin");
    res.json({
      ...payload,
      search: {
        ...payload.search,
        summary: payload.search.summary ? await applyReviews(payload.search.summary, outDir) : undefined
      }
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/owner/:token", async (req, res) => {
  try {
    const { lead } = await getOwnerProfileByToken(outDir, req.params.token);
    res.json({ lead: publicOwnerLead(lead) });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/api/owner/:token", async (req, res) => {
  try {
    const { lead } = await updateOwnerProfileByToken(outDir, req.params.token, req.body);
    res.json({ lead: publicOwnerLead(lead) });
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

function defaultWebOutDir(): string {
  return readEnv("VERCEL") ? "/tmp/biffpoc-web" : "runs/web";
}

async function tryGetSnapshotObject(leadId: string, kind: SnapshotKind) {
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

function isSnapshotKind(kind: string): kind is SnapshotKind {
  return isPrimaryImageKind(kind);
}

function isPrimaryImageKind(kind: string): kind is "original" | "annotated" {
  return kind === "original" || kind === "annotated";
}

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
    value === "closed_won" ||
    value === "registered"
  );
}

function publicOwnerLead(lead: { id: string; site: unknown; contact: unknown; profile?: unknown }) {
  return {
    id: lead.id,
    site: lead.site,
    contact: lead.contact,
    profile: lead.profile
  };
}
