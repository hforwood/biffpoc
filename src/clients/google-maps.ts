import type { ApiConfig } from "../config.js";
import type { PlaceCandidate, PlaceLocation, StaticMapContext } from "../types.js";
import { fetchBinary, fetchJson } from "../utils/http.js";

interface PlacesTextSearchResponse {
  places?: GooglePlace[];
}

interface GeocodeResponse {
  results?: Array<{
    formattedAddress?: string;
    location?: {
      latitude?: number;
      longitude?: number;
    };
  }>;
}

interface GooglePlace {
  id?: string;
  displayName?: {
    text?: string;
  };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  types?: string[];
  businessStatus?: string;
}

export class GoogleMapsClient {
  constructor(private readonly config: ApiConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.googleMapsApiKey);
  }

  async geocodeArea(area: string): Promise<{ formattedAddress?: string; location: PlaceLocation } | undefined> {
    if (!this.enabled) return undefined;

    const address = encodeURIComponent(`${area}, UK`);
    const response = await fetchJson<GeocodeResponse>(
      `https://geocode.googleapis.com/v4/geocode/address/${address}`,
      {
        headers: {
          "X-Goog-Api-Key": this.config.googleMapsApiKey!,
          "X-Goog-FieldMask": "results.formattedAddress,results.location"
        }
      },
      "Google Geocoding"
    );

    const result = response.results?.find(
      (item) => typeof item.location?.latitude === "number" && typeof item.location?.longitude === "number"
    );

    if (!result?.location || typeof result.location.latitude !== "number" || typeof result.location.longitude !== "number") {
      return undefined;
    }

    return {
      formattedAddress: result.formattedAddress,
      location: {
        latitude: result.location.latitude,
        longitude: result.location.longitude
      }
    };
  }

  async textSearch(
    textQuery: string,
    spaceType: string,
    limit = 5,
    origin?: { center: PlaceLocation; radiusMiles?: number }
  ): Promise<PlaceCandidate[]> {
    if (!this.enabled) return [];

    const body: Record<string, unknown> = {
      textQuery,
      pageSize: Math.min(Math.max(limit, 1), 20),
      regionCode: "GB",
      languageCode: "en-GB"
    };

    if (origin?.center) {
      const radiusMeters = milesToMeters(origin.radiusMiles ?? 10);
      body.locationBias = {
        circle: {
          center: origin.center,
          radius: Math.min(Math.max(radiusMeters, 1), 50000)
        }
      };
    }

    const response = await fetchJson<PlacesTextSearchResponse>(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.config.googleMapsApiKey!,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.nationalPhoneNumber",
            "places.internationalPhoneNumber",
            "places.websiteUri",
            "places.googleMapsUri",
            "places.location",
            "places.types",
            "places.businessStatus"
          ].join(",")
        },
        body: JSON.stringify(body)
      },
      "Google Places Text Search"
    );

    const places = (response.places ?? []).map((place) => {
      const location =
        typeof place.location?.latitude === "number" && typeof place.location?.longitude === "number"
          ? {
              latitude: place.location.latitude,
              longitude: place.location.longitude
            }
          : undefined;
      const distanceMiles = origin?.center && location ? distanceBetweenMiles(origin.center, location) : undefined;

      return {
        id: place.id,
        name: place.displayName?.text ?? "Unknown site",
        address: place.formattedAddress,
        phoneNumber: place.nationalPhoneNumber ?? place.internationalPhoneNumber,
        websiteUri: place.websiteUri,
        googleMapsUri: place.googleMapsUri,
        location,
        distanceMiles,
        types: place.types ?? [],
        businessStatus: place.businessStatus,
        sourceQuery: textQuery,
        spaceType
      };
    });

    if (!origin?.radiusMiles) return places;

    return places.filter((place) => place.distanceMiles === undefined || place.distanceMiles <= origin.radiusMiles!);
  }

  staticMapUrl(location: PlaceLocation, zoom = 20, cssSizePx = 640, scale: 1 | 2 = 2): string | undefined {
    if (!this.enabled) return undefined;

    const params = new URLSearchParams({
      center: `${location.latitude},${location.longitude}`,
      zoom: String(zoom),
      size: `${cssSizePx}x${cssSizePx}`,
      scale: String(scale),
      maptype: "satellite",
      key: this.config.googleMapsApiKey!
    });

    return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  }

  async getStaticMapContext(
    location: PlaceLocation,
    zoom = 20,
    cssSizePx = 640,
    scale: 1 | 2 = 2,
    includeImage = false
  ): Promise<StaticMapContext | undefined> {
    const url = this.staticMapUrl(location, zoom, cssSizePx, scale);
    if (!url) return undefined;

    const metersPerCssPixel = metersPerPixel(location.latitude, zoom);
    const context: StaticMapContext = {
      url,
      center: location,
      zoom,
      cssSizePx,
      scale,
      widthMeters: cssSizePx * metersPerCssPixel,
      heightMeters: cssSizePx * metersPerCssPixel,
      metersPerCssPixel,
      metersPerReturnedPixel: metersPerCssPixel / scale
    };

    if (includeImage) {
      const image = await fetchBinary(url, undefined, "Google Static Maps");
      context.imageBase64 = image.data.toString("base64");
      context.contentType = image.contentType;
    }

    return context;
  }
}

export function metersPerPixel(latitude: number, zoom: number): number {
  const latitudeRadians = (latitude * Math.PI) / 180;
  return (156543.03392 * Math.cos(latitudeRadians)) / 2 ** zoom;
}

export function milesToMeters(miles: number): number {
  return miles * 1609.344;
}

export function distanceBetweenMiles(a: PlaceLocation, b: PlaceLocation): number {
  const earthRadiusMiles = 3958.7613;
  const dLat = degreesToRadians(b.latitude - a.latitude);
  const dLon = degreesToRadians(b.longitude - a.longitude);
  const lat1 = degreesToRadians(a.latitude);
  const lat2 = degreesToRadians(b.latitude);

  const haversine =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine));
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
