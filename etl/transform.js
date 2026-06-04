require("dotenv").config();

const fs = require("fs");
const path = require("path");

const STRAPI_API_URL = process.env.STRAPI_API_URL || "https://localhost:1337";
const INPUT_FILE = process.env.ETL_INPUT_FILE || path.join(__dirname, "airtable_dump.json");
const AGENTS_FILE = process.env.ETL_AGENTS_FILE || path.join(__dirname, "agents_distinct.csv");
const MATERIALS_FILE =
  process.env.ETL_MATERIALS_FILE || path.join(__dirname, "materials_distinct.csv");
const OUTPUT_DIR = process.env.ETL_OUTPUT_DIR || path.join(__dirname, "intermediate");

const SOURCE_SYSTEM = "airtable";

const ROLE_LABEL_AR = {
  Curator: "أمين المعرض",
  Writer: "كاتب",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanMultiline(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugify(value, fallback = "untitled") {
  const slug = compactWhitespace(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function normalizeKey(value) {
  return compactWhitespace(value).toLocaleLowerCase();
}

function normalizeLookupText(value) {
  return compactWhitespace(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueByKey(items, keyFn) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];

  return body.map((cells) =>
    Object.fromEntries(header.map((name, index) => [name, cells[index] || ""])),
  );
}

function readCsv(filePath) {
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function toBlocks(value) {
  const text = cleanMultiline(value);
  if (!text) return undefined;

  return text.split(/\n{2,}/).map((paragraph) => ({
    type: "paragraph",
    children: [{ type: "text", text: paragraph.replace(/\n/g, " ") }],
  }));
}

function optional(value) {
  const text = cleanMultiline(value);
  return text || undefined;
}

function relationRef(contentType, key) {
  return key ? { content_type: contentType, key } : undefined;
}

function relationRefFromValue(contentType, value) {
  const text = compactWhitespace(value);
  return text ? relationRef(contentType, slugify(text)) : undefined;
}

function relationRefs(contentType, keys) {
  return keys.filter(Boolean).map((key) => relationRef(contentType, key));
}

function splitArrayField(value) {
  if (Array.isArray(value)) return value.map(compactWhitespace).filter(Boolean);
  const text = compactWhitespace(value);
  return text ? [text] : [];
}

function splitIabCodes(value) {
  return compactWhitespace(value)
    .split(/\s*,\s*/)
    .map(compactWhitespace)
    .filter(Boolean);
}

function buildSearchText(parts) {
  return parts.map(compactWhitespace).filter(Boolean).join(" ");
}

function buildEndpointRecord(contentType, endpoint, key, data, relations = {}, match = { key }) {
  const cleanedRelations = Object.fromEntries(
    Object.entries(relations).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    ),
  );

  return {
    content_type: contentType,
    endpoint,
    key,
    match,
    request: {
      method: "POST",
      url: `${STRAPI_API_URL.replace(/\/$/, "")}/api/${endpoint}`,
      body: { data },
    },
    relations: cleanedRelations,
  };
}

function transformAgentRoles(agents) {
  return agents
    .flatMap((agent) => {
      const name = compactWhitespace(agent.name_en);
      const agentKey = slugify(name);
      const roles = compactWhitespace(agent.roles)
        .split(";")
        .map(compactWhitespace)
        .filter(Boolean);

      return roles.map((role) => {
        const roleKey = slugify(role);

        return buildEndpointRecord(
          "agent-role",
          "agent-roles",
          `${agentKey}--${roleKey}`,
          {
            label_en: role,
            label_ar: ROLE_LABEL_AR[role],
          },
          {
            agent: relationRef("agent", agentKey),
          },
          {
            label_en: role,
            agent_key: agentKey,
          },
        );
      });
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function transformAgents(agents) {
  return agents
    .map((agent) => {
      const name = compactWhitespace(agent.name_en);

      return buildEndpointRecord("agent", "agents", slugify(name), {
        name_en: name,
        name_ar: optional(agent.name_ar),
      });
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function transformPeople(agents) {
  const rolePriority = ["curator", "writer"];

  return agents
    .map((agent) => {
      const roles = compactWhitespace(agent.roles)
        .split(";")
        .map((role) => role.toLowerCase())
        .filter(Boolean);
      const role = rolePriority.find((candidate) => roles.includes(candidate)) || "unknown";
      const name = compactWhitespace(agent.name_en);

      return buildEndpointRecord("person", "people", slugify(name), {
        name_en: name,
        name_ar: optional(agent.name_ar),
        slug: slugify(name),
        role,
        source_system: SOURCE_SYSTEM,
      });
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function transformMaterials(materials) {
  return materials
    .map((material) => {
      const label = compactWhitespace(material.material_en);
      const slug = slugify(label);

      return buildEndpointRecord("material", "materials", slug, {
        name_en: label,
        name_ar: optional(material.material_ar),
      });
    })
    .filter((record) => record.request.body.data.name_en)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function transformGalleries(records) {
  const galleries = uniqueByKey(
    records.map((record) => compactWhitespace(record.fields && record.fields.Gallery)).filter(Boolean),
    normalizeKey,
  ).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  return galleries.map((gallery, index) =>
    buildEndpointRecord("gallery", "galleries", slugify(gallery), {
      eyebrow_en: `Gallery ${index + 1}`,
      name_en: gallery,
    }),
  );
}

function transformSubGalleries(records) {
  const subGalleries = uniqueByKey(
    records
      .map((record) => compactWhitespace(record.fields && record.fields["Sub-gallery"]))
      .filter(Boolean),
    normalizeKey,
  ).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  return subGalleries.map((subGallery, index) =>
    buildEndpointRecord("sub-gallery", "sub-galleries", slugify(subGallery), {
      title_en: subGallery,
      slug: slugify(subGallery),
      sort_order: index + 1,
    }),
  );
}

function materialKeysForRecord(fields, materialLookup) {
  const rawEn = compactWhitespace(fields.Material);
  if (!rawEn) return [];

  const direct = materialLookup.byExact.get(normalizeKey(rawEn));
  if (direct) return [direct];

  const normalizedMaterial = ` ${normalizeLookupText(rawEn)} `;
  const matched = [];

  for (const material of materialLookup.byPhrase) {
    if (normalizedMaterial.includes(` ${material.normalized} `)) {
      matched.push(material.key);
    }
  }

  return uniqueByKey(matched, (key) => key);
}

function personKeysForRecord(fields, fieldName) {
  return splitArrayField(fields[fieldName]).map(slugify);
}

function agentKeysForRecord(fields, fieldName, role) {
  const roleKey = slugify(role);
  return splitArrayField(fields[fieldName]).map((name) => `${slugify(name)}--${roleKey}`);
}

function toDateInfo(fields) {
  const dateInfo = {
    display_date_en: optional(fields.Date),
    display_date_ar: optional(fields["Date AR"]),
  };

  for (const [key, value] of Object.entries(dateInfo)) {
    if (value === undefined || value === "") delete dateInfo[key];
  }

  return Object.keys(dateInfo).length > 0 ? dateInfo : undefined;
}

function transformWorks(records, materialLookup) {
  const works = [];
  const report = {
    skipped: [],
    duplicate_iab_codes: [],
    duplicate_source_rows: [],
    missing_material_lookup: [],
  };
  const iabCounts = new Map();

  for (const sourceRecord of records) {
    const fields = sourceRecord.fields || {};
    const iabCodes = splitIabCodes(fields["IAB Code"]);
    const titleEn = optional(fields["Title of Object"]);

    if (!titleEn) {
      report.skipped.push({
        source_record_id: sourceRecord.id,
        reason: "missing Title of Object",
      });
      continue;
    }

    if (iabCodes.length === 0) {
      report.skipped.push({
        source_record_id: sourceRecord.id,
        reason: "missing IAB Code",
      });
      continue;
    }

    if (iabCodes.length > 1) {
      report.duplicate_source_rows.push({
        source_record_id: sourceRecord.id,
        title_en: titleEn,
        raw_iab_code: compactWhitespace(fields["IAB Code"]),
        primary_iab_code: iabCodes[0],
        additional_iab_codes: iabCodes.slice(1),
        iab_codes: iabCodes,
      });
    }

    const materialRefs = materialKeysForRecord(fields, materialLookup);
    if (compactWhitespace(fields.Material) && materialRefs.length === 0) {
      report.missing_material_lookup.push({
        source_record_id: sourceRecord.id,
        iab_code: compactWhitespace(fields["IAB Code"]),
        material: compactWhitespace(fields.Material),
      });
    }

    const primaryIabCode = iabCodes[0];
    iabCounts.set(primaryIabCode, (iabCounts.get(primaryIabCode) || 0) + 1);

    const key = `${slugify(primaryIabCode)}--${sourceRecord.id}`;
    const titleAr = optional(fields["Title of Object AR"]);
    const data = {
      iab_code: primaryIabCode,
      title_en: titleEn,
      text_ar: titleAr,
      origin_en: optional(fields.Origin),
      origin_ar: optional(fields["Origin AR"]),
      dimension_en: optional(fields.Dimension),
      dimension_ar: optional(fields["Dimension AR"]),
      description_en: toBlocks(fields.Description),
      description_ar: toBlocks(fields["Description AR"]),
      footnotes_en: toBlocks(fields["Footnote reference"]),
      footnotes_ar: toBlocks(fields["Footnote reference AR"]),
      credit_line_en: optional(fields["Credit Line"]),
      credit_line_ar: optional(fields["Credit Line AR"]),
      date_info: toDateInfo(fields),
    };

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === "") delete data[key];
    }

    works.push(
      buildEndpointRecord(
        "work",
        "works",
        key,
        data,
        {
          agents: relationRefs("agent", [
            ...agentKeysForRecord(fields, "Writer(s)", "Writer"),
            ...agentKeysForRecord(fields, "Curator(s)", "Curator"),
          ]),
        },
        { iab_code: primaryIabCode },
      ),
    );
  }

  report.duplicate_iab_codes = Array.from(iabCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([iab_code, count]) => ({ iab_code, count }))
    .sort((a, b) => a.iab_code.localeCompare(b.iab_code));

  return { works, report };
}

function writeIntermediate(name, records) {
  const outputPath = path.join(OUTPUT_DIR, `${name}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`);
  return outputPath;
}

function main() {
  ensureDir(OUTPUT_DIR);
  fs.rmSync(path.join(OUTPUT_DIR, "objects.json"), { force: true });

  const airtableRecords = readJson(INPUT_FILE);
  const agents = readCsv(AGENTS_FILE);
  const materials = readCsv(MATERIALS_FILE);
  const materialLookup = {
    byExact: new Map(
      materials
        .map((material) => [normalizeKey(material.material_en), slugify(material.material_en)])
        .filter(([key]) => key),
    ),
    byPhrase: materials
      .map((material) => ({
        normalized: normalizeLookupText(material.material_en),
        key: slugify(material.material_en),
      }))
      .filter((material) => material.normalized)
      .sort((a, b) => b.normalized.length - a.normalized.length),
  };

  const agentRoles = transformAgentRoles(agents);
  const transformedAgents = transformAgents(agents);
  const people = transformPeople(agents);
  const transformedMaterials = transformMaterials(materials);
  const galleries = transformGalleries(airtableRecords);
  const subGalleries = transformSubGalleries(airtableRecords);
  const { works, report } = transformWorks(airtableRecords, materialLookup);

  const files = {
    "agent-roles": writeIntermediate("agent-roles", agentRoles),
    agents: writeIntermediate("agents", transformedAgents),
    people: writeIntermediate("people", people),
    materials: writeIntermediate("materials", transformedMaterials),
    galleries: writeIntermediate("galleries", galleries),
    "sub-galleries": writeIntermediate("sub-galleries", subGalleries),
    works: writeIntermediate("works", works),
    duplicates: writeIntermediate("duplicates", report.duplicate_source_rows),
    report: writeIntermediate("report", report),
  };

  const manifest = {
    generated_at: new Date().toISOString(),
    strapi_api_url: STRAPI_API_URL,
    source: {
      system: SOURCE_SYSTEM,
      input_file: path.relative(process.cwd(), INPUT_FILE),
      agents_file: path.relative(process.cwd(), AGENTS_FILE),
      materials_file: path.relative(process.cwd(), MATERIALS_FILE),
      source_record_count: airtableRecords.length,
    },
    load_order: [
      "agent-roles",
      "agents",
      "people",
      "materials",
      "galleries",
      "sub-galleries",
      "works",
    ],
    counts: {
      agent_roles: agentRoles.length,
      agents: transformedAgents.length,
      people: people.length,
      materials: transformedMaterials.length,
      galleries: galleries.length,
      sub_galleries: subGalleries.length,
      works: works.length,
      skipped_works: report.skipped.length,
      duplicate_iab_codes: report.duplicate_iab_codes.length,
      duplicate_source_rows: report.duplicate_source_rows.length,
      missing_material_lookup: report.missing_material_lookup.length,
    },
    files: Object.fromEntries(
      Object.entries(files).map(([name, filePath]) => [name, path.relative(process.cwd(), filePath)]),
    ),
  };

  writeIntermediate("manifest", manifest);

  console.log(`Wrote Strapi intermediate files to ${OUTPUT_DIR}`);
  console.log(JSON.stringify(manifest.counts, null, 2));
}

main();
