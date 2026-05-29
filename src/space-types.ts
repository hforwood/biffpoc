export const SPACE_TYPES = [
  "petrol stations / forecourts",
  "supermarket car parks",
  "retail parks",
  "leisure centres",
  "sports clubs",
  "council car parks",
  "park & ride sites",
  "business parks",
  "office parks",
  "industrial estates",
  "hotels",
  "garden centres",
  "pubs with large car parks",
  "cinemas",
  "bowling alleys",
  "DIY / trade stores",
  "schools",
  "colleges",
  "universities",
  "hospitals / NHS estates",
  "churches",
  "community centres",
  "stadiums",
  "racecourses",
  "former car dealerships",
  "abandoned or low-use shopping centres",
  "car washes",
  "tyre centres",
  "MOT garages",
  "farm shops",
  "village halls",
  "train station car parks",
  "airport parking sites",
  "coach depots",
  "bus depots",
  "logistics yards",
  "self-storage facilities",
  "builder's merchants",
  "golf clubs",
  "tennis clubs",
  "cricket clubs",
  "rugby clubs",
  "football clubs",
  "marinas",
  "caravan parks",
  "campsites",
  "conference centres",
  "exhibition centres",
  "theme parks / visitor attractions",
  "warehouses with excess yard space",
  "empty high-street service yards",
  "closed pub sites",
  "former petrol stations",
  "former garden centres",
  "former retail units with car parks"
] as const;

export function parseSpaceTypes(input?: string): string[] {
  if (!input || input.trim().toLowerCase() === "all") {
    return [...SPACE_TYPES];
  }

  const requested = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return requested.length > 0 ? requested : [...SPACE_TYPES];
}
