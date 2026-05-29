import type { ApiConfig } from "../config.js";
import type { ScrapedPage } from "../types.js";
import { fetchJson } from "../utils/http.js";

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      sourceURL?: string;
    };
  };
}

const UK_PHONE_PATTERN = /(?:\+44\s?|0)(?:\d[\s().-]?){9,10}\d/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s)"'>]+/gi;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*?(?:contact|enquir|booking|visit)[^\]]*?\]\(([^)]+)\)/gi;

export class FirecrawlClient {
  constructor(private readonly config: ApiConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.firecrawlApiKey);
  }

  async scrape(url: string): Promise<ScrapedPage> {
    if (!this.enabled) {
      return {
        url,
        phoneNumbers: [],
        emailAddresses: [],
        contactFormUrls: [],
        source: "skipped"
      };
    }

    const response = await fetchJson<FirecrawlScrapeResponse>(
      "https://api.firecrawl.dev/v2/scrape",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.firecrawlApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          onlyMainContent: true,
          removeBase64Images: true,
          blockAds: true,
          timeout: 30000
        })
      },
      "Firecrawl scrape"
    );

    const markdown = response.data?.markdown ?? "";

    return {
      url: response.data?.metadata?.sourceURL ?? url,
      title: response.data?.metadata?.title,
      markdown,
      phoneNumbers: extractPhoneNumbers(markdown),
      emailAddresses: extractEmailAddresses(markdown),
      contactFormUrls: extractContactFormUrls(markdown, url),
      source: "firecrawl"
    };
  }
}

export function extractPhoneNumbers(text: string): string[] {
  return [...new Set(text.match(UK_PHONE_PATTERN) ?? [])].map((phone) => phone.trim());
}

export function extractEmailAddresses(text: string): string[] {
  return [...new Set(text.match(EMAIL_PATTERN) ?? [])]
    .map((email) => email.trim().replace(/^mailto:/i, ""))
    .filter((email) => !email.toLowerCase().endsWith(".png") && !email.toLowerCase().endsWith(".jpg"));
}

export function extractContactFormUrls(text: string, baseUrl: string): string[] {
  const candidates = new Set<string>();

  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    const rawUrl = match[1];
    if (rawUrl) candidates.add(normalizeUrl(rawUrl, baseUrl));
  }

  for (const rawUrl of text.match(URL_PATTERN) ?? []) {
    if (/contact|enquir|booking|visit|support|get-in-touch/i.test(rawUrl)) {
      candidates.add(normalizeUrl(rawUrl, baseUrl));
    }
  }

  if (/contact|enquir|get-in-touch/i.test(baseUrl)) {
    candidates.add(baseUrl);
  }

  return [...candidates].filter(Boolean);
}

function normalizeUrl(rawUrl: string, baseUrl: string): string {
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return "";
  }
}
