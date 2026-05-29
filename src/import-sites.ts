import { randomUUID } from "node:crypto";

import { buildSiteAnalysis, heuristicDeadSpace } from "./analyzer/capacity.js";
import { FirecrawlClient } from "./clients/firecrawl.js";
import { GoogleMapsClient } from "./clients/google-maps.js";
import { getApiConfig } from "./config.js";
import { analyzeSiteCriteria } from "./site-criteria.js";
import { getSearchRun, totalsFor, upsertSearchRun, type SearchRun } from "./search-runs.js";
import type { ContactInfo, PlaceCandidate, ScanSummary, ScrapedPage, SiteLead } from "./types.js";
import { stableLeadKey } from "./utils/stable-key.js";
import { slugify, uniqueBy } from "./utils/text.js";

export type ImportSiteRow = Record<string, unknown>;

export async function importSitesIntoSearch(
  outDir: string,
  searchId: string,
  rows: ImportSiteRow[],
  options: { useAi?: boolean; mock?: boolean } = {}
): Promise<SearchRun> {
  const run = await getSearchRun(outDir, searchId);
  if (!run) throw new Error("Search not found.");

  const running: SearchRun = {
    ...run,
    status: "running",
    updatedAt: new Date().toISOString(),
    error: undefined
  };
  await upsertSearchRun(outDir, running);

  try {
    const config = getApiConfig();
    const mapsClient = new GoogleMapsClient(config);
    const firecrawlClient = new FirecrawlClient(config);
    const existingLeads = running.summary?.leads ?? [];
    const seen = new Set(existingLeads.map(stableLeadKey));
    const imported: SiteLead[] = [];

    for (const row of rows.slice(0, 250)) {
      const lead = await rowToLead({
        row,
        config,
        mapsClient,
        firecrawlClient,
        useAi: options.useAi ?? true,
        mock: Boolean(options.mock)
      });
      if (!lead) continue;

      const key = stableLeadKey(lead);
      if (seen.has(key)) continue;
      seen.add(key);
      imported.push(lead);
    }

    const leads = [...existingLeads, ...imported];
    const summary: ScanSummary = {
      ...(running.summary ?? emptySummary(running)),
      generatedAt: new Date().toISOString(),
      leads,
      totals: totalsFor(leads)
    };
    const completed: SearchRun = {
      ...running,
      status: "completed",
      updatedAt: new Date().toISOString(),
      error: imported.length === 0 ? "No new non-duplicate uploaded sites were added." : undefined,
      summary
    };
    await upsertSearchRun(outDir, completed);
    return completed;
  } catch (error) {
    const failed: SearchRun = {
      ...running,
      status: "error",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
    await upsertSearchRun(outDir, failed);
    return failed;
  }
}

async function rowToLead(params: {
  row: ImportSiteRow;
  config: ReturnType<typeof getApiConfig>;
  mapsClient: GoogleMapsClient;
  firecrawlClient: FirecrawlClient;
  useAi: boolean;
  mock: boolean;
}): Promise<SiteLead | undefined> {
  const source = normalizeRow(params.row);
  const name = source.siteName;
  if (!name) return undefined;

  const place = await resolvePlace(source, params.mapsClient);
  const scrapedPages = await scrapeImportedSite(source.website || place.websiteUri, params.firecrawlClient, params.mock);
  const staticMap = place.location
    ? await params.mapsClient.getStaticMapContext(place.location, 20, 640, 2, params.useAi && !params.mock)
    : undefined;
  const criteria = await analyzeSiteCriteria({
    config: params.config,
    site: place,
    staticMap,
    mock: params.mock || !params.useAi
  });
  const analysis = buildSiteAnalysis(
    heuristicDeadSpace(place.spaceType, place.types),
    "heuristic",
    ["Uploaded site: revenue and site score use heuristic sizing; map criteria are stored separately."]
  );

  return {
    id: `import-${slugify(`${place.name}-${place.address ?? place.googleMapsUri ?? randomUUID()}`) || randomUUID()}`,
    site: place,
    contact: buildImportedContact(source, place, scrapedPages),
    searchResults: [],
    scrapedPages,
    criteria,
    staticMap: staticMap ? staticMapForStorage(staticMap) : undefined,
    analysis,
    review: {
      status: "identified"
    }
  };
}

async function resolvePlace(source: NormalizedImportRow, mapsClient: GoogleMapsClient): Promise<PlaceCandidate> {
  const uploadedLocation = source.latitude !== undefined && source.longitude !== undefined
    ? { latitude: source.latitude, longitude: source.longitude }
    : locationFromMapsUrl(source.googleMapsUri);

  const fallback: PlaceCandidate = {
    name: source.siteName,
    address: source.address,
    phoneNumber: source.phone,
    websiteUri: source.website,
    googleMapsUri: source.googleMapsUri,
    location: uploadedLocation,
    types: [],
    sourceQuery: "uploaded site data",
    spaceType: source.siteType || "uploaded site"
  };

  if (!mapsClient.enabled) return fallback;

  const query = [source.siteName, source.address].filter(Boolean).join(" ");
  if (!query) return fallback;

  const matches = await mapsClient.textSearch(query, source.siteType || "uploaded site", 1);
  const match = matches[0];
  if (!match) return fallback;

  return {
    ...fallback,
    ...match,
    phoneNumber: source.phone || match.phoneNumber,
    websiteUri: source.website || match.websiteUri,
    googleMapsUri: source.googleMapsUri || match.googleMapsUri,
    location: uploadedLocation || match.location,
    spaceType: source.siteType || match.spaceType
  };
}

async function scrapeImportedSite(
  website: string | undefined,
  firecrawlClient: FirecrawlClient,
  mock: boolean
): Promise<ScrapedPage[]> {
  if (mock) {
    return [
      {
        url: website ?? "https://example.com",
        title: "Uploaded site",
        markdown: "Email: contact@example.com\nPhone: 01234 567890",
        phoneNumbers: ["01234 567890"],
        emailAddresses: ["contact@example.com"],
        contactFormUrls: contactUrl(website) ? [contactUrl(website)!] : [],
        source: "mock"
      }
    ];
  }

  const urls = guessedContactUrls(website).slice(0, 6);
  const pages: ScrapedPage[] = [];
  for (const url of urls) {
    try {
      pages.push(await firecrawlClient.scrape(url));
    } catch (error) {
      pages.push({
        url,
        phoneNumbers: [],
        emailAddresses: [],
        contactFormUrls: contactUrlPattern.test(url) ? [url] : [],
        markdown: error instanceof Error ? error.message : "Scrape failed",
        source: "skipped"
      });
    }
  }
  return pages;
}

function buildImportedContact(
  source: NormalizedImportRow,
  place: PlaceCandidate,
  scrapedPages: ScrapedPage[]
): ContactInfo {
  const phoneNumber = source.phone || place.phoneNumber || scrapedPages.flatMap((page) => page.phoneNumbers)[0];
  const emailAddress = source.email || scrapedPages.flatMap((page) => page.emailAddresses)[0];
  const contactFormUrl =
    source.contactFormUrl ||
    scrapedPages.flatMap((page) => page.contactFormUrls)[0] ||
    (!phoneNumber || !emailAddress ? contactUrl(place.websiteUri || source.website) : undefined);

  return {
    phoneNumber,
    emailAddress,
    contactFormUrl,
    sourceUrls: uniqueBy(
      [source.website, place.websiteUri, contactFormUrl, ...scrapedPages.map((page) => page.url)].filter(
        (url): url is string => Boolean(url)
      ),
      (url) => url
    )
  };
}

interface NormalizedImportRow {
  siteName: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  contactFormUrl?: string;
  siteType?: string;
  googleMapsUri?: string;
  latitude?: number;
  longitude?: number;
}

function normalizeRow(row: ImportSiteRow): NormalizedImportRow {
  return {
    siteName: pick(row, ["site_name", "site name", "name", "site"]),
    address: optional(pick(row, ["address", "site_address", "site address"])),
    website: normalizeWebsite(optional(pick(row, ["website", "website_url", "url", "site_url"]))),
    phone: optional(pick(row, ["phone", "phone_number", "phone number", "telephone"])),
    email: optional(pick(row, ["email", "e-mail", "email_address", "email address"])),
    contactFormUrl: normalizeWebsite(optional(pick(row, ["contact_form_url", "contact form url", "contact_form", "contact form"]))),
    siteType: optional(pick(row, ["site_type", "site type", "space_type", "space type", "type"])),
    googleMapsUri: normalizeWebsite(optional(pick(row, ["google_maps_url", "google maps url", "google_maps_uri", "google maps uri", "maps_url"]))),
    latitude: numberFrom(pick(row, ["latitude", "lat"])),
    longitude: numberFrom(pick(row, ["longitude", "lng", "lon"]))
  };
}

function pick(row: ImportSiteRow, keys: string[]): string {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])
  );

  for (const key of keys) {
    const value = normalized.get(normalizeHeader(key));
    if (value !== undefined && value !== null) return String(value).trim();
  }

  return "";
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function optional(value: string): string | undefined {
  return value.trim() ? value.trim() : undefined;
}

