'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadManifestRecords,
  loadSchemas,
  preservationChecks,
  representativeDataset,
  resolveRelations,
  stableDocumentId,
  validateMappingDestinations,
  validateRecords,
} = require('../etl/load');

const manifest = require('../etl/intermediate/manifest.json');
const transformReport = require('../etl/intermediate/report.json');
const fieldMapping = require('../etl/field-mapping.json');
const sourceRecords = require('../etl/airtable_dump.json');
const biographies = require('../etl/intermediate/agent-biography-review.json');
const iiifImages = require('../etl/intermediate/iiif-image-review.json');

function fixture() {
  const schemas = loadSchemas();
  const records = loadManifestRecords(manifest);
  const index = new Map(
    records.map((record) => [`${record.content_type}:${record.key}`, record]),
  );
  const documentIds = new Map(
    records.map((record) => [
      `${record.content_type}:${record.key}`,
      stableDocumentId(record),
    ]),
  );
  return { schemas, records, index, documentIds };
}

test('migration manifest contains only real Strapi destinations in dependency order', () => {
  assert.deepEqual(manifest.load_order, [
    'agents',
    'agent-roles',
    'materials',
    'galleries',
    'works',
    'curated-stories',
  ]);
  assert.equal(manifest.files.people, undefined);
  assert.equal(manifest.counts.people, undefined);
});

test('all mapping targets, payload fields, components, and references validate', () => {
  const { schemas, records, index } = fixture();

  assert.deepEqual(validateMappingDestinations(fieldMapping, schemas), []);
  assert.deepEqual(validateRecords(records, schemas, index), []);
  assert.equal(transformReport.source_field_coverage.unmapped.length, 0);
});

test('dry run resolves Agent Credit components to Strapi documentId relations', () => {
  const { schemas, records, index, documentIds } = fixture();
  const work = records.find(
    (record) =>
      record.content_type === 'work' &&
      Array.isArray(record.relations.agentCredits) &&
      record.relations.agentCredits.length > 0,
  );
  const resolved = resolveRelations(work, schemas, index, documentIds);

  assert.equal(resolved.agentCredits.length, work.relations.agentCredits.length);
  assert.match(resolved.agentCredits[0].agent.connect[0], /^[a-f0-9]{24}$/);
  assert.match(resolved.agentCredits[0].agent_role.connect[0], /^[a-f0-9]{24}$/);
  assert.equal(resolved.agentCredits[0].sortOrder, 1);
});

test('all transformed Works retain source provenance checksums', () => {
  const { records } = fixture();
  const preservation = preservationChecks(sourceRecords, records, transformReport);

  assert.equal(preservation.sourceRecords, 650);
  assert.equal(preservation.transformedWorks, 649);
  assert.deepEqual(preservation.checksumMismatches, []);
  assert.deepEqual(preservation.skippedWorks, [
    {
      source_record_id: 'rec1moouz3q1ED25Z',
      reason: 'missing IAB Code',
    },
  ]);
});

test('representative acceptance records are selected without guessing blocked matches', () => {
  const { records } = fixture();
  const dataset = representativeDataset(records, transformReport, {
    biographies,
    iiifImages,
  });

  assert.equal(dataset.subGallery.iabCode, '25-G1-01-5034');
  assert.equal(dataset.multipleIabCodes.iabCode, '25-G1-04-0126');
  assert.equal(dataset.inscriptionsAndDescriptions.iabCode, '25-G2-01-0198');
  assert.equal(dataset.agentBiography.status, 'blocked-pending-reconciliation');
  assert.equal(dataset.multipleIiifImages.minimumImages, 2);
  assert.equal(dataset.unresolvedMaterial.material, 'Fabrics');
});

test('generated dry-run report records zero schema errors and unresolved review counts', () => {
  const report = require('../etl/intermediate/migration-dry-run-report.json');

  assert.equal(report.counts.payloads, 982);
  assert.deepEqual(report.checks.unknownSourceFields, []);
  assert.deepEqual(report.checks.unknownSchemaDestinations, []);
  assert.deepEqual(report.checks.payloadValidationErrors, []);
  assert.deepEqual(report.checks.sourcePreservation.checksumMismatches, []);
  assert.equal(report.unresolved.materials, 25);
  assert.equal(report.unresolved.agentBiographies, 34);
  assert.equal(report.unresolved.iiifImages, 9);
});
