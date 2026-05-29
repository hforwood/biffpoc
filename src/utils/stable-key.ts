import type { SiteLead } from "../types.js";

export function stableLeadKey(lead: SiteLead): string {
  const site = lead.site;
  const location =
    site.location && Number.isFinite(site.location.latitude) && Number.isFinite(site.location.longitude)
      ? `${site.location.latitude.toFixed(6)},${site.location.longitude.toFixed(6)}`
      : "";

  return normalizeKey(
    site.id ||
      site.googleMapsUri ||
      [site.name, site.address, location, site.spaceType].filter(Boolean).join("|") ||
      lead.id
  );
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
