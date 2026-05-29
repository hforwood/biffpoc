import type { ApiConfig } from "../config.js";
import type { SearchResult } from "../types.js";
import { fetchJson } from "../utils/http.js";

interface GoogleCustomSearchResponse {
  items?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
}

export class GoogleSearchClient {
  constructor(private readonly config: ApiConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.googleCustomSearchApiKey && this.config.googleCustomSearchCx);
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    if (!this.enabled) return [];

    const params = new URLSearchParams({
      key: this.config.googleCustomSearchApiKey!,
      cx: this.config.googleCustomSearchCx!,
      q: query,
      num: String(Math.min(Math.max(limit, 1), 10)),
      gl: "uk",
      cr: "countryUK"
    });

    const response = await fetchJson<GoogleCustomSearchResponse>(
      `https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`,
      undefined,
      "Google Custom Search"
    );

    return (response.items ?? [])
      .filter((item) => item.link && item.title)
      .map((item) => ({
        title: item.title!,
        link: item.link!,
        snippet: item.snippet,
        source: "google-custom-search" as const
      }));
  }
}
