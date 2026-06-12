'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ETL_DIR = __dirname;
const PROJECT_ROOT = path.join(ETL_DIR, '..');
const INTERMEDIATE_DIR =
  process.env.ETL_OUTPUT_DIR || path.join(ETL_DIR, 'intermediate');
const REPORT_FILE =
  process.env.ETL_DRY_RUN_REPORT ||
  path.join(INTERMEDIATE_DIR, 'migration-dry-run-report.json');
const APPLY = process.argv.includes('--apply');
const API_URL = (process.env.STRAPI_API_URL || 'http://localhost:1337').replace(/\/$/, '');
const API_TOKEN = process.env.STRAPI_API_TOKEN;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stableDocumentId(record) {
  return crypto
    .createHash('sha256')
    .update(`${record.content_type}:${record.key}`)
    .digest('hex')
    .slice(0, 24);
}

function loadSchemas() {
  const contentTypes = new Map();
  const components = new Map();
  const apiRoot = path.join(PROJECT_ROOT, 'src', 'api');
  const componentRoot = path.join(PROJECT_ROOT, 'src', 'components');

  for (const apiName of fs.readdirSync(apiRoot)) {
    const directory = path.join(apiRoot, apiName, 'content-types');
    if (!fs.existsSync(directory)) continue;
    for (const typeName of fs.readdirSync(directory)) {
      const schemaPath = path.join(directory, typeName, 'schema.json');
      if (!fs.existsSync(schemaPath)) continue;
      const schema = readJson(schemaPath);
      contentTypes.set(schema.info.singularName, {
        schema,
        endpoint: schema.info.pluralName,
        uid: `api::${schema.info.singularName}.${schema.info.singularName}`,
      });
    }
  }

  for (const category of fs.readdirSync(componentRoot)) {
    const directory = path.join(componentRoot, category);
    if (!fs.statSync(directory).isDirectory()) continue;
    for (const filename of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
      components.set(
        `${category}.${path.basename(filename, '.json')}`,
        readJson(path.join(directory, filename)),
      );
    }
  }

  return { contentTypes, components };
}

function loadManifestRecords(manifest) {
  const records = [];
  for (const name of manifest.load_order) {
    const relativePath = manifest.files[name];
    if (!relativePath) throw new Error(`Manifest load-order entry "${name}" has no file.`);
    const filePath = path.resolve(ETL_DIR, relativePath);
    for (const record of readJson(filePath)) records.push(record);
  }
  return records;
}

function recordIndex(records) {
  return new Map(records.map((record) => [`${record.content_type}:${record.key}`, record]));
}

function targetAttributes(target) {
  return String(target || '')
    .split('+')
    .map((part) => part.trim().match(/^([a-z0-9-]+)\.([A-Za-z0-9_]+)/))
    .filter(Boolean)
    .map((match) => ({ contentType: match[1], attribute: match[2] }));
}

function validateMappingDestinations(mapping, schemas) {
  const unknown = [];
  for (const [sourceField, config] of Object.entries(mapping.fields || {})) {
    if (!config.target) continue;
    for (const target of targetAttributes(config.target)) {
      const contentType = schemas.contentTypes.get(target.contentType);
      if (!contentType) {
        unknown.push({ sourceField, target: config.target, reason: 'unknown content type' });
      } else if (!contentType.schema.attributes[target.attribute]) {
        unknown.push({ sourceField, target: config.target, reason: 'unknown attribute' });
      }
    }
  }
  return unknown;
}

function validateComponent(value, componentName, schemas, location, errors) {
  const component = schemas.components.get(componentName);
  if (!component) {
    errors.push(`${location}: unknown component ${componentName}`);
    return;
  }
  const values = Array.isArray(value) ? value : [value];
  for (const [index, item] of values.entries()) {
    if (!item || typeof item !== 'object') {
      errors.push(`${location}[${index}]: component value must be an object`);
      continue;
    }
    for (const key of Object.keys(item)) {
      if (!component.attributes[key]) errors.push(`${location}[${index}].${key}: unknown field`);
    }
    for (const [key, attribute] of Object.entries(component.attributes)) {
      if (attribute.required && (item[key] === undefined || item[key] === '')) {
        errors.push(`${location}[${index}].${key}: required field is missing`);
      }
      if (attribute.type === 'component' && item[key] !== undefined) {
        validateComponent(
          item[key],
          attribute.component,
          schemas,
          `${location}[${index}].${key}`,
          errors,
        );
      }
    }
  }
}

