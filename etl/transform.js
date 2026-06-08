require("dotenv").config();

const fs = require("fs");
const path = require("path");

const STRAPI_API_URL = process.env.STRAPI_API_URL || "https://localhost:1337";
const INPUT_FILE = process.env.ETL_INPUT_FILE || path.join(__dirname, "airtable_dump.json");
const AGENTS_FILE = process.env.ETL_AGENTS_FILE || path.join(__dirname, "agents_distinct.csv");
const MATERIALS_FILE =
  process.env.ETL_MATERIALS_FILE || path.join(__dirname, "materials_distinct.csv");
const FIELD_MAPPING_FILE =
  process.env.ETL_FIELD_MAPPING_FILE || path.join(__dirname, "field-mapping.json");
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toHtml(value) {
  const text = cleanMultiline(value);
  if (!text) return undefined;

  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
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
        nameEn: name,
        nameAr: optional(agent.name_ar),
        slug: slugify(name),
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
      const label = compactWhitespace(material.materialEn || material.material_en);
      const slug = slugify(label);

      return buildEndpointRecord("material", "materials", slug, {
        nameEn: label,
        nameAr: optional(material.materialAr || material.material_ar),
      });
    })
    .filter((record) => record.request.body.data.nameEn)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function transformGalleries(records) {
  const galleries = uniqueByKey(
    records.map((record) => compactWhitespace(record.fields && record.fields.Gallery)).filter(Boolean),
    normalizeKey,
  ).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  return galleries.map((gallery, index) =>
    buildEndpointRecord("gallery", "galleries", slugify(gallery), {
      eyebrowEn: `Gallery ${index + 1}`,
      nameEn: gallery,
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

function sourceFieldCoverage(records, fieldMapping) {
  const observedSourceFields = Array.from(
    new Set(records.flatMap((record) => Object.keys(record.fields || {}))),
  ).sort();
  const configuredFields = fieldMapping.fields || {};

  const accounted = observedSourceFields
    .filter((field) => configuredFields[field])
    .map((field) => ({
      source_field: field,
      status: configuredFields[field].status,
      target: configuredFields[field].target,
      reason: configuredFields[field].reason,
      notes: configuredFields[field].notes,
    }));

  const counts = accounted.reduce(
    (memo, item) => {
      memo[item.status] = (memo[item.status] || 0) + 1;
      return memo;
    },
    { mapped: 0, planned: 0, ignored: 0 },
  );

  return {
    accounted,
    unmapped: observedSourceFields.filter((field) => !configuredFields[field]),
    configured_but_unobserved: Object.keys(configuredFields)
      .filter((field) => !observedSourceFields.includes(field))
      .sort(),
    counts,
  };
}

function transformWorks(records, materialLookup, fieldMapping) {
  const works = [];
  const report = {
    skipped: [],
    duplicate_iab_codes: [],
    duplicate_source_rows: [],
    missing_material_lookup: [],
    source_field_coverage: sourceFieldCoverage(records, fieldMapping),
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
      iabCode: primaryIabCode,
      titleEn,
      titleAr,
      originEn: optional(fields.Origin),
      originAr: optional(fields["Origin AR"]),
      dimensionEn: optional(fields.Dimension),
      dimensionAr: optional(fields["Dimension AR"]),
      materialDisplayEn: optional(fields.Material),
      materialDisplayAr: optional(fields["Material AR"]),
      descriptionEn: toHtml(fields.Description),
      descriptionAr: toHtml(fields["Description AR"]),
      footnoteEn: toHtml(fields["Footnote reference"]),
      footnoteAr: toHtml(fields["Footnote reference AR"]),
      creditLineEn: optional(fields["Credit Line"]),
      creditLineAr: optional(fields["Credit Line AR"]),
      dateDisplayGregorianEn: optional(fields.Date),
      dateDisplayGregorianAr: optional(fields["Date AR"]),
      contributorUrl: optional(fields["Contributor URL"]),
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
          agentCredits: relationRefs("agent-role", [
            ...agentKeysForRecord(fields, "Writer(s)", "Writer"),
            ...agentKeysForRecord(fields, "Curator(s)", "Curator"),
          ]),
          gallery: relationRefFromValue("gallery", fields.Gallery),
          materials: relationRefs("material", materialRefs),
        },
        { iabCode: primaryIabCode },
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
  const fieldMapping = readJson(FIELD_MAPPING_FILE);
  const materialLookup = {
    byExact: new Map(
      materials
        .map((material) => {
          const label = material.materialEn || material.material_en;
          return [normalizeKey(label), slugify(label)];
        })
        .filter(([key]) => key),
    ),
    byPhrase: materials
      .map((material) => ({
        normalized: normalizeLookupText(material.materialEn || material.material_en),
        key: slugify(material.materialEn || material.material_en),
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
  const { works, report } = transformWorks(airtableRecords, materialLookup, fieldMapping);

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
      field_mapping_file: path.relative(process.cwd(), FIELD_MAPPING_FILE),
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
      accounted_source_fields: report.source_field_coverage.accounted.length,
      mapped_source_fields: report.source_field_coverage.counts.mapped || 0,
      planned_source_fields: report.source_field_coverage.counts.planned || 0,
      ignored_source_fields: report.source_field_coverage.counts.ignored || 0,
      unmapped_source_fields: report.source_field_coverage.unmapped.length,
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
