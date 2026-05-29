export type OutputFormat = "json" | "csv";

export type SpaceType = string;

export interface SearchResult {
  title: string;
  link: string;
  snippet?: string;
  source: "google-custom-search" | "mock";
}

export interface ScrapedPage {
  url: string;
  title?: string;
  markdown?: string;
  phoneNumbers: string[];
  emailAddresses: string[];
  contactFormUrls: string[];
  source: "firecrawl" | "skipped" | "mock";
}

export interface PlaceLocation {
  latitude: number;
  longitude: number;
}

export interface PlaceCandidate {
  id?: string;
  name: string;
  address?: string;
  phoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  location?: PlaceLocation;
  distanceMiles?: number;
  types: string[];
  businessStatus?: string;
  sourceQuery: string;
  spaceType: SpaceType;
}

export interface ContactInfo {
  phoneNumber?: string;
  emailAddress?: string;
  contactFormUrl?: string;
  sourceUrls: string[];
}

export interface StaticMapContext {
  url: string;
  center: PlaceLocation;
  zoom: number;
  cssSizePx: number;
  scale: 1 | 2;
  widthMeters: number;
  heightMeters: number;
  metersPerCssPixel: number;
  metersPerReturnedPixel: number;
  imageBase64?: string;
  contentType?: string;
}

export interface SiteCriteria {
  nearbyHousing: boolean;
  hasCarPark: boolean;
  confidence: number;
  notes: string[];
  source: "ai" | "heuristic" | "mock";
}

export interface MapAnnotation {
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
}

export interface MapSnapshot {
  originalPath: string;
  originalUrl: string;
  annotatedPath: string;
  annotatedUrl: string;
}

export interface DeadSpaceCandidate {
  label: string;
  placement:
    | "edge"
    | "wall"
    | "corner"
    | "rear_yard"
    | "service_yard"
    | "screened_area"
    | "unknown";
  estimatedLengthM: number;
  estimatedDepthM: number;
  confidence: number;
  notes: string;
  risks: string[];
  annotation?: MapAnnotation;
}

export interface ProductOption {
  product: string;
  family: "straight" | "l";
  modules: number;
  totalMetres: number;
  footprintLengthM: number;
  footprintDepthM: number;
  heightM: number;
  sizeLabel: string;
  totalRevenueYear: number;
  paidToSpaceOwnerYear: number;
  biffenRevenueYear: number;
}

export interface ProductFit {
  candidateLabel: string;
  product: ProductOption;
  quantity: number;
  totalModules: number;
  totalRevenueYear: number;
  paidToSpaceOwnerYear: number;
  biffenRevenueYear: number;
  rationale: string;
}

export interface SiteAnalysis {
  analysisMode: "ai" | "heuristic";
  deadSpaceCandidates: DeadSpaceCandidate[];
  selectedFits: ProductFit[];
  estimatedDeadSpaceM2: number;
  totalModules: number;
  totalRevenueYear: number;
  paidToSpaceOwnerYear: number;
  biffenRevenueYear: number;
  confidence: number;
  score: SiteScore;
  notes: string[];
}

export interface SiteLead {
  id: string;
  site: PlaceCandidate;
  contact: ContactInfo;
  searchResults: SearchResult[];
  scrapedPages: ScrapedPage[];
  criteria?: SiteCriteria;
  profile?: SiteProfile;
  staticMap?: StaticMapContext;
  snapshots?: MapSnapshot;
  analysis: SiteAnalysis;
  review: SiteReview;
}

export type ContactStatus =
  | "identified"
  | "contacted"
  | "call_booked"
  | "rejected"
  | "site_visit"
  | "closed_won"
  | "registered";

export interface SiteReview {
  status: ContactStatus;
  isGood?: boolean;
  notes?: string;
  updatedAt?: string;
}

export interface SiteProfile {
  profile: SiteProfileDetails;
  business: SiteBusinessDetails;
  siteDetails: SiteOperationalDetails;
  updatedAt?: string;
  updatedBy?: "admin" | "site_owner";
}

export interface SiteProfileDetails {
  siteName?: string;
  siteWebsite?: string;
  siteContactEmail?: string;
  sitePhoneNumber?: string;
  siteAddress?: string;
  contactForm?: string;
}

export interface SiteBusinessDetails {
  mainContactFullName?: string;
  mainContactEmail?: string;
  mainContactPhoneNumber?: string;
  organisationType?: string;
  registeredAddress?: string;
  registryId?: string;
  registeredName?: string;
}

export interface SiteOperationalDetails {
  gateHasCombinationLock?: boolean;
  concreteNeedsBuilding?: boolean;
  signedAgreement?: boolean;
  agreementStartDate?: string;
  agreementEndDate?: string;
  breakClauseDate?: string;
  accessSchedule?: string;
  gatedExternal?: string;
  cctvOnSite?: boolean;
  additionalSiteNotes?: string;
  distanceFromPostcodeMiles?: number;
  estimatedDriveMinutes?: number;
  roughLockerPlacement?: string;
  mediaUrls?: string[];
  agreementFileUrl?: string;
  agreementFileName?: string;
}

export interface SiteScore {
  total: number;
  deadSpace: number;
  revenue: number;
  viability: number;
  confidence: number;
  nuisanceRisk: number;
  heightRestrictionRisk: number;
  rationale: string[];
}

export interface ScanOptions {
  county: string;
  area: string;
  radiusMiles?: number;
  spaceTypes: SpaceType[];
  limitPerType: number;
  maxSites: number;
  outDir: string;
  useAi: boolean;
  mock: boolean;
  mapsZoom: number;
  mapsSize: number;
}

export interface ScanSummary {
  county: string;
  generatedAt: string;
  options: Omit<ScanOptions, "spaceTypes"> & { spaceTypes: string[] };
  leads: SiteLead[];
  totals: {
    sites: number;
    totalModules: number;
    totalRevenueYear: number;
    paidToSpaceOwnerYear: number;
    biffenRevenueYear: number;
  };
}