function symbolicReferences(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) symbolicReferences(item, output);
  } else if (value && typeof value === 'object') {
    if (value.content_type && value.key) output.push(value);
    else for (const item of Object.values(value)) symbolicReferences(item, output);
  }
  return output;
}

function validateRecords(records, schemas, index) {
  const errors = [];
  for (const record of records) {
    const prefix = `${record.content_type}:${record.key}`;
    const contentType = schemas.contentTypes.get(record.content_type);
    if (!contentType) {
      errors.push(`${prefix}: unknown content type`);
      continue;
    }
    if (record.endpoint !== contentType.endpoint) {
      errors.push(`${prefix}: endpoint ${record.endpoint} should be ${contentType.endpoint}`);
    }
    const data = record.request?.body?.data;
    if (!data || typeof data !== 'object') {
      errors.push(`${prefix}: request.body.data is missing`);
      continue;
    }
    for (const key of Object.keys(data)) {
      if (!contentType.schema.attributes[key]) errors.push(`${prefix}.${key}: unknown field`);
    }
    for (const [key, attribute] of Object.entries(contentType.schema.attributes)) {
      if (attribute.required && (data[key] === undefined || data[key] === '')) {
        errors.push(`${prefix}.${key}: required field is missing`);
      }
      if (attribute.type === 'component' && data[key] !== undefined) {
        validateComponent(data[key], attribute.component, schemas, `${prefix}.${key}`, errors);
      }
    }
    for (const [field, value] of Object.entries(record.relations || {})) {
      const attribute = contentType.schema.attributes[field];
      if (!attribute) {
        errors.push(`${prefix}.relations.${field}: unknown schema destination`);
        continue;
      }
      if (!['relation', 'component'].includes(attribute.type)) {
        errors.push(`${prefix}.relations.${field}: destination is not relational`);
      }
      for (const reference of symbolicReferences(value)) {
        if (!index.has(`${reference.content_type}:${reference.key}`)) {
          errors.push(
            `${prefix}.relations.${field}: unresolved ${reference.content_type}:${reference.key}`,
          );
        }
      }
    }
  }
  return errors;
}

function resolveReference(reference, documentIds) {
  const documentId = documentIds.get(`${reference.content_type}:${reference.key}`);
  if (!documentId) throw new Error(`Unresolved reference ${reference.content_type}:${reference.key}`);
  return documentId;
}

function resolveNested(value, documentIds) {
  if (Array.isArray(value)) return value.map((item) => resolveNested(item, documentIds));
  if (!value || typeof value !== 'object') return value;
  if (value.content_type && value.key) {
    return { connect: [resolveReference(value, documentIds)] };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, resolveNested(item, documentIds)]),
  );
}

function resolveRelations(record, schemas, index, documentIds) {
  const contentType = schemas.contentTypes.get(record.content_type);
  const resolved = {};

  for (const [field, value] of Object.entries(record.relations || {})) {
    const attribute = contentType.schema.attributes[field];
    if (attribute.type === 'relation') {
      const references = symbolicReferences(value);
      resolved[field] = {
        set: references.map((reference) => resolveReference(reference, documentIds)),
      };
      continue;
    }

    if (
      attribute.type === 'component' &&
      attribute.component === 'shared.agent-credit' &&
      Array.isArray(value) &&
      value.every((item) => item.content_type === 'agent-role')
    ) {
      resolved[field] = value.map((roleReference, position) => {
        const roleRecord = index.get(`${roleReference.content_type}:${roleReference.key}`);
        const agentReference = symbolicReferences(roleRecord.relations.agents)[0];
        return {
          agent: { connect: [resolveReference(agentReference, documentIds)] },
          agent_role: { connect: [resolveReference(roleReference, documentIds)] },
          sortOrder: position + 1,
        };
      });
      continue;
    }

    resolved[field] = resolveNested(value, documentIds);
  }

  return resolved;
}

