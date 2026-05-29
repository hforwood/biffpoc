import type { PlaceCandidate, SearchResult } from "./types.js";

export function mockPlaces(county: string): PlaceCandidate[] {
  return [
    {
      id: "mock-supermarket-1",
      name: `${county} Central Superstore`,
      address: `Retail Way, ${county}`,
      phoneNumber: "01234 567890",
      websiteUri: "https://example.com/superstore",
      googleMapsUri: "https://maps.google.com/?q=Kent+Central+Superstore",
      location: { latitude: 51.2787, longitude: 1.0806 },
      types: ["supermarket", "parking"],
      businessStatus: "OPERATIONAL",
      sourceQuery: `supermarket car parks in ${county}, UK`,
      spaceType: "supermarket car parks"
    },
    {
      id: "mock-retail-park-1",
      name: `${county} Riverside Retail Park`,
      address: `Riverside Road, ${county}`,
      phoneNumber: "01234 111222",
      websiteUri: "https://example.com/retail-park",
      googleMapsUri: "https://maps.google.com/?q=Kent+Riverside+Retail+Park",
      location: { latitude: 51.2872, longitude: 1.0761 },
      types: ["shopping_mall", "parking"],
      businessStatus: "OPERATIONAL",
      sourceQuery: `retail parks in ${county}, UK`,
      spaceType: "retail parks"
    },
    {
      id: "mock-pub-1",
      name: `The ${county} Arms`,
      address: `High Street, ${county}`,
      phoneNumber: "01234 333444",
      websiteUri: "https://example.com/pub",
      googleMapsUri: "https://maps.google.com/?q=The+Kent+Arms",
      location: { latitude: 51.2829, longitude: 1.0912 },
      types: ["bar", "restaurant", "parking"],
      businessStatus: "OPERATIONAL",
      sourceQuery: `pubs with large car parks in ${county}, UK`,
      spaceType: "pubs with large car parks"
    }
  ];
}

export function mockSearchResult(siteName: string): SearchResult {
  return {
    title: `${siteName} contact details`,
    link: "https://example.com",
    snippet: "Mock search result for local development.",
    source: "mock"
  };
}
