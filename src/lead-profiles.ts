import { createHmac } from "node:crypto";

import { readEnv } from "./config.js";
import { findLeadInSearchRuns, listSearchRuns, updateLeadInSearchRuns, type SearchRun } from "./search-runs.js";
import { updateReview } from "./storage.js";
import type { SiteLead, SiteProfile, SiteProfileDetails, SiteBusinessDetails, SiteOperationalDetails } from "./types.js";

export async function getLeadProfile(outDir: string, leadId: string): Promise<{ search: SearchRun; lead: SiteLead; ownerUrlPath: string }> {
  const found = await findLeadInSearchRuns(outDir, leadId);
  if (!found) throw new Error("Site not found.");
  return {
    ...found,
    ownerUrlPath: ownerFormPath(found.lead.id)
  };
}

export async function updateLeadProfile(
  outDir: string,
  leadId: string,
  input: unknown,
  updatedBy: SiteProfile["updatedBy"] = "admin"
): Promise<{ search: SearchRun; lead: SiteLead; ownerUrlPath: string }> {
  const patch = normalizeSiteProfilePatch(input);
  const result = await updateLeadInSearchRuns(outDir, leadId, (lead) => mergeLeadProfile(lead, patch, updatedBy));

  if (hasRegisteredProfile(result.lead.profile)) {
    const nextReview = await updateReview(outDir, result.lead.id, { status: "registered" });
    result.lead.review = nextReview;
  }

  return {
    ...result,
    ownerUrlPath: ownerFormPath(result.lead.id)
  };
}

export async function getOwnerProfileByToken(
  outDir: string,
  token: string
): Promise<{ search: SearchRun; lead: SiteLead }> {
  const found = await findLeadByOwnerToken(outDir, token);
  if (!found) throw new Error("Site owner form not found.");
  return found;
}

export async function updateOwnerProfileByToken(
  outDir: string,
  token: string,
  input: unknown
): Promise<{ search: SearchRun; lead: SiteLead }> {
  const found = await findLeadByOwnerToken(outDir, token);
  if (!found) throw new Error("Site owner form not found.");
  return updateLeadProfile(outDir, found.lead.id, input, "site_owner");
}

export function ownerFormPath(leadId: string): string {
  return `/site-owner.html?token=${ownerTokenForLead(leadId)}`;
}

export function ownerTokenForLead(leadId: string): string {
  const secret = readEnv("CRON_SECRET") ?? "biffpoc-owner-form";
  return createHmac("sha256", secret).update(leadId).digest("hex").slice(0, 40);
}

function normalizeSiteProfilePatch(input: unknown): SiteProfile {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  return {
    profile: normalizeProfileDetails(objectFrom(source.profile)),
    business: normalizeBusinessDetails(objectFrom(source.business)),
    siteDetails: normalizeOperationalDetails(objectFrom(source.siteDetails))
  };
}

function mergeLeadProfile(lead: SiteLead, patch: SiteProfile, updatedBy: SiteProfile["updatedBy"]): SiteLead {
  const profile: SiteProfile = {
    profile: {
      ...profileDefaults(lead),
      ...lead.profile?.profile,
      ...patch.profile
    },
    business: {
      ...lead.profile?.business,
      ...patch.business
    },
    siteDetails: {
      ...lead.profile?.siteDetails,
      ...patch.siteDetails
    },
    updatedAt: new Date().toISOString(),
    updatedBy
  };

  return {
    ...lead,
    site: {
      ...lead.site,
      name: profile.profile.siteName || lead.site.name,
      websiteUri: profile.profile.siteWebsite || lead.site.websiteUri,
      address: profile.profile.siteAddress || lead.site.address,
      phoneNumber: profile.profile.sitePhoneNumber || lead.site.phoneNumber
    },
    contact: {
      ...lead.contact,
      emailAddress: profile.profile.siteContactEmail || lead.contact.emailAddress,
      phoneNumber: profile.profile.sitePhoneNumber || lead.contact.phoneNumber,
      contactFormUrl: profile.profile.contactForm || lead.contact.contactFormUrl
    },
    profile
  };
}

