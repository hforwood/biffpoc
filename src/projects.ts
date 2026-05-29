import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { databaseEnabled, deleteProjectDb, getProjectDb, listProjectsDb, upsertProjectDb } from "./db.js";
import { applyReviews } from "./storage.js";
import { getSearchRun, listSearchRuns } from "./search-runs.js";
import type { SiteLead } from "./types.js";
import { stableLeadKey } from "./utils/stable-key.js";

export type ContractorSiteStatus = "for_review" | "rejected" | "interested";

export interface ProjectSite {
  leadId: string;
  searchId: string;
  postcode: string;
  distanceMiles?: number;
  contractorStatus: ContractorSiteStatus;
  estimatedInstallationDate?: string;
  agreementFileUrl?: string;
  agreementFileName?: string;
}

export interface Project {
  id: string;
  name: string;
  postCodes: string[];
  contractorToken: string;
  createdAt: string;
  updatedAt: string;
  sites: ProjectSite[];
}

export interface ProjectSiteWithLead extends ProjectSite {
  lead?: SiteLead;
}

export interface ProjectWithSites extends Project {
  siteProfiles: ProjectSiteWithLead[];
}

export async function listProjects(outDir: string): Promise<Project[]> {
  if (databaseEnabled()) return listProjectsDb();
  return readProjects(outDir);
}

export async function getProject(outDir: string, id: string): Promise<Project | undefined> {
  if (databaseEnabled()) return getProjectDb(id);
  return (await readProjects(outDir)).find((project) => project.id === id);
}

export async function getProjectWithSites(outDir: string, id: string): Promise<ProjectWithSites | undefined> {
  const project = await getProject(outDir, id);
  if (!project) return undefined;
  return {
    ...project,
    siteProfiles: await resolveProjectSites(outDir, project)
  };
}

export async function createProject(
  outDir: string,
  input: { name: string; postCodes: string[] }
): Promise<ProjectWithSites> {
  const createdAt = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim() || "New Project",
    postCodes: cleanPostCodes(input.postCodes),
    contractorToken: randomUUID().replace(/-/g, ""),
    createdAt,
    updatedAt: createdAt,
    sites: []
  };
  const synced = await syncProjectSites(outDir, project);
  await upsertProject(outDir, synced);
  return (await getProjectWithSites(outDir, synced.id))!;
}

export async function updateProject(
  outDir: string,
  id: string,
  input: Partial<Pick<Project, "name" | "postCodes">>
): Promise<ProjectWithSites> {
  const project = await getProject(outDir, id);
  if (!project) throw new Error("Project not found.");

  const next = await syncProjectSites(outDir, {
    ...project,
    name: input.name?.trim() || project.name,
    postCodes: input.postCodes ? cleanPostCodes(input.postCodes) : project.postCodes,
    updatedAt: new Date().toISOString()
  });
  await upsertProject(outDir, next);
  return (await getProjectWithSites(outDir, next.id))!;
}

export async function deleteProject(outDir: string, id: string): Promise<void> {
  if (databaseEnabled()) {
    await deleteProjectDb(id);
    return;
  }

  const projects = await readProjects(outDir);
  await writeProjects(outDir, projects.filter((project) => project.id !== id));
}

export async function syncProject(outDir: string, id: string): Promise<ProjectWithSites> {
  const project = await getProject(outDir, id);
  if (!project) throw new Error("Project not found.");
  const synced = await syncProjectSites(outDir, project);
  await upsertProject(outDir, synced);
  return (await getProjectWithSites(outDir, synced.id))!;
}

export async function updateProjectSite(
  outDir: string,
  projectId: string,
  leadId: string,
  patch: Partial<Pick<ProjectSite, "contractorStatus" | "estimatedInstallationDate" | "agreementFileUrl" | "agreementFileName">>
): Promise<ProjectWithSites> {
  const project = await getProject(outDir, projectId);
  if (!project) throw new Error("Project not found.");
  const sites = project.sites.map((site) => (site.leadId === leadId ? { ...site, ...cleanProjectSitePatch(patch) } : site));
  const next = { ...project, sites, updatedAt: new Date().toISOString() };
  await upsertProject(outDir, next);
  return (await getProjectWithSites(outDir, next.id))!;
}

export async function getContractorProject(outDir: string, token: string): Promise<ProjectWithSites | undefined> {
  const project = (await listProjects(outDir)).find((item) => item.contractorToken === token);
  if (!project) return undefined;
  const withSites = await getProjectWithSites(outDir, project.id);
  if (!withSites) return undefined;
  return {
    ...withSites,
    siteProfiles: withSites.siteProfiles.filter((site) => (site.lead?.review.status ?? "identified") === "registered")
  };
}

