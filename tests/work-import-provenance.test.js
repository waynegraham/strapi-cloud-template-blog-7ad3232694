'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const records = require('../etl/airtable_dump.json');
const fieldMapping = require('../etl/field-mapping.json');
const {
  compareSourceChecksums,
  sourceChecksum,
  transformWorks,
} = require('../etl/transform');
const migration = require('../database/migrations/2026.06.08T13.00.00.create-work-import-provenance');

const projectRoot = path.join(__dirname, '..');

test('Work schema stores private single import provenance', () => {
  const schema = require('../src/api/work/content-types/work/schema.json');
  const component = require('../src/components/shared/import-provenance.json');
  const provenance = schema.attributes.importProvenance;

  assert.equal(provenance.type, 'component');
  assert.equal(provenance.component, 'shared.import-provenance');
  assert.equal(provenance.repeatable, false);
  assert.equal(provenance.private, true);
  assert.equal(component.attributes.sourceRecordId.required, true);
  assert.equal(component.attributes.sourceChecksum.minLength, 64);
  assert.equal(component.attributes.sourceChecksum.maxLength, 64);
  assert.equal(component.attributes.lastImportedAt.type, 'datetime');
});

test('source checksums are stable across object key order and detect changes', () => {
  const first = sourceChecksum({ b: 2, a: { d: 4, c: 3 } });
  const reordered = sourceChecksum({ a: { c: 3, d: 4 }, b: 2 });
  const changed = sourceChecksum({ a: { c: 3, d: 5 }, b: 2 });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('ETL gives every imported Work traceable provenance for one batch', () => {
  const batchId = 'airtable-test-batch';
  const importedAt = '2026-06-09T12:00:00.000Z';
  const { works } = transformWorks(
    records,
    { byExact: new Map(), byPhrase: [] },
    fieldMapping,
    { batchId, importedAt },
  );
  const sourceById = new Map(records.map((record) => [record.id, record]));

  assert.equal(works.length, 649);
  for (const work of works) {
    const provenance = work.request.body.data.importProvenance;
    assert.equal(provenance.sourceSystem, 'airtable');
    assert.equal(provenance.importBatchId, batchId);
    assert.equal(provenance.lastImportedAt, importedAt);
    assert.equal(
      provenance.sourceChecksum,
      sourceChecksum(sourceById.get(provenance.sourceRecordId).fields),
    );
    assert.equal(work.match.sourceRecordId, provenance.sourceRecordId);
    assert.equal(Object.hasOwn(provenance, 'fields'), false);
  }
});

test('checksum comparison identifies added, changed, unchanged, and removed rows', () => {
  const work = (id, checksum) => ({
    request: {
      body: {
        data: {
          importProvenance: {
            sourceRecordId: id,
            sourceChecksum: checksum,
          },
        },
      },
    },
  });
  const report = compareSourceChecksums(
    [work('same', 'a'), work('changed', 'b'), work('added', 'c')],
    [work('same', 'a'), work('changed', 'old'), work('removed', 'd')],
  );

  assert.deepEqual(report, {
    added: ['added'],
    changed: ['changed'],
    unchanged: ['same'],
    removed: ['removed'],
  });
});

test('migration creates provenance storage and audits legacy Works without guessing', async (context) => {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  context.after(() => knex.destroy());

  await knex.schema.createTable('works', (table) => {
    table.increments('id');
    table.string('document_id');
    table.string('iab_code');
  });
  await knex.schema.createTable('works_cmps', (table) => {
    table.increments('id');
    table.integer('entity_id');
    table.integer('cmp_id');
    table.string('component_type');
    table.string('field');
    table.float('order');
  });
  await knex('works').insert({
    document_id: 'work-1',
    iab_code: 'IAB-1',
  });

  const first = await migration.up(knex);
  const second = await migration.up(knex);
  const columns = await knex(
    'components_shared_import_provenances',
  ).columnInfo();

  assert.equal(first.componentTableCreated, true);
  assert.equal(second.componentTableCreated, false);
  assert.equal(first.existingWorks.total, 1);
  assert.equal(first.existingWorks.withProvenance, 0);
  assert.equal(first.existingWorks.unresolved[0].documentId, 'work-1');
  assert.equal(columns.source_checksum.maxLength, '64');
});

test('staff layout hides provenance and public OpenAPI omits it', () => {
  const { contentManagerLayouts } = require('../config/content-manager-layouts');
  const openApi = require('../specification.json');
  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );
  const layout =
    contentManagerLayouts['content_types::api::work.work'].metadatas
      .importProvenance;

  assert.equal(layout.edit.visible, false);
  assert.equal(layout.edit.editable, false);
  assert.match(
    generatedTypes,
    /importProvenance: Schema\.Attribute\.Component<[\s\S]*shared\.import-provenance/,
  );
  assert.match(generatedTypes, /Schema\.Attribute\.Private/);
  assert.equal(
    openApi.components.schemas.ApiWorkWorkDocument.properties.importProvenance,
    undefined,
  );
});
