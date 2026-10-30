#!/usr/bin/env node
// Builds a flavor wheel file (docs/custom-flavor-wheel.md) from a CSV with
// one flavor per row:
//
//   ring1,ring2,ring3,color
//   Fruity,,,#d0453f
//   Fruity,Citrus,Lemon,
//   Sweet,Caramelized,Toffee,
//
// ring2 and ring3 may be empty (a flavor on an inner ring). A ring above a
// flavor that has no row of its own is added. Keys come from the labels
// ("Stone fruit" → stone_fruit), colours are optional (#rrggbb). Rows keep
// their order, which is the wheel's order.
//
//   node scripts/flavor-lexicon-from-csv.mjs my-flavors.csv --name "House wheel" > my-wheel.json
//
// It checks the result like the app does (needs `npm run build -w shared`
// once) and says what's wrong on stderr. Data stays yours: this repository
// ships no lexicon but its own (see .gitignore, lexicons/).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const nameAt = args.indexOf("--name");
const name = nameAt >= 0 ? args.splice(nameAt, 2)[1] : "My flavor wheel";
const [file] = args;
if (!file) {
  console.error('Usage: node scripts/flavor-lexicon-from-csv.mjs <file.csv> [--name "Wheel name"] > wheel.json');
  process.exit(2);
}

// RFC 4180: quoted fields, "" inside quotes, CRLF or LF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const slug = (label) =>
  label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "flavor";

const [header, ...rows] = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
const rings = ["ring1", "ring2", "ring3"].map(col);
const colorAt = col("color");
if (rings[0] < 0) {
  console.error('The first row must name the columns: ring1,ring2,ring3[,color]');
  process.exit(1);
}

const flavors = [];
const byKey = new Map();
for (const [n, row] of rows.entries()) {
  const labels = rings.map((i) => (i >= 0 ? (row[i] ?? "").trim() : ""));
  const depth = labels.findIndex((l) => !l);
  const path = depth < 0 ? labels : labels.slice(0, depth);
  if (labels.slice(path.length).some(Boolean)) {
    console.error(`Row ${n + 2}: a ring is empty above a flavor`);
    process.exit(1);
  }
  let key = "";
  for (const [i, label] of path.entries()) {
    key = key ? `${key}.${slug(label)}` : slug(label);
    if (!byKey.has(key)) {
      const flavor = { key, label };
      byKey.set(key, flavor);
      flavors.push(flavor);
    }
    const color = colorAt >= 0 && i === path.length - 1 ? (row[colorAt] ?? "").trim() : "";
    if (color) byKey.get(key).color = color;
  }
}

const lexicon = { format: "barista-flavor-lexicon", version: 1, name, flavors };
try {
  const shared = new URL("../shared/dist/flavors.js", import.meta.url);
  const { parseLexicon } = await import(fileURLToPath(shared));
  const checked = parseLexicon(lexicon);
  if (!checked.ok) {
    console.error(`Not a valid wheel yet: ${checked.error}`);
    process.exitCode = 1;
  }
} catch {
  console.error("(Not checked: run `npm run build -w shared` first to check it here; the app checks it on import.)");
}
process.stdout.write(JSON.stringify(lexicon, null, 2) + "\n");