export async function updateContractorProjectSite(
  outDir: string,
  token: string,
  leadId: string,
  status: ContractorSiteStatus
): Promise<ProjectWithSites> {
  const project = (await listProjects(outDir)).find((item) => item.contractorToken === token);
  if (!project) throw new Error("Project not found.");
  return updateProjectSite(outDir, project.id, leadId, { contractorStatus: status });
}

async function syncProjectSites(outDir: string, project: Project): Promise<Project> {
  const existingByLeadId = new Map(project.sites.map((site) => [site.leadId, site]));
  const seenStableKeys = new Set<string>();
  const sites: ProjectSite[] = [];

  for (const run of await listSearchRuns(outDir)) {
    if (!run.summary) continue;
    const postcode = matchingPostcode(project.postCodes, run.postCodes);
    if (!postcode) continue;

    const reviewedSummary = await applyReviews(run.summary, outDir);
    for (const lead of reviewedSummary.leads) {
      const stableKey = stableLeadKey(lead);
      if (seenStableKeys.has(stableKey)) continue;
      seenStableKeys.add(stableKey);
      sites.push({
        leadId: lead.id,
        searchId: run.id,
        postcode,
        distanceMiles: lead.profile?.siteDetails.distanceFromPostcodeMiles ?? lead.site.distanceMiles,
        contractorStatus: existingByLeadId.get(lead.id)?.contractorStatus ?? "for_review",
        estimatedInstallationDate: existingByLeadId.get(lead.id)?.estimatedInstallationDate,
        agreementFileUrl: existingByLeadId.get(lead.id)?.agreementFileUrl,
        agreementFileName: existingByLeadId.get(lead.id)?.agreementFileName
      });
    }
  }

  return {
    ...project,
    sites,
    updatedAt: new Date().toISOString()
  };
}

async function resolveProjectSites(outDir: string, project: Project): Promise<ProjectSiteWithLead[]> {
  return Promise.all(
    project.sites.map(async (site) => {
      const search = await getSearchRun(outDir, site.searchId);
      const summary = search?.summary ? await applyReviews(search.summary, outDir) : undefined;
      return {
        ...site,
        lead: summary?.leads.find((lead) => lead.id === site.leadId)
      };
    })
  );
}

function matchingPostcode(projectPostCodes: string[], searchPostCodes: string[]): string | undefined {
  const projectSet = new Set(projectPostCodes.map(normalizePostcode));
  return searchPostCodes.find((postcode) => projectSet.has(normalizePostcode(postcode)));
}

function cleanPostCodes(postCodes: string[]): string[] {
  return [...new Set(postCodes.map((postcode) => postcode.trim().toUpperCase()).filter(Boolean))];
}

function cleanProjectSitePatch(
  patch: Partial<Pick<ProjectSite, "contractorStatus" | "estimatedInstallationDate" | "agreementFileUrl" | "agreementFileName">>
) {
  const clean: Partial<ProjectSite> = {};
  if (isContractorStatus(patch.contractorStatus)) clean.contractorStatus = patch.contractorStatus;
  const estimatedInstallationDate = stringValue(patch.estimatedInstallationDate);
  const agreementFileUrl = stringValue(patch.agreementFileUrl);
  const agreementFileName = stringValue(patch.agreementFileName);
  if (estimatedInstallationDate !== undefined) clean.estimatedInstallationDate = estimatedInstallationDate;
  if (agreementFileUrl !== undefined) clean.agreementFileUrl = agreementFileUrl;
  if (agreementFileName !== undefined) clean.agreementFileName = agreementFileName;
  return clean;
}

function isContractorStatus(value: unknown): value is ContractorSiteStatus {
  return value === "for_review" || value === "rejected" || value === "interested";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1000) : undefined;
}

function normalizePostcode(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

async function upsertProject(outDir: string, project: Project): Promise<void> {
  if (databaseEnabled()) {
    await upsertProjectDb(project);
    return;
  }

  const projects = await readProjects(outDir);
  await writeProjects(outDir, [project, ...projects.filter((item) => item.id !== project.id)]);
}

async function readProjects(outDir: string): Promise<Project[]> {
  try {
    return JSON.parse(await fs.readFile(projectsPath(outDir), "utf8")) as Project[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeProjects(outDir: string, projects: Project[]): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(projectsPath(outDir), `${JSON.stringify(projects, null, 2)}\n`, "utf8");
}

function projectsPath(outDir: string): string {
  return path.join(outDir, "projects.json");
}