function numberFrom(value: string): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeWebsite(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    try {
      return new URL(`https://${value}`).toString();
    } catch {
      return value;
    }
  }
}

function guessedContactUrls(website?: string): string[] {
  if (!website) return [];
  try {
    const base = new URL(website);
    return ["", "/contact", "/contact-us", "/about", "/find-us", "/get-in-touch"].map((pathname) => {
      const url = new URL(base);
      if (pathname) url.pathname = pathname;
      url.search = "";
      url.hash = "";
      return url.toString();
    });
  } catch {
    return [website];
  }
}

function contactUrl(website?: string): string | undefined {
  return guessedContactUrls(website).find((url) => contactUrlPattern.test(url));
}

function locationFromMapsUrl(url?: string): { latitude: number; longitude: number } | undefined {
  if (!url) return undefined;
  const decoded = decodeURIComponent(url);
  const match =
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(decoded) ??
    /[?&]query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(decoded);
  if (!match) return undefined;

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined;
}

function staticMapForStorage(staticMap: NonNullable<SiteLead["staticMap"]>): NonNullable<SiteLead["staticMap"]> {
  const { imageBase64: _imageBase64, ...metadata } = staticMap;
  return metadata;
}

function emptySummary(run: SearchRun): ScanSummary {
  return {
    county: run.name,
    generatedAt: new Date().toISOString(),
    options: {
      county: run.name,
      area: run.name,
      radiusMiles: run.radiusMiles,
      spaceTypes: run.request?.spaceTypes ?? [],
      limitPerType: run.request?.limitPerType ?? 2,
      maxSites: 0,
      outDir: "",
      useAi: run.request?.useAi ?? true,
      mock: run.request?.mock ?? false,
      mapsZoom: 20,
      mapsSize: 640
    },
    leads: [],
    totals: totalsFor([])
  };
}

const contactUrlPattern = /contact|enquir|booking|visit|get-in-touch|support/i;
