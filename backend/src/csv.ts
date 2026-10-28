// CSV export for spreadsheets (docs/api/backup.md §2b, "CSV"): the journal
// and the beans, one row each, with names instead of IDs. Not for importing
// back (that's the JSON export).
import { count, desc, eq } from "drizzle-orm";
import { extractionYield, ratioWater } from "@barista/shared/brew";
import { beanProcesses, beans, brewLogs } from "@barista/shared/schema";
import { db } from "./db.js";
import { loadBrewLogs } from "./routes/brewLogs.js";

export const CSV_LISTS = ["brew_logs", "beans"] as const;
export type CsvList = (typeof CSV_LISTS)[number];

type Cell = string | number | boolean | null | undefined;

// One field: numbers as they are, text quoted when it has to be. Text that a
// spreadsheet would run as a formula (=, +, -, @ first) gets a leading ' so
// it stays text.
function field(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// RFC 4180 with CRLF, and a byte-order mark so Excel reads it as UTF-8.
export function toCsv(header: string[], rows: Cell[][]): string {
  return "﻿" + [header, ...rows].map((row) => row.map(field).join(",")).join("\r\n") + "\r\n";
}

// "2026-10-23 08:55", in the brewing device's time when it was recorded.
function localTime(at: Date, offsetMinutes: number | null): string {
  const shifted = new Date(at.getTime() + (offsetMinutes ?? 0) * 60_000);
  return shifted.toISOString().slice(0, 16).replace("T", " ");
}
const minutesSeconds = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const window = (min: number | null, max: number | null, unit = "") => (min === null || max === null ? null : `${min}–${max}${unit}`);

export async function brewLogsCsv(workspaceId: string): Promise<string> {
  const logs = await loadBrewLogs(eq(brewLogs.workspaceId, workspaceId), 1_000_000);
  const header = [
    "Date", "Date (UTC)", "Brewed by", "Roaster", "Bean", "Batch", "Recipe", "Style", "Brewer", "Drink", "Size",
    "Grinder", "Grind setting", "Grind RPM", "Water profile", "Dose (g)", "Water (g)", "Ice (g)", "Yield (g)", "Ratio", "TDS (%)",
    "Extraction (%)", "Water temp (°C)", "Time (s)", "Time", "Beans in (g)", "Grounds out (g)", "Steeping", "Steeped in",
    "Steep window (h)", "Target finish (s)", "Served diluted 1:", "Diluted with", "Prep", "Problems", "Rating",
    "Tasting notes", "Drink rating", "Drink notes",
  ];
  const rows = logs.map((l) => [
    localTime(l.timestamp, l.utcOffsetMinutes),
    l.timestamp.toISOString(),
    l.brewedBy?.email,
    l.bean.roasterName,
    l.bean.beanName,
    l.bean.batchNumber,
    l.recipe?.name,
    l.recipe?.style?.name,
    l.brewer?.name,
    l.drink?.name,
    l.servingSize !== null && l.servingUnit ? `${l.servingSize} ${l.servingUnit}` : null,
    l.grinder?.name,
    l.actualGrindSetting,
    l.grindRpm,
    l.waterProfile?.name,
    l.actualDoseGrams,
    l.actualWaterGrams,
    l.actualIceGrams,
    l.actualYieldGrams,
    (() => {
      const out = ratioWater(l.actualWaterGrams, l.actualIceGrams) ?? l.actualYieldGrams;
      return out === null ? null : Math.round((out / l.actualDoseGrams) * 10) / 10;
    })(),
    l.tdsPercent,
    extractionYield({ ...l, brewsLike: l.recipe?.style?.brewsLike ?? null }),
    l.actualTempC,
    l.actualTimeSec,
    minutesSeconds(l.actualTimeSec),
    l.beanWeightInGrams,
    l.groundWeightOutGrams,
    l.steeping,
    l.steepTemp,
    window(l.steepMinHours, l.steepMaxHours),
    window(l.expectedFinishMinSec, l.expectedFinishMaxSec),
    l.dilutionRatio,
    l.dilutedWith,
    l.tools.map((t) => t.name).join("; ") || null,
    l.problems.map((p) => p.name).join("; ") || null,
    l.rating,
    l.tastingNotes,
    l.drinkRating,
    l.drinkTastingNotes,
  ]);
  return toCsv(header, rows);
}

export async function beansCsv(workspaceId: string): Promise<string> {
  const rows = await db
    .select({ bean: beans, process: beanProcesses.name, brews: count(brewLogs.id) })
    .from(beans)
    .leftJoin(beanProcesses, eq(beans.processId, beanProcesses.id))
    .leftJoin(brewLogs, eq(brewLogs.beanId, beans.id))
    .where(eq(beans.workspaceId, workspaceId))
    .groupBy(beans.id, beanProcesses.name)
    .orderBy(desc(beans.createdAt));
  const header = [
    "Roaster", "Bean", "Batch", "Process", "Roast level", "Detailed roast level", "Roast loss (%)", "Roast type", "Roast date", "Blend",
    "Decaf", "Origin", "Country", "Region", "Altitude (m)", "Producer", "Flavor profile", "Bag (g)", "In stock (g)",
    "Price", "Currency", "Purchased", "Green supplier", "Website", "Rating", "Notes", "Brews", "Archived", "Added",
  ];
  return toCsv(
    header,
    rows.map(({ bean: b, process, brews }) => [
      b.roasterName, b.beanName, b.batchNumber, process, b.roastLevel, b.detailedRoastLevel, b.roastWeightLossPercent, b.roastType, b.roastDate?.toISOString().slice(0, 10), b.blendType,
      b.decaf, b.originArea, b.country, b.region, b.altitudeMasl, b.producer, b.flavorProfile, b.bagWeightGrams, b.inventoryWeightGrams,
      b.priceAmount, b.priceCurrency, b.purchaseDate, b.greenSupplier, b.website, b.rating, b.notes, brews,
      b.archivedAt ? b.archivedAt.toISOString().slice(0, 10) : null, b.createdAt.toISOString().slice(0, 10),
    ]),
  );
}
