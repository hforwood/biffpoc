import path from "node:path";
import { randomUUID } from "node:crypto";

import { getApiConfig } from "./config.js";
import { buildSiteAnalysis, heuristicDeadSpace } from "./analyzer/capacity.js";
import { analyzeWithAi } from "./analyzer/ai.js";
import { GoogleSearchClient } from "./clients/google-search.js";
import { FirecrawlClient } from "./clients/firecrawl.js";
import { GoogleMapsClient } from "./clients/google-maps.js";
import { loadAiFeedbackMemory } from "./feedback-memory.js";
import { mockPlaces, mockSearchResult } from "./mock-data.js";
import { analyzeSiteCriteria } from "./site-criteria.js";
import { writeMapSnapshots } from "./snapshots.js";
import type { ContactInfo, PlaceCandidate, ScanOptions, ScanSummary, ScrapedPage, SearchResult, SiteLead, StaticMapContext } from "./types.js";
import { slugify, uniqueBy } from "./utils/text.js";
import { writeReports } from "./report.js";

export async function runScan(options: ScanOptions): Promise<ScanSummary> {
  const config = getApiConfig();
  const searchClient = new GoogleSearchClient(config);
  const firecrawlClient = new FirecrawlClient(config);
  const mapsClient = new GoogleMapsClient(config);
  const feedbackMemory = await loadAiFeedbackMemory(path.resolve(options.outDir));

  const places = options.mock
    ? mockPlaces(options.area || options.county)
    : await discoverPlaces(options, mapsClient, searchClient);

  const deduped = uniqueBy(places, candidateKey).slice(0, options.maxSites);

  const leads: SiteLead[] = [];
  for (const place of deduped) {
    const searchResults = options.mock
      ? [mockSearchResult(place.name)]
      : await searchSupportingPages(options.area, place, searchClient);

    const scrapedPages = await scrapeSupportingPages(place, searchResults, firecrawlClient, options.mock);
    const staticMap = place.location
      ? await mapsClient.getStaticMapContext(place.location, options.mapsZoom, options.mapsSize, 2, !options.mock)
      : undefined;
    const criteria = await analyzeSiteCriteria({
      config,
      site: place,
      staticMap,
      mock: options.mock
    });

    const aiResult =
      options.useAi && !options.mock
        ? await safeAiAnalysis(config, place, staticMap, feedbackMemory)
        : undefined;

    const deadSpaceCandidates = aiResult?.candidates?.length
      ? aiResult.candidates
      : heuristicDeadSpace(place.spaceType, place.types);

    const notes = [
      ...(aiResult?.notes ?? []),
      ...(aiResult ? [] : ["Heuristic estimate: validate with manual satellite review and site visit."])
    ];
    const analysis = buildSiteAnalysis(deadSpaceCandidates, aiResult ? "ai" : "heuristic", notes);
    const leadId = leadIdFor(place);
    const snapshots = await writeMapSnapshots({
      leadId,
      site: place,
      staticMap,
      candidates: analysis.deadSpaceCandidates,
      outDir: path.resolve(options.outDir)
    });

    leads.push({
      id: leadId,
      site: mergeScrapedPhone(place, scrapedPages),
      contact: buildContactInfo(place, scrapedPages, searchResults),
      searchResults,
      scrapedPages,
      criteria,
      staticMap: staticMapForStorage(staticMap),
      snapshots,
      analysis,
      review: {
        status: "identified"
      }
    });
  }

  const summary = buildSummary(options, leads);
  await writeReports(summary, path.resolve(options.outDir));
  return summary;
}

async function discoverPlaces(
  options: ScanOptions,
  mapsClient: GoogleMapsClient,
  searchClient: GoogleSearchClient
): Promise<PlaceCandidate[]> {
  if (!mapsClient.enabled) {
    throw new Error("GOOGLE_MAPS_API_KEY is required for real scans. Use --mock for local demo data.");
  }

  const origin = await safeGeocodeArea(mapsClient, options.area);
  const radiusContext = origin
    ? {
        center: origin.location,
        radiusMiles: options.radiusMiles
      }
    : undefined;
  const allPlaces: PlaceCandidate[] = [];
  for (const spaceType of options.spaceTypes) {
    if (searchClient.enabled) {
      const searchQuery = `${spaceType} ${options.area} UK address phone`;
      const searchResults = await searchClient.search(searchQuery, options.limitPerType);

      for (const result of searchResults) {
        const titleQuery = origin ? result.title : `${result.title} ${options.area}, UK`;
        allPlaces.push(...(await mapsClient.textSearch(titleQuery, spaceType, 1, radiusContext)));
      }
    }

    const placesQuery = origin ? spaceType : `${spaceType} in ${options.area}, UK`;
    allPlaces.push(...(await mapsClient.textSearch(placesQuery, spaceType, options.limitPerType, radiusContext)));
    if (uniqueBy(allPlaces, candidateKey).length >= options.maxSites) break;
  }

  return allPlaces;
}

function candidateKey(place: PlaceCandidate): string {
  return place.id ?? `${place.name}:${place.address ?? ""}`;
}