function sourceById(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function representativeDataset(records, report, reviews) {
  const works = records.filter((record) => record.content_type === 'work');
  const stories = records.filter((record) => record.content_type === 'curated-story');
  const storyWorkKeys = new Set(
    stories.flatMap((story) => symbolicReferences(story.relations.works).map((ref) => ref.key)),
  );
  const findWork = (predicate) => works.find(predicate);
  const pendingBiography = reviews.biographies.find(
    (row) => row.review_decision?.decision !== 'confirmed',
  );
  const unresolvedMaterial = report.missing_material_lookup[0];

  return {
    subGallery: findWork((work) => work.relations.gallery?.key.includes('--'))?.match || null,
    multipleIabCodes:
      findWork((work) => work.request.body.data.identifiers?.length > 1)?.match || null,
    curatedStory: findWork((work) => storyWorkKeys.has(work.key))?.match || null,
    inscriptionsAndDescriptions:
      findWork(
        (work) =>
          work.request.body.data.inscriptions?.length > 0 &&
          work.request.body.data.additionalDescriptions?.length > 0,
      )?.match || null,
    agentBiography: pendingBiography
      ? {
          sourceRecordId: pendingBiography.source_record_id,
          status: 'blocked-pending-reconciliation',
        }
      : null,
    unresolvedMaterial: unresolvedMaterial || null,
  };
}

function preservationChecks(sourceRecords, transformedRecords, transformReport) {
  const source = sourceById(sourceRecords);
  const works = transformedRecords.filter((record) => record.content_type === 'work');
  const checksumMismatches = [];
  for (const work of works) {
    const provenance = work.request.body.data.importProvenance;
    const sourceRecord = source.get(provenance.sourceRecordId);
    if (!sourceRecord) {
      checksumMismatches.push({ sourceRecordId: provenance.sourceRecordId, reason: 'missing source' });
      continue;
    }
    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(canonicalize(sourceRecord.fields || {})))
      .digest('hex');
    if (checksum !== provenance.sourceChecksum) {
      checksumMismatches.push({ sourceRecordId: provenance.sourceRecordId, reason: 'checksum' });
    }
  }
  return {
    sourceRecords: sourceRecords.length,
    transformedWorks: works.length,
    skippedWorks: transformReport.skipped,
    checksumMismatches,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function appendFilter(params, pathParts, value) {
  params.set(`filters${pathParts.map((part) => `[${part}]`).join('')}[$eq]`, value);
}

function matchFilters(record, index, documentIds) {
  if (record.content_type === 'work') {
    const data = record.request.body.data;
    const titleField = data.titleAr ? 'titleAr' : 'titleEn';
    return [
      ['iabCode', data.iabCode],
      [titleField, data[titleField]],
    ];
  }
  if (record.content_type === 'agent-role') {
    return [['labelEn', record.match.labelEn]];
  }
  if (record.request.body.data.slug) return [['slug', record.request.body.data.slug]];
  if (record.request.body.data.nameEn) return [['nameEn', record.request.body.data.nameEn]];
  throw new Error(`No idempotent match strategy for ${record.content_type}:${record.key}`);
}

function lookupParams(record, index, documentIds) {
  const params = new URLSearchParams();
  for (const filter of matchFilters(record, index, documentIds)) {
    appendFilter(params, filter.slice(0, -1), filter.at(-1));
  }
  params.set('status', 'draft');
  params.set('pagination[pageSize]', '2');
  return params;
}

function relationDataForApply(record, schemas, index, documentIds) {
  const relationData = resolveRelations(record, schemas, index, documentIds);

  if (record.content_type === 'agent-role' && relationData.agents?.set) {
    relationData.agents = { connect: relationData.agents.set };
  }

  return relationData;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_TOKEN}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} returned ${response.status}: ${text}`);
  }
  return body;
}

async function applyRecords(records, schemas, index) {
  if (!API_TOKEN) throw new Error('STRAPI_API_TOKEN is required with --apply.');
  const documentIds = new Map();
  const results = [];

  for (const record of records) {
    const params = lookupParams(record, index, documentIds);
    const existing = await apiRequest(`${API_URL}/api/${record.endpoint}?${params}`);
    if (existing.data.length > 1) {
      throw new Error(`Ambiguous match for ${record.content_type}:${record.key}`);
    }

    const relationData = relationDataForApply(record, schemas, index, documentIds);
    const body = JSON.stringify({
      data: { ...record.request.body.data, ...relationData },
    });
    const current = existing.data[0];
    const method = current ? 'PUT' : 'POST';
    const url = current
      ? `${API_URL}/api/${record.endpoint}/${current.documentId}`
      : `${API_URL}/api/${record.endpoint}`;
    const response = await apiRequest(url, { method, body });
    documentIds.set(
      `${record.content_type}:${record.key}`,
      response.data.documentId,
    );
    results.push({ contentType: record.content_type, key: record.key, method });
  }
  return results;
}

async function main() {
  const manifest = readJson(path.join(INTERMEDIATE_DIR, 'manifest.json'));
  const transformReport = readJson(path.join(INTERMEDIATE_DIR, 'report.json'));
  const fieldMapping = readJson(path.join(ETL_DIR, 'field-mapping.json'));
  const sourceRecords = readJson(path.join(ETL_DIR, 'airtable_dump.json'));
  const records = loadManifestRecords(manifest);
  const schemas = loadSchemas();
  const index = recordIndex(records);
  const documentIds = new Map(
    records.map((record) => [
      `${record.content_type}:${record.key}`,
      stableDocumentId(record),
    ]),
  );
  const unknownSchemaDestinations = validateMappingDestinations(fieldMapping, schemas);
  const validationErrors = validateRecords(records, schemas, index);

  if (validationErrors.length === 0) {
    for (const record of records) {
      resolveRelations(record, schemas, index, documentIds);
    }
  }

  const reviews = {
    biographies: readJson(path.join(INTERMEDIATE_DIR, 'agent-biography-review.json')),
  };
  const preservation = preservationChecks(sourceRecords, records, transformReport);
  const unresolved = {
    materials: transformReport.missing_material_lookup.length,
    agentBiographies: reviews.biographies.filter(
      (row) => row.review_decision?.decision !== 'confirmed',
    ).length,
    duplicateIabCodes: transformReport.duplicate_iab_codes.length,
    curatedStoryNearDuplicates: transformReport.curated_stories.near_duplicates.length,
    curatedStoryMetadataConflicts:
      transformReport.curated_stories.metadata_conflicts.length,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    importBatchId: manifest.import_batch_id,
    counts: {
      sourceRecords: sourceRecords.length,
      payloads: records.length,
      byContentType: Object.fromEntries(
        Array.from(
          records.reduce((counts, record) => {
            counts.set(record.content_type, (counts.get(record.content_type) || 0) + 1);
            return counts;
          }, new Map()),
        ),
      ),
    },
    checks: {
      unknownSourceFields: transformReport.source_field_coverage.unmapped,
      unknownSchemaDestinations,
      payloadValidationErrors: validationErrors,
      sourcePreservation: preservation,
    },
    representativeDataset: representativeDataset(records, transformReport, reviews),
    unresolved,
    applyResults: [],
  };

  if (
    report.checks.unknownSourceFields.length ||
    unknownSchemaDestinations.length ||
    validationErrors.length ||
    preservation.checksumMismatches.length
  ) {
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error(`Migration dry run failed; see ${REPORT_FILE}`);
  }

  if (APPLY) report.applyResults = await applyRecords(records, schemas, index);
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Migration ${report.mode} passed for ${records.length} payloads.`);
  console.log(`Wrote ${REPORT_FILE}`);
  if (!APPLY) console.log('No API requests were made. Use --apply for an authenticated load.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  loadSchemas,
  loadManifestRecords,
  lookupParams,
  matchFilters,
  preservationChecks,
  relationDataForApply,
  representativeDataset,
  resolveRelations,
  stableDocumentId,
  validateMappingDestinations,
  validateRecords,
};
