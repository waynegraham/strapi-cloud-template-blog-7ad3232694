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

function galleryKey(value) {
  return slugify(value);
}

function gallerySectionKey(parentName, sectionName) {
  return `${galleryKey(parentName)}--${slugify(sectionName)}`;
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

function workIdentifiers(iabCodes) {
  return iabCodes.map((value, index) => ({
    value,
    type: "IAB",
    preferred: index === 0,
    source: "Airtable IAB Code",
  }));
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

function transformGalleries(records, report) {
  const galleries = uniqueByKey(
    records.map((record) => compactWhitespace(record.fields && record.fields.Gallery)).filter(Boolean),
    normalizeKey,
  ).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  const topLevel = galleries.map((gallery, index) =>
    buildEndpointRecord("gallery", "galleries", galleryKey(gallery), {
      eyebrowEn: `Gallery ${index + 1}`,
      nameEn: gallery,
      displayTitle: gallery,
      slug: galleryKey(gallery),
      sortOrder: index + 1,
      level: "gallery",
    }),
  );

  const sourceSections = new Map();
  for (const record of records) {
    const fields = record.fields || {};
    const parentName = compactWhitespace(fields.Gallery);
    const sectionName = compactWhitespace(fields["Sub-gallery"]);
    if (!sectionName) continue;

    if (!parentName) {
      report.gallery_hierarchy.missing_parent.push({
        source_record_id: record.id,
        section_name: sectionName,
      });
      continue;
    }

    const key = gallerySectionKey(parentName, sectionName);
    const existing = sourceSections.get(key);
    if (existing && existing.sectionName !== sectionName) {
      report.gallery_hierarchy.duplicate_child_names.push({
        parent_name: parentName,
        normalized_child_key: key,
        child_names: uniqueByKey([existing.sectionName, sectionName], normalizeKey),
      });
      continue;
    }

    if (!existing) {
      sourceSections.set(key, { key, parentName, sectionName });
    }
  }

  const sectionsByParent = new Map();
  for (const section of sourceSections.values()) {
    const parentKey = galleryKey(section.parentName);
    if (!sectionsByParent.has(parentKey)) sectionsByParent.set(parentKey, []);
    sectionsByParent.get(parentKey).push(section);
  }

  const sections = [];
  for (const parentSections of sectionsByParent.values()) {
    parentSections.sort((a, b) =>
      a.sectionName.localeCompare(b.sectionName, "en", { sensitivity: "base" }),
    );

    parentSections.forEach((section, index) => {
      sections.push(
        buildEndpointRecord(
          "gallery",
          "galleries",
          section.key,
          {
            nameEn: section.sectionName,
            displayTitle: `${section.parentName} / ${section.sectionName}`,
            slug: section.key,
            sortOrder: index + 1,
            level: "section",
          },
          {
            parent: relationRef("gallery", galleryKey(section.parentName)),
          },
          {
            slug: section.key,
          },
        ),
      );
    });
  }

  report.gallery_hierarchy.section_assignments = records.filter((record) =>
    compactWhitespace((record.fields || {})["Sub-gallery"]),
  ).length;
  report.gallery_hierarchy.unique_sections = sections.length;

  return [...topLevel, ...sections];
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

function titleFromStory(value, fallback) {
  const firstLine = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const title = compactWhitespace(
    String(firstLine || "")
      .replace(/\*\*/g, "")
      .replace(/^(?:title|العنوان)\s*:\s*/i, ""),
  );

  return title || fallback;
}

function exactStoryText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizedStoryText(value) {
  return cleanMultiline(value).normalize("NFKC").toLocaleLowerCase();
}

function distinctPopulatedValues(records, fieldName) {
  return uniqueByKey(
    records
      .map((record) => optional((record.fields || {})[fieldName]))
      .filter(Boolean),
    (value) => value,
  );
}

function workKeyForSourceRecord(sourceRecord) {
  const iabCodes = splitIabCodes((sourceRecord.fields || {})["IAB Code"]);
  return iabCodes.length > 0 ? `${slugify(iabCodes[0])}--${sourceRecord.id}` : undefined;
}

function galleryRefForFields(fields) {
  if (compactWhitespace(fields["Sub-gallery"]) && compactWhitespace(fields.Gallery)) {
    return relationRef("gallery", gallerySectionKey(fields.Gallery, fields["Sub-gallery"]));
  }

  return relationRefFromValue("gallery", fields.Gallery);
}

function transformCuratedStories(records) {
  const groups = new Map();
  const report = {
    exact_groups: 0,
    source_rows: 0,
    near_duplicates: [],
    metadata_conflicts: [],
  };

  for (const sourceRecord of records) {
    const essayEn = exactStoryText((sourceRecord.fields || {})["Curated Story Essay"]);
    if (!essayEn.trim()) continue;

    report.source_rows += 1;
    if (!groups.has(essayEn)) groups.set(essayEn, []);
    groups.get(essayEn).push(sourceRecord);
  }

  const normalizedGroups = new Map();
  for (const [essayEn, sourceRecords] of groups) {
    const normalized = normalizedStoryText(essayEn);
    if (!normalizedGroups.has(normalized)) normalizedGroups.set(normalized, []);
    normalizedGroups.get(normalized).push({ essayEn, sourceRecords });
  }

  for (const candidates of normalizedGroups.values()) {
    if (candidates.length < 2) continue;
    report.near_duplicates.push({
      reason: "Essays differ in source formatting but normalize to the same text.",
      candidates: candidates.map(({ essayEn, sourceRecords }) => ({
        title_en: titleFromStory(essayEn, "Curated Story"),
        source_length: essayEn.length,
        source_record_ids: sourceRecords.map((record) => record.id),
      })),
    });
  }

  const usedKeys = new Map();
  const stories = Array.from(groups.entries()).map(([essayEn, sourceRecords], index) => {
    const titleEn = titleFromStory(essayEn, `Curated Story ${index + 1}`);
    const baseKey = slugify(titleEn, `curated-story-${index + 1}`);
    const occurrence = (usedKeys.get(baseKey) || 0) + 1;
    usedKeys.set(baseKey, occurrence);
    const key = occurrence === 1 ? baseKey : `${baseKey}-${occurrence}`;
    const values = {
      essayAr: distinctPopulatedValues(sourceRecords, "Curated Story Essay AR"),
      footnotesEn: distinctPopulatedValues(sourceRecords, "Curated Story Footnote"),
      footnotesAr: distinctPopulatedValues(sourceRecords, "Curated Story Footnote AR"),
    };

    for (const [field, fieldValues] of Object.entries(values)) {
      if (fieldValues.length > 1) {
        report.metadata_conflicts.push({
          story_key: key,
          field,
          source_record_ids: sourceRecords.map((record) => record.id),
          values: fieldValues,
        });
      }
    }

    const authorNames = uniqueByKey(
      sourceRecords.flatMap((record) => splitArrayField((record.fields || {})["Writer(s)"])),
      normalizeKey,
    );
    const authorVariants = uniqueByKey(
      sourceRecords.map((record) =>
        splitArrayField((record.fields || {})["Writer(s)"])
          .map(compactWhitespace)
          .sort((a, b) => a.localeCompare(b))
          .join(" | "),
      ),
      (value) => value,
    ).filter(Boolean);
    if (authorVariants.length > 1) {
      report.metadata_conflicts.push({
        story_key: key,
        field: "authors",
        resolution:
          "All distinct writers were retained as Agent Credits; review possible over-attribution.",
        source_record_ids: sourceRecords.map((record) => record.id),
        values: authorVariants,
      });
    }
    const workKeys = uniqueByKey(sourceRecords.map(workKeyForSourceRecord).filter(Boolean), (value) => value);
    const galleryRefs = uniqueByKey(
      sourceRecords.map((record) => galleryRefForFields(record.fields || {})).filter(Boolean),
      (reference) => reference.key,
    );

    return buildEndpointRecord(
      "curated-story",
      "curated-stories",
      key,
      {
        titleEn,
        titleAr: values.essayAr[0]
          ? titleFromStory(values.essayAr[0], undefined)
          : undefined,
        slug: key,
        essayEn: toHtml(essayEn),
        essayAr: values.essayAr.length === 1 ? toHtml(values.essayAr[0]) : undefined,
        footnotesEn:
          values.footnotesEn.length === 1 ? toHtml(values.footnotesEn[0]) : undefined,
        footnotesAr:
          values.footnotesAr.length === 1 ? toHtml(values.footnotesAr[0]) : undefined,
        sortOrder: index + 1,
      },
      {
        authors: authorNames.map((name, authorIndex) => ({
          agent: relationRef("agent", slugify(name)),
          agent_role: relationRef("agent-role", `${slugify(name)}--writer`),
          sortOrder: authorIndex + 1,
        })),
        works: relationRefs("work", workKeys),
        galleries: galleryRefs,
      },
      { slug: key },
    );
  });

  report.exact_groups = stories.length;
  return { stories, report };
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
    gallery_hierarchy: {
      section_assignments: 0,
      unique_sections: 0,
      missing_parent: [],
      duplicate_child_names: [],
    },
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
      identifiers: workIdentifiers(iabCodes),
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
          gallery:
            compactWhitespace(fields["Sub-gallery"]) && compactWhitespace(fields.Gallery)
            ? relationRef(
                "gallery",
                gallerySectionKey(fields.Gallery, fields["Sub-gallery"]),
              )
            : relationRefFromValue("gallery", fields.Gallery),
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
  const { works, report } = transformWorks(airtableRecords, materialLookup, fieldMapping);
  const galleries = transformGalleries(airtableRecords, report);
  const { stories: curatedStories, report: curatedStoryReport } =
    transformCuratedStories(airtableRecords);
  report.curated_stories = curatedStoryReport;

  const files = {
    "agent-roles": writeIntermediate("agent-roles", agentRoles),
    agents: writeIntermediate("agents", transformedAgents),
    people: writeIntermediate("people", people),
    materials: writeIntermediate("materials", transformedMaterials),
    galleries: writeIntermediate("galleries", galleries),
    works: writeIntermediate("works", works),
    "curated-stories": writeIntermediate("curated-stories", curatedStories),
    "curated-story-review": writeIntermediate(
      "curated-story-review",
      curatedStoryReport,
    ),
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
      "works",
      "curated-stories",
    ],
    counts: {
      agent_roles: agentRoles.length,
      agents: transformedAgents.length,
      people: people.length,
      materials: transformedMaterials.length,
      galleries: galleries.length,
      gallery_sections: report.gallery_hierarchy.unique_sections,
      gallery_section_assignments: report.gallery_hierarchy.section_assignments,
      gallery_hierarchy_errors:
        report.gallery_hierarchy.missing_parent.length +
        report.gallery_hierarchy.duplicate_child_names.length,
      works: works.length,
      curated_stories: curatedStories.length,
      curated_story_source_rows: curatedStoryReport.source_rows,
      curated_story_near_duplicates: curatedStoryReport.near_duplicates.length,
      curated_story_metadata_conflicts: curatedStoryReport.metadata_conflicts.length,
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

  if (manifest.counts.gallery_hierarchy_errors > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  galleryKey,
  gallerySectionKey,
  splitIabCodes,
  transformCuratedStories,
  transformGalleries,
  transformWorks,
  workIdentifiers,
};
