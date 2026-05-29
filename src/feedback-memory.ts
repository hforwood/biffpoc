import fs from "node:fs/promises";
import path from "node:path";

import { appendAiFeedbackDb, databaseEnabled, loadAiFeedbackDb } from "./db.js";

export interface AiFeedbackEntry {
  leadId: string;
  siteName?: string;
  spaceType?: string;
  address?: string;
  isGood?: boolean;
  notes?: string;
  createdAt: string;
}

export async function appendAiFeedbackMemory(outDir: string, entry: Omit<AiFeedbackEntry, "createdAt">): Promise<void> {
  if (entry.isGood === undefined && !entry.notes?.trim()) return;

  const next: AiFeedbackEntry = {
    ...entry,
    notes: entry.notes?.trim(),
    createdAt: new Date().toISOString()
  };

  if (databaseEnabled()) {
    await appendAiFeedbackDb(next);
    return;
  }

  const entries = await readAiFeedbackMemory(outDir);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(memoryPath(outDir), `${JSON.stringify([next, ...entries].slice(0, 200), null, 2)}\n`, "utf8");
}

export async function loadAiFeedbackMemory(outDir: string, limit = 20): Promise<string[]> {
  const entries = databaseEnabled() ? await loadAiFeedbackDb(limit) : await readAiFeedbackMemory(outDir);
  return entries.slice(0, limit).map((entry) => {
    const verdict = entry.isGood === true ? "GOOD" : entry.isGood === false ? "NOT GOOD" : "UNRATED";
    const site = [entry.siteName, entry.spaceType, entry.address].filter(Boolean).join(" | ");
    const notes = entry.notes ? `Reason: ${entry.notes}` : "No reason supplied.";
    return `${verdict}: ${site || entry.leadId}. ${notes}`;
  });
}

async function readAiFeedbackMemory(outDir: string): Promise<AiFeedbackEntry[]> {
  try {
    const raw = await fs.readFile(memoryPath(outDir), "utf8");
    return JSON.parse(raw) as AiFeedbackEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function memoryPath(outDir: string): string {
  return path.join(outDir, "ai-feedback-memory.json");
}
