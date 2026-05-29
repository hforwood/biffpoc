import fs from "node:fs/promises";
import path from "node:path";

import { databaseEnabled, saveImageAssetDb } from "./db.js";
import { objectStorageEnabled, saveSnapshotObject } from "./object-storage.js";
import type { DeadSpaceCandidate, MapAnnotation, MapSnapshot, PlaceCandidate, StaticMapContext } from "./types.js";
import { slugify } from "./utils/text.js";

export async function writeMapSnapshots(params: {
  leadId: string;
  site: PlaceCandidate;
  staticMap?: StaticMapContext;
  candidates: DeadSpaceCandidate[];
  outDir: string;
}): Promise<MapSnapshot> {
  const assetsDir = path.join(params.outDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });

  const base = slugify(`${params.leadId}-${params.site.name}`) || "site";
  const originalExt = extensionForContentType(params.staticMap?.contentType);
  const originalPath = path.join(assetsDir, `${base}-original.${originalExt}`);
  const annotatedPath = path.join(assetsDir, `${base}-annotated.svg`);

  const original = await originalImage(params.site, params.staticMap);
  await fs.writeFile(originalPath, original.data);

  const annotated = annotatedSvg({
    originalData: original.data,
    originalContentType: original.contentType,
    width: original.width,
    height: original.height,
    candidates: params.candidates
  });
  await fs.writeFile(annotatedPath, annotated, "utf8");

  const persistedToApiStorage = await persistSnapshots({
    leadId: params.leadId,
    original,
    annotated: Buffer.from(annotated, "utf8")
  });

  const version = Date.now();
  return {
    originalPath,
    originalUrl: persistedToApiStorage
      ? `/api/assets/${encodeURIComponent(params.leadId)}/original?v=${version}`
      : `/assets/${path.basename(originalPath)}?v=${version}`,
    annotatedPath,
    annotatedUrl: persistedToApiStorage
      ? `/api/assets/${encodeURIComponent(params.leadId)}/annotated?v=${version}`
      : `/assets/${path.basename(annotatedPath)}?v=${version}`
  };
}

async function persistSnapshots(params: {
  leadId: string;
  original: { data: Buffer; contentType: string };
  annotated: Buffer;
}): Promise<boolean> {
  if (objectStorageEnabled()) {
    try {
      await Promise.all([
        saveSnapshotObject({
          leadId: params.leadId,
          kind: "original",
          contentType: params.original.contentType,
          data: params.original.data
        }),
        saveSnapshotObject({
          leadId: params.leadId,
          kind: "annotated",
          contentType: "image/svg+xml",
          data: params.annotated
        })
      ]);
      return true;
    } catch (error) {
      console.warn(
        `Supabase S3 snapshot upload failed; falling back to Postgres image storage if available: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (!databaseEnabled()) return false;

  await Promise.all([
    saveImageAssetDb(params.leadId, "original", params.original.contentType, params.original.data),
    saveImageAssetDb(params.leadId, "annotated", "image/svg+xml", params.annotated)
  ]);
  return true;
}

async function originalImage(
  site: PlaceCandidate,
  staticMap?: StaticMapContext
): Promise<{ data: Buffer; contentType: string; width: number; height: number }> {
  const size = staticMap ? staticMap.cssSizePx * staticMap.scale : 960;

  if (staticMap?.imageBase64 && staticMap.contentType) {
    return {
      data: Buffer.from(staticMap.imageBase64, "base64"),
      contentType: staticMap.contentType,
      width: size,
      height: size
    };
  }

  const svg = placeholderSvg(site.name, size, size);
  return {
    data: Buffer.from(svg, "utf8"),
    contentType: "image/svg+xml",
    width: size,
    height: size
  };
}

function annotatedSvg(params: {
  originalData: Buffer;
  originalContentType: string;
  width: number;
  height: number;
  candidates: DeadSpaceCandidate[];
}): string {
  const href = `data:${params.originalContentType};base64,${params.originalData.toString("base64")}`;
  const lines = params.candidates
    .map((candidate, index) => candidate.annotation ?? fallbackAnnotation(index))
    .map((annotation, index) => lineMarkup(annotation, params.width, params.height, index))
    .join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}" viewBox="0 0 ${params.width} ${params.height}">`,
    `<image href="${href}" x="0" y="0" width="${params.width}" height="${params.height}" preserveAspectRatio="xMidYMid slice"/>`,
    `<g font-family="Arial, sans-serif">`,
    lines,
    `</g>`,
    `</svg>`
  ].join("\n");
}

function lineMarkup(annotation: MapAnnotation, width: number, height: number, index: number): string {
  const x1 = annotation.x1 * width;
  const y1 = annotation.y1 * height;
  const x2 = annotation.x2 * width;
  const y2 = annotation.y2 * height;
  const labelOnRight = x2 < width * 0.72;
  const labelX = labelOnRight ? x2 + 12 : x2 - 12;
  const labelY = Math.max(24, y2 - 10);
  const textAnchor = labelOnRight ? "start" : "end";
  const label = escapeXml(annotation.label || `Opportunity ${index + 1}`);
  const stroke = annotation.stroke ?? "#ff1f1f";

  return [
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="10" stroke-linecap="round"/>`,
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.85"/>`,
    `<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="9" fill="${stroke}" stroke="#fff" stroke-width="3"/>`,
    `<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${textAnchor}" fill="#fff" stroke="#111827" stroke-width="5" paint-order="stroke" font-size="24" font-weight="700">${label}</text>`
  ].join("\n");
}

function fallbackAnnotation(index: number): MapAnnotation {
  const y = 0.82 - Math.min(index * 0.08, 0.24);
  return { label: `Opportunity ${index + 1}`, x1: 0.16, y1: y, x2: 0.84, y2: y, stroke: "#ff1f1f" };
}

function placeholderSvg(siteName: string, width: number, height: number): string {
  const grid = Array.from({ length: 12 }, (_, index) => {
    const pos = ((index + 1) / 13) * width;
    return `<line x1="${pos.toFixed(1)}" y1="0" x2="${pos.toFixed(1)}" y2="${height}" stroke="#d0d7de" stroke-width="1" opacity="0.5"/>
<line x1="0" y1="${pos.toFixed(1)}" x2="${width}" y2="${pos.toFixed(1)}" stroke="#d0d7de" stroke-width="1" opacity="0.5"/>`;
  }).join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#eef2f7"/>`,
    grid,
    `<rect x="${width * 0.14}" y="${height * 0.18}" width="${width * 0.72}" height="${height * 0.22}" fill="#cbd5df"/>`,
    `<rect x="${width * 0.18}" y="${height * 0.52}" width="${width * 0.64}" height="${height * 0.26}" fill="#d8dee7"/>`,
    `<path d="M ${width * 0.08} ${height * 0.86} L ${width * 0.92} ${height * 0.86}" stroke="#9aa6b2" stroke-width="18" stroke-linecap="round"/>`,
    `<text x="${width * 0.5}" y="${height * 0.48}" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#334155">${escapeXml(siteName)}</text>`,
    `<text x="${width * 0.5}" y="${height * 0.52}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#64748b">Mock satellite snapshot</text>`,
    `</svg>`
  ].join("\n");
}

function extensionForContentType(contentType?: string): "png" | "jpg" | "svg" {
  if (!contentType) return "svg";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  return "svg";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
