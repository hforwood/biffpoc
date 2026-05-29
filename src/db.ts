import { Pool } from "pg";

import { readEnv } from "./config.js";
import type { AiFeedbackEntry } from "./feedback-memory.js";
import type { SearchRun } from "./search-runs.js";
import type { SiteLead, SiteReview } from "./types.js";
import { stableLeadKey } from "./utils/stable-key.js";

type ReviewMap = Record<string, SiteReview>;

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;

export interface StoredImageAsset {
  contentType: string;
  data: Buffer;
}

export function databaseEnabled(): boolean {
  return Boolean(readEnv("DATABASE_URL"));
}

export async function listSearchRunsDb(): Promise<SearchRun[]> {
  await ensureSchema();
  const result = await getPool().query<{ data: SearchRun }>(
    "select data from biff_search_runs order by created_at desc"
  );
  return result.rows.map((row) => row.data);
}

export async function getSearchRunDb(id: string): Promise<SearchRun | undefined> {
  await ensureSchema();
  const result = await getPool().query<{ data: SearchRun }>(
    "select data from biff_search_runs where id = $1",
    [id]
  );
  return result.rows[0]?.data;
}

export async function upsertSearchRunDb(run: SearchRun): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `insert into biff_search_runs (id, status, created_at, updated_at, data)
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (id) do update set
       status = excluded.status,
       updated_at = excluded.updated_at,
       data = excluded.data`,
    [run.id, run.status, run.createdAt, run.updatedAt, JSON.stringify(run)]
  );

  if (run.summary?.leads?.length) {
    await Promise.all(run.summary.leads.map((lead) => upsertSiteLeadDb(run.id, lead)));
  }
}

export async function upsertSiteLeadDb(searchId: string, lead: SiteLead): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `insert into biff_site_leads (id, search_id, stable_key, data)
     values ($1, $2, $3, $4::jsonb)
     on conflict (id) do update set
       search_id = excluded.search_id,
       stable_key = excluded.stable_key,
       data = excluded.data,
       updated_at = now()`,
    [lead.id, searchId, stableLeadKey(lead), JSON.stringify(lead)]
  );
}

export async function loadReviewsDb(): Promise<ReviewMap> {
  await ensureSchema();
  const result = await getPool().query<{ lead_id: string; data: SiteReview }>(
    "select lead_id, data from biff_site_reviews"
  );
  return Object.fromEntries(result.rows.map((row) => [row.lead_id, row.data]));
}

export async function updateReviewDb(leadId: string, review: SiteReview): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `insert into biff_site_reviews (lead_id, data, updated_at)
     values ($1, $2::jsonb, $3)
     on conflict (lead_id) do update set
       data = excluded.data,
       updated_at = excluded.updated_at`,
    [leadId, JSON.stringify(review), review.updatedAt ?? new Date().toISOString()]
  );

  await getPool().query(
    `update biff_site_leads
     set data = jsonb_set(data, '{review}', $2::jsonb, true),
         updated_at = now()
     where id = $1`,
    [leadId, JSON.stringify(review)]
  );
}

export async function appendAiFeedbackDb(entry: AiFeedbackEntry): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `insert into biff_ai_feedback_memory
      (lead_id, site_name, space_type, address, is_good, notes, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.leadId,
      entry.siteName,
      entry.spaceType,
      entry.address,
      entry.isGood,
      entry.notes,
      entry.createdAt
    ]
  );
}

export async function loadAiFeedbackDb(limit = 20): Promise<AiFeedbackEntry[]> {
  await ensureSchema();
  const result = await getPool().query<{
    lead_id: string;
    site_name?: string;
    space_type?: string;
    address?: string;
    is_good?: boolean;
    notes?: string;
    created_at: Date;
  }>(
    `select lead_id, site_name, space_type, address, is_good, notes, created_at
     from biff_ai_feedback_memory
     order by created_at desc
     limit $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    leadId: row.lead_id,
    siteName: row.site_name,
    spaceType: row.space_type,
    address: row.address,
    isGood: row.is_good,
    notes: row.notes,
    createdAt: row.created_at.toISOString()
  }));
}

export async function saveImageAssetDb(
  leadId: string,
  kind: "original" | "annotated",
  contentType: string,
  data: Buffer
): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `insert into biff_site_images (lead_id, kind, content_type, data)
     values ($1, $2, $3, $4)
     on conflict (lead_id, kind) do update set
       content_type = excluded.content_type,
       data = excluded.data,
       created_at = now()`,
    [leadId, kind, contentType, data]
  );
}

export async function getImageAssetDb(
  leadId: string,
  kind: "original" | "annotated"
): Promise<StoredImageAsset | undefined> {
  await ensureSchema();
  const result = await getPool().query<{ content_type: string; data: Buffer }>(
    "select content_type, data from biff_site_images where lead_id = $1 and kind = $2",
    [leadId, kind]
  );
  const row = result.rows[0];
  return row ? { contentType: row.content_type, data: row.data } : undefined;
}

async function ensureSchema(): Promise<void> {
  if (!databaseEnabled()) return;
  schemaReady ??= initializeSchema();
  await schemaReady;
}

async function initializeSchema(): Promise<void> {
  const db = getPool();
  await db.query(`
    create table if not exists biff_search_runs (
      id text primary key,
      status text not null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      data jsonb not null
    );

    create table if not exists biff_site_leads (
      id text primary key,
      search_id text not null references biff_search_runs(id) on delete cascade,
      stable_key text not null,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (search_id, stable_key)
    );

    create table if not exists biff_site_reviews (
      lead_id text primary key,
      data jsonb not null,
      updated_at timestamptz not null
    );

    create table if not exists biff_ai_feedback_memory (
      id bigserial primary key,
      lead_id text not null,
      site_name text,
      space_type text,
      address text,
      is_good boolean,
      notes text,
      created_at timestamptz not null default now()
    );

    create table if not exists biff_site_images (
      lead_id text not null,
      kind text not null check (kind in ('original', 'annotated')),
      content_type text not null,
      data bytea not null,
      created_at timestamptz not null default now(),
      primary key (lead_id, kind)
    );

    create index if not exists biff_search_runs_created_at_idx on biff_search_runs (created_at desc);
    create index if not exists biff_site_leads_search_id_idx on biff_site_leads (search_id);
    create index if not exists biff_ai_feedback_created_at_idx on biff_ai_feedback_memory (created_at desc);
  `);
}

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = readEnv("DATABASE_URL");
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
    allowExitOnIdle: true
  });
  return pool;
}