async function safeGeocodeArea(
  mapsClient: GoogleMapsClient,
  area: string
): Promise<{ formattedAddress?: string; location: { latitude: number; longitude: number } } | undefined> {
  try {
    return await mapsClient.geocodeArea(area);
  } catch (error) {
    console.warn(
      `Google geocoding failed for "${area}". Continuing without radius enforcement: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

async function searchSupportingPages(
  county: string,
  place: PlaceCandidate,
  searchClient: GoogleSearchClient
): Promise<SearchResult[]> {
  const queries = [
    `"${place.name}" "${county}" contact address phone`,
    `${place.spaceType} "${place.name}" "${county}"`
  ];

  const results: SearchResult[] = [];
  for (const query of queries) {
    results.push(...(await searchClient.search(query, 3)));
  }

  return uniqueBy(results, (result) => result.link).slice(0, 5);
}

async function scrapeSupportingPages(
  place: PlaceCandidate,
  searchResults: SearchResult[],
  firecrawlClient: FirecrawlClient,
  mock: boolean
): Promise<ScrapedPage[]> {
  if (mock) {
    return [
      {
        url: place.websiteUri ?? "https://example.com",
        title: place.name,
        markdown: `# ${place.name}\nPhone: ${place.phoneNumber ?? "01234 567890"}\nEmail: contact@example.com\n[Contact us](https://example.com/contact)`,
        phoneNumbers: place.phoneNumber ? [place.phoneNumber] : [],
        emailAddresses: ["contact@example.com"],
        contactFormUrls: ["https://example.com/contact"],
        source: "mock"
      }
    ];
  }

  const urls = uniqueBy(
    [
      place.websiteUri,
      ...guessedContactUrls(place.websiteUri),
      ...searchResults.map((result) => result.link)
    ].filter((url): url is string => Boolean(url)),
    (url) => url
  ).slice(0, 6);

  const pages: ScrapedPage[] = [];
  for (const url of urls) {
    try {
      pages.push(await firecrawlClient.scrape(url));
    } catch (error) {
      pages.push({
        url,
        phoneNumbers: [],
        emailAddresses: [],
        contactFormUrls: contactUrlFrom(url) ? [url] : [],
        source: "skipped",
        markdown: error instanceof Error ? error.message : "Scrape failed"
      });
    }
  }

  return pages;
}

async function safeAiAnalysis(
  config: ReturnType<typeof getApiConfig>,
  place: PlaceCandidate,
  staticMap: SiteLead["staticMap"],
  feedbackMemory: string[]
): ReturnType<typeof analyzeWithAi> {
  try {
    return await analyzeWithAi(config, place, staticMap, feedbackMemory);
  } catch (error) {
    console.warn(`AI analysis failed for "${place.name}": ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function staticMapForStorage(staticMap: StaticMapContext | undefined): StaticMapContext | undefined {
  if (!staticMap) return undefined;
  const { imageBase64: _imageBase64, ...metadata } = staticMap;
  return metadata;
}

function mergeScrapedPhone(place: PlaceCandidate, scrapedPages: ScrapedPage[]): PlaceCandidate {
  if (place.phoneNumber) return place;

  const phoneNumber = scrapedPages.flatMap((page) => page.phoneNumbers)[0];
  return {
    ...place,
    phoneNumber
  };
}

function buildContactInfo(
  place: PlaceCandidate,
  scrapedPages: ScrapedPage[],
  searchResults: SearchResult[]
): ContactInfo {
  const phoneNumber = place.phoneNumber ?? scrapedPages.flatMap((page) => page.phoneNumbers)[0];
  const emailAddress = scrapedPages.flatMap((page) => page.emailAddresses)[0];
  const scrapedContactFormUrl = scrapedPages.flatMap((page) => page.contactFormUrls)[0];
  const searchContactFormUrl = searchResults.find((result) => contactUrlFrom(result.link))?.link;
  const fallbackContactFormUrl = !phoneNumber || !emailAddress ? guessedContactUrl(place.websiteUri) : undefined;
  const contactFormUrl = scrapedContactFormUrl ?? searchContactFormUrl ?? fallbackContactFormUrl;

  return {
    phoneNumber,
    emailAddress,
    contactFormUrl,
    sourceUrls: uniqueBy(
      [
        place.websiteUri,
        contactFormUrl,
        ...scrapedPages.map((page) => page.url),
        ...searchResults.map((result) => result.link)
      ].filter((url): url is string => Boolean(url)),
      (url) => url
    )
  };
}

function contactUrlFrom(url: string): boolean {
  return /contact|enquir|booking|visit|get-in-touch|support/i.test(url);
}

function guessedContactUrl(websiteUri?: string): string | undefined {
  return guessedContactUrls(websiteUri)[0];
}

function guessedContactUrls(websiteUri?: string): string[] {
  if (!websiteUri) return [];
  try {
    const base = new URL(websiteUri);
    return ["/contact", "/contact-us", "/about", "/find-us", "/get-in-touch", "/contacts"].map((pathname) => {
      const url = new URL(base);
      url.pathname = pathname;
      url.search = "";
      url.hash = "";
      return url.toString();
    });
  } catch {
    return [];
  }
}

function buildSummary(options: ScanOptions, leads: SiteLead[]): ScanSummary {
  return {
    county: options.county,
    generatedAt: new Date().toISOString(),
    options: {
      ...options,
      spaceTypes: options.spaceTypes
    },
    leads,
    totals: {
      sites: leads.length,
      totalModules: leads.reduce((sum, lead) => sum + lead.analysis.totalModules, 0),
      totalRevenueYear: leads.reduce((sum, lead) => sum + lead.analysis.totalRevenueYear, 0),
      paidToSpaceOwnerYear: leads.reduce((sum, lead) => sum + lead.analysis.paidToSpaceOwnerYear, 0),
      biffenRevenueYear: leads.reduce((sum, lead) => sum + lead.analysis.biffenRevenueYear, 0)
    }
  };
}

function leadIdFor(place: PlaceCandidate): string {
  return slugify(`${place.id ?? place.name}-${place.address ?? place.sourceQuery}`) || randomUUID();
}
