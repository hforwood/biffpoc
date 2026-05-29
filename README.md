# BiffPOC

A small TypeScript CLI and local web interface for finding possible BT Lockers host sites by area, enriching them with Google/Firecrawl data, and estimating locker capacity and revenue.

## What it does

- Searches by county and space type.
- Searches by town, area, county, or UK postcode with an optional mile radius.
- Enriches candidate sites with Google Places details: name, address, phone, website, Google Maps URI, latitude and longitude.
- Scrapes candidate websites with Firecrawl for phone numbers, email addresses, and contact-form URLs.
- Uses Google Static Maps metadata and AI-assisted or heuristic analysis to estimate dead-space locker opportunities.
- Stores original map snapshots and an annotated red-line image for proposed locker dead space.
- Calculates total revenue, paid-to-space-owner revenue, and Biffen revenue from the BT Lockers product matrix.
- Scores each site by dead-space size, estimated revenue, viability, nuisance risk, height restriction risk, and confidence.
- Runs once from the CLI or repeatedly with a local cron scheduler.
- Provides a local web interface for sorting, reviewing, and updating contact status.
- Includes a Vercel cron endpoint guarded by `CRON_SECRET`.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with:

- `GOOGLE_MAPS_API_KEY` for Places Text Search and Static Maps.
- `GOOGLE_CUSTOM_SEARCH_API_KEY` and `GOOGLE_CUSTOM_SEARCH_CX` for Google Programmable Search.
- `FIRECRAWL_API_KEY` for page scraping.
- AI credentials supported by the Vercel AI SDK / AI Gateway if you want AI-assisted site analysis.

## Commands

List product pricing:

```bash
npm run products
```

Run a real scan:

```bash
npm run scan -- --area "Preston" --radius 5 --limit-per-type 2 --max-sites 20
```

Run a mock scan without API keys:

```bash
npm run scan -- --area "Preston" --radius 5 --mock --no-ai
```

Run on a local cron schedule:

```bash
npm run schedule -- --area "Preston" --radius 5 --cron "0 8 * * 1-5"
```

Start the local interface:

```bash
npm run web
```

Outputs are written to `runs/` as JSON and CSV.

The web interface opens at `http://localhost:4173` by default. It can run mock scans, real scans, sort by site size / estimated revenue / site score, open a slide-over with original and annotated snapshots, and update contact status:

```text
identified -> contacted -> call booked -> rejected -> site visit -> closed won
```

## Vercel cron

`vercel.json` schedules `GET /api/cron/scan`. Vercel cron calls must include:

```text
Authorization: Bearer $CRON_SECRET
```

For local testing:

```bash
npm run build
```

The cron endpoint uses `DEFAULT_AREA`, `DEFAULT_RADIUS_MILES`, `DEFAULT_SPACE_TYPES`, `DEFAULT_LIMIT_PER_TYPE`, and `DEFAULT_MAX_SITES` from the environment.
On Vercel it writes generated report files to `REPORT_OUT_DIR`, defaulting to `/tmp/biffpoc-runs`.

## Notes on space analysis

The AI-assisted analyzer uses a satellite static map when `GOOGLE_MAPS_API_KEY` is configured. Scaling is estimated with the standard Web Mercator formula:

```text
metres_per_css_pixel = 156543.03392 * cos(latitude) / 2^zoom
metres_per_returned_pixel = metres_per_css_pixel / scale
```

When AI is disabled or unavailable, the CLI falls back to conservative category-based estimates and marks results as heuristic.