function profileDefaults(lead: SiteLead): SiteProfileDetails {
  return {
    siteName: lead.site.name,
    siteWebsite: lead.site.websiteUri,
    siteContactEmail: lead.contact.emailAddress,
    sitePhoneNumber: lead.contact.phoneNumber,
    siteAddress: lead.site.address,
    contactForm: lead.contact.contactFormUrl
  };
}

function normalizeProfileDetails(input: Record<string, unknown>): SiteProfileDetails {
  return {
    siteName: stringValue(input.siteName),
    siteWebsite: stringValue(input.siteWebsite),
    siteContactEmail: stringValue(input.siteContactEmail),
    sitePhoneNumber: stringValue(input.sitePhoneNumber),
    siteAddress: stringValue(input.siteAddress),
    contactForm: stringValue(input.contactForm)
  };
}

function normalizeBusinessDetails(input: Record<string, unknown>): SiteBusinessDetails {
  return {
    mainContactFullName: stringValue(input.mainContactFullName),
    mainContactEmail: stringValue(input.mainContactEmail),
    mainContactPhoneNumber: stringValue(input.mainContactPhoneNumber),
    organisationType: stringValue(input.organisationType),
    registeredAddress: stringValue(input.registeredAddress),
    registryId: stringValue(input.registryId),
    registeredName: stringValue(input.registeredName)
  };
}

function normalizeOperationalDetails(input: Record<string, unknown>): SiteOperationalDetails {
  return {
    gateHasCombinationLock: booleanValue(input.gateHasCombinationLock),
    concreteNeedsBuilding: booleanValue(input.concreteNeedsBuilding),
    signedAgreement: booleanValue(input.signedAgreement),
    agreementStartDate: stringValue(input.agreementStartDate),
    agreementEndDate: stringValue(input.agreementEndDate),
    breakClauseDate: stringValue(input.breakClauseDate),
    accessSchedule: stringValue(input.accessSchedule),
    gatedExternal: stringValue(input.gatedExternal),
    cctvOnSite: booleanValue(input.cctvOnSite),
    additionalSiteNotes: stringValue(input.additionalSiteNotes),
    distanceFromPostcodeMiles: numberValue(input.distanceFromPostcodeMiles),
    estimatedDriveMinutes: numberValue(input.estimatedDriveMinutes),
    roughLockerPlacement: stringValue(input.roughLockerPlacement),
    mediaUrls: arrayOfStrings(input.mediaUrls),
    agreementFileUrl: stringValue(input.agreementFileUrl),
    agreementFileName: stringValue(input.agreementFileName)
  };
}

async function findLeadByOwnerToken(outDir: string, token: string): Promise<{ search: SearchRun; lead: SiteLead } | undefined> {
  const runs = await listSearchRuns(outDir);
  for (const search of runs) {
    for (const lead of search.summary?.leads ?? []) {
      if (ownerTokenForLead(lead.id) === token) return { search, lead };
    }
  }
  return undefined;
}

function hasRegisteredProfile(profile: SiteProfile | undefined): boolean {
  if (!profile) return false;
  if (profile.updatedBy === "site_owner") return true;
  return [
    profile.profile.siteContactEmail,
    profile.profile.sitePhoneNumber,
    profile.profile.contactForm,
    profile.business.mainContactFullName,
    profile.business.mainContactEmail,
    profile.business.mainContactPhoneNumber,
    profile.business.registeredName,
    profile.business.registryId,
    profile.siteDetails.accessSchedule,
    profile.siteDetails.additionalSiteNotes,
    profile.siteDetails.roughLockerPlacement,
    profile.siteDetails.mediaUrls?.join(""),
    profile.siteDetails.signedAgreement === true ? "signed" : ""
  ].some((value) => Boolean(String(value ?? "").trim()));
}

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 5000) : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  return undefined;
}
