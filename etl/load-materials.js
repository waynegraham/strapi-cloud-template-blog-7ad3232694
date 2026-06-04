require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs = require("fs");
const path = require("path");

const STRAPI_API_URL = process.env.STRAPI_API_URL || "http://localhost:1337";
// Note: using a separate token for the local 'blog' version to avoid accidentally granting more permissions than necessary to the materials load process
const STRAPI_API_TOKEN = process.env.STRAPI_API_BLOG_TOKEN;
const INPUT_FILE = process.env.MATERIALS_CSV || path.join(__dirname, "materials_distinct.csv");

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

const ENDPOINT = "materials";
const DEFAULT_VOCABULARY = "AAT";
const DEFAULT_REF_ID = "PENDING_REVIEW";

function usage() {
  console.log(`Usage:
  node load-materials.js          # dry run
  node load-materials.js --apply  # create/update Strapi materials

Optional env:
  STRAPI_API_URL=http://localhost:1337
  STRAPI_API_TOKEN=...
  MATERIALS_CSV=./materials_distinct.csv`);
}

function requireEnv() {
  if (!STRAPI_API_TOKEN) {
    usage();
    throw new Error("Missing STRAPI_API_TOKEN");
  }
}

function baseUrl() {
  return STRAPI_API_URL.replace(/\/$/, "");
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  values.push(value);
  return values;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => compactWhitespace(header));

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row = { _line: index + 2 };

    for (const [headerIndex, header] of headers.entries()) {
      row[header] = values[headerIndex] === undefined ? "" : values[headerIndex];
    }

    return row;
  });
}

function inferMaterialType(nameEn) {
  const supportKeywords = [
    "canvas",
    "paper",
    "parchment",
    "wood panel",
    "tablet",
    "fabric",
    "linen",
    "folio",
    "folios",
    "panel",
  ];
  const normalized = nameEn.toLowerCase();
  return supportKeywords.some((keyword) => normalized.includes(keyword)) ? "support" : "medium";
}

function rowToMaterial(row) {
  const nameEn = compactWhitespace(row.materialEn || row.material_en);
  const nameAr = compactWhitespace(row.materialAr || row.material_ar);

  return {
    sourceLine: row._line,
    data: {
      nameEn,
      nameAr,
      type: inferMaterialType(nameEn),
      vocabulary: DEFAULT_VOCABULARY,
      refId: DEFAULT_REF_ID,
    },
  };
}

function appendFilter(searchParams, field, operator, value) {
  searchParams.set(`filters[${field}][${operator}]`, value);
}

async function strapiRequest(method, endpoint, { documentId, data, query } = {}) {
  const url = new URL(`${baseUrl()}/api/${endpoint}${documentId ? `/${documentId}` : ""}`);

  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${STRAPI_API_TOKEN}`,
    },
    body: data ? JSON.stringify({ data }) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${method} ${url.pathname} failed: ${response.status} ${errorBody}`);
  }

  return response.json();
}

async function findMaterialByNameEn(nameEn) {
  const url = new URL(`${baseUrl()}/api/${ENDPOINT}`);
  url.searchParams.set("status", "draft");
  url.searchParams.set("pagination[pageSize]", "2");
  appendFilter(url.searchParams, "nameEn", "$eq", nameEn);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${STRAPI_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GET ${url.pathname} failed: ${response.status} ${errorBody}`);
  }

  const json = await response.json();
  return json.data || [];
}

function documentIdOf(entry) {
  return entry && entry.documentId;
}

async function upsertMaterial(material, stats) {
  const { sourceLine, data } = material;

  if (!data.nameEn && !data.nameAr) {
    stats.skip += 1;
    console.warn(`Skipping line ${sourceLine}; missing both materialEn and materialAr`);
    return;
  }

  if (!data.nameEn) {
    stats.skip += 1;
    console.warn(`Skipping line ${sourceLine}; missing materialEn for Strapi match`);
    return;
  }

  const existing = await findMaterialByNameEn(data.nameEn);
  const existingEntry = existing[0];

  if (existing.length > 1) {
    console.warn(`Line ${sourceLine}: found ${existing.length} existing materials named "${data.nameEn}"; updating first`);
  }

  if (DRY_RUN) {
    stats[existingEntry ? "update" : "create"] += 1;
    console.log(`[dry-run] ${existingEntry ? "update" : "create"} material "${data.nameEn}"`);
    return;
  }

  if (existingEntry) {
    const documentId = documentIdOf(existingEntry);
    await strapiRequest("PUT", ENDPOINT, { documentId, data });
    stats.update += 1;
    console.log(`Updated material "${data.nameEn}"`);
    return;
  }

  await strapiRequest("POST", ENDPOINT, { data });
  stats.create += 1;
  console.log(`Created material "${data.nameEn}"`);
}

async function main() {
  requireEnv();

  const csv = fs.readFileSync(INPUT_FILE, "utf8");
  const rows = parseCsv(csv);
  const materials = rows.map(rowToMaterial);
  const seen = new Set();
  const stats = { create: 0, update: 0, skip: 0, duplicate: 0 };

  console.log(`${DRY_RUN ? "Dry run" : "Applying"} materials load to ${baseUrl()}`);
  console.log(`Input: ${INPUT_FILE}`);
  console.log(`Rows: ${materials.length}`);

  for (const material of materials) {
    const key = material.data.nameEn.toLowerCase();
    if (key && seen.has(key)) {
      stats.duplicate += 1;
      console.warn(`Skipping duplicate CSV material "${material.data.nameEn}" on line ${material.sourceLine}`);
      continue;
    }
    if (key) seen.add(key);

    await upsertMaterial(material, stats);
  }

  console.log("Load summary:");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
