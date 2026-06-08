'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const migration = require('../database/migrations/2026.06.08T07.00.00.normalize-iiif-image-rights');

const projectRoot = path.join(__dirname, '..');
const layoutKey =
  'plugin_content_manager_configuration_content_types::api::rights-statement.rights-statement';

async function rightsDatabase({ legacyArabic = false } = {}) {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await knex.schema.createTable('rights_statements', (table) => {
    table.increments('id');
    table.string('document_id');
    table.string('label_en');
    table.string(legacyArabic ? 'laben_ar' : 'label_ar');
    table.string('uri');
    table.datetime('published_at');
    table.string('locale');
  });
  await knex.schema.createTable('iiif_images', (table) => {
    table.increments('id');
    table.string('document_id');
    table.string('rights');
    table.datetime('published_at');
    table.string('locale');
  });
  await knex.schema.createTable('strapi_core_store_settings', (table) => {
    table.increments('id');
    table.string('key');
    table.text('value');
  });

  return knex;
}

test('Rights Statement and IIIF Image schemas use controlled rights fields', () => {
  const rights = require('../src/api/rights-statement/content-types/rights-statement/schema.json');
  const image = require('../src/api/iiif-image/content-types/iiif-image/schema.json');

  assert.equal(rights.attributes.labelAr.type, 'string');
  assert.equal(rights.attributes.labenAr, undefined);
  assert.equal(image.attributes.rights, undefined);
  assert.equal(image.attributes.rightsStatement.relation, 'manyToOne');
  assert.equal(
    image.attributes.rightsStatement.target,
    'api::rights-statement.rights-statement',
  );
  assert.equal(image.attributes.rightsNote.type, 'text');
});

test('migration preserves legacy Arabic labels under label_ar', async (context) => {
  const knex = await rightsDatabase({ legacyArabic: true });
  context.after(() => knex.destroy());
  await knex('rights_statements').insert({
    id: 1,
    document_id: 'rights-1',
    label_en: 'In Copyright',
    laben_ar: 'محمي بحقوق النشر',
  });

  await migration.up(knex);

  const columns = await knex('rights_statements').columnInfo();
  assert.ok(columns.label_ar);
  assert.equal(columns.laben_ar, undefined);
  assert.equal(
    (await knex('rights_statements').where({ id: 1 }).first()).label_ar,
    'محمي بحقوق النشر',
  );
});

test('migration matches URI and labels while preserving publication state', async (context) => {
  const knex = await rightsDatabase();
  context.after(() => knex.destroy());
  await knex('rights_statements').insert([
    {
      id: 1,
      document_id: 'rights-1',
      label_en: 'In Copyright',
      uri: 'https://rightsstatements.org/vocab/InC/1.0/',
    },
    {
      id: 2,
      document_id: 'rights-1',
      label_en: 'In Copyright',
      uri: 'https://rightsstatements.org/vocab/InC/1.0/',
      published_at: '2026-06-08',
    },
  ]);
  await knex('iiif_images').insert([
    {
      id: 10,
      document_id: 'image-draft',
      rights: 'https://rightsstatements.org/vocab/InC/1.0',
    },
    {
      id: 11,
      document_id: 'image-published',
      rights: 'In Copyright',
      published_at: '2026-06-08',
    },
  ]);

  const report = await migration.up(knex);

  assert.equal(report.matched.length, 2);
  assert.deepEqual(
    await knex('iiif_images_rights_statement_lnk')
      .select('iiif_image_id', 'rights_statement_id')
      .orderBy('iiif_image_id'),
    [
      { iiif_image_id: 10, rights_statement_id: 1 },
      { iiif_image_id: 11, rights_statement_id: 2 },
    ],
  );
});

test('migration retains unmatched and ambiguous rights as notes', async (context) => {
  const knex = await rightsDatabase();
  context.after(() => knex.destroy());
  await knex('rights_statements').insert([
    { id: 1, document_id: 'rights-1', label_en: 'Shared label' },
    { id: 2, document_id: 'rights-2', label_en: 'Shared label' },
  ]);
  await knex('iiif_images').insert([
    { id: 10, document_id: 'unmatched', rights: 'Local restrictions apply' },
    { id: 11, document_id: 'ambiguous', rights: 'Shared label' },
  ]);

  const originalWarn = console.warn;
  console.warn = () => {};
  context.after(() => {
    console.warn = originalWarn;
  });
  const report = await migration.up(knex);

  assert.equal(report.unmatched.length, 1);
  assert.equal(report.ambiguous.length, 1);
  assert.deepEqual(
    await knex('iiif_images').select('id', 'rights_note').orderBy('id'),
    [
      { id: 10, rights_note: 'Local restrictions apply' },
      { id: 11, rights_note: 'Shared label' },
    ],
  );
});

test('migration configures Rights Statement list fields and entry title', async (context) => {
  const knex = await rightsDatabase();
  context.after(() => knex.destroy());
  await knex('strapi_core_store_settings').insert({
    key: layoutKey,
    value: JSON.stringify({
      settings: { mainField: 'documentId' },
      layouts: { list: ['id'] },
      metadatas: {},
    }),
  });

  await migration.up(knex);

  const row = await knex('strapi_core_store_settings')
    .where({ key: layoutKey })
    .first();
  const configuration = JSON.parse(row.value);
  assert.equal(configuration.settings.mainField, 'labelEn');
  assert.deepEqual(configuration.layouts.list, ['labelEn', 'labelAr', 'uri']);
});

test('generated types and API documentation use normalized rights fields', () => {
  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );
  const pluginDocumentation = require('../src/extensions/documentation/documentation/1.0.0/full_documentation.json');
  const openApi = require('../specification.json');

  assert.match(generatedTypes, /labelAr: Schema\.Attribute\.String/);
  assert.doesNotMatch(generatedTypes, /labenAr/);
  assert.match(
    generatedTypes,
    /rightsStatement: Schema\.Attribute\.Relation<\s*'manyToOne',\s*'api::rights-statement\.rights-statement'/,
  );
  assert.match(generatedTypes, /rightsNote: Schema\.Attribute\.Text/);
  assert.ok(pluginDocumentation.components.schemas.RightsStatement.properties.labelAr);
  assert.equal(
    openApi.components.schemas.ApiIiifImageIiifImageDocument.properties.rightsStatement.$ref,
    '#/components/schemas/ApiRightsStatementRightsStatementDocument',
  );
});
