'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const {
  contentManagerLayouts,
  workDisplayTitle,
} = require('../config/content-manager-layouts');
const migration = require('../database/migrations/2026.06.08T08.00.00.configure-staff-content-manager-layouts');
const { transformWorks } = require('../etl/transform');
const records = require('../etl/airtable_dump.json');
const fieldMapping = require('../etl/field-mapping.json');

const WORK_KEY = 'content_types::api::work.work';
const GALLERY_KEY = 'content_types::api::gallery.gallery';
const IIIF_IMAGE_KEY = 'content_types::api::iiif-image.iiif-image';
const projectRoot = path.join(__dirname, '..');

function flattenedEditLayout(configuration) {
  return configuration.layouts.edit.flat().map((field) => field.name);
}

async function layoutDatabase() {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await knex.schema.createTable('strapi_core_store_settings', (table) => {
    table.increments('id');
    table.string('key');
    table.text('value');
    table.string('type');
  });
  await knex.schema.createTable('works', (table) => {
    table.increments('id');
    table.string('iab_code');
    table.string('title_en');
  });

  return knex;
}

test('Work layout follows cataloging workflow and pairs bilingual fields', () => {
  const work = contentManagerLayouts[WORK_KEY];
  const fields = flattenedEditLayout(work);

  assert.deepEqual(fields.slice(0, 7), [
    'iabCode',
    'displayTitle',
    'titleEn',
    'titleAr',
    'identifiers',
    'gallery',
    'institution',
  ]);
  assert.ok(fields.indexOf('agentCredits') < fields.indexOf('dateDisplayGregorianEn'));
  assert.ok(fields.indexOf('materials') < fields.indexOf('descriptionEn'));
  assert.ok(fields.indexOf('additionalDescriptions') < fields.indexOf('inscriptions'));
  assert.ok(fields.indexOf('inscriptions') < fields.indexOf('curatedStories'));

  for (const pair of [
    ['titleEn', 'titleAr'],
    ['dateDisplayGregorianEn', 'dateDisplayGregorianAr'],
    ['dateDisplayHijriEn', 'dateDisplayHijriAr'],
    ['originEn', 'originAr'],
    ['dimensionEn', 'dimensionAr'],
    ['materialDisplayEn', 'materialDisplayAr'],
    ['creditLineEn', 'creditLineAr'],
  ]) {
    const row = work.layouts.edit.find((candidate) =>
      candidate.some((field) => field.name === pair[0]),
    );
    assert.deepEqual(row.map((field) => field.name), pair);
  }
});

test('staff metadata distinguishes controlled data and relation display titles', () => {
  const work = contentManagerLayouts[WORK_KEY];
  const gallery = contentManagerLayouts[GALLERY_KEY];

  assert.match(work.metadatas.materialDisplayEn.edit.description, /Published wording/);
  assert.match(work.metadatas.materials.edit.description, /Controlled terms/);
  assert.equal(work.metadatas.gallery.edit.mainField, 'displayTitle');
  assert.equal(gallery.metadatas.works.edit.mainField, 'displayTitle');
  assert.equal(work.metadatas.displayTitle.edit.editable, false);
  assert.equal(work.settings.mainField, 'displayTitle');
});

test('technical IIIF Image fields are hidden and list view remains useful', () => {
  const image = contentManagerLayouts[IIIF_IMAGE_KEY];

  for (const field of [
    's3key',
    'cantaloupeIdentifier',
    'width',
    'height',
    'infoJsonUrl',
    'thumbnailUrl',
  ]) {
    assert.equal(image.metadatas[field].edit.visible, false);
    assert.equal(image.metadatas[field].edit.editable, false);
  }

  assert.deepEqual(image.layouts.list, [
    'label',
    'sequence',
    'iiifAsset',
    'rightsStatement',
    'publishedAt',
  ]);
  assert.equal(image.settings.filterable, true);
  assert.equal(image.settings.defaultSortBy, 'sequence');
});

test('layout migration inserts, updates, and preserves unrelated metadata', async (context) => {
  const knex = await layoutDatabase();
  context.after(() => knex.destroy());
  const key = `plugin_content_manager_configuration_${WORK_KEY}`;
  await knex('strapi_core_store_settings').insert({
    key,
    type: 'object',
    value: JSON.stringify({
      settings: { pageSize: 10 },
      metadatas: {
        titleEn: {
          edit: { placeholder: 'Existing placeholder' },
          list: { searchable: false },
        },
      },
      layouts: { list: ['id'], edit: [] },
    }),
  });
  await knex('works').insert({
    id: 1,
    iab_code: '25-G1-01-5034',
    title_en: 'Soft Gates',
  });

  const first = await migration.up(knex);
  const second = await migration.up(knex);

  assert.equal(first.layouts.updated, 1);
  assert.equal(first.layouts.inserted, Object.keys(contentManagerLayouts).length - 1);
  assert.equal(second.layouts.updated, Object.keys(contentManagerLayouts).length);
  assert.equal(
    await knex('strapi_core_store_settings')
      .count({ count: '*' })
      .first()
      .then((row) => Number(row.count)),
    Object.keys(contentManagerLayouts).length,
  );

  const stored = JSON.parse(
    (await knex('strapi_core_store_settings').where({ key }).first()).value,
  );
  assert.equal(stored.settings.pageSize, 20);
  assert.equal(stored.settings.mainField, 'displayTitle');
  assert.equal(stored.metadatas.titleEn.edit.placeholder, '');
  assert.equal(stored.options.staffLayoutVersion, 1);
  assert.equal(
    (await knex('works').where({ id: 1 }).first()).display_title,
    '25-G1-01-5034 - Soft Gates',
  );
  assert.equal(second.workDisplayTitles.updated, 0);
});

test('Work display titles are generated in validation helpers and ETL payloads', () => {
  assert.equal(
    workDisplayTitle({ iabCode: ' IAB-1 ', titleEn: ' Example ' }),
    'IAB-1 - Example',
  );

  const { works } = transformWorks(
    records,
    { byExact: new Map(), byPhrase: [] },
    fieldMapping,
  );
  for (const work of works) {
    const data = work.request.body.data;
    assert.equal(data.displayTitle, `${data.iabCode} - ${data.titleEn}`);
  }
});

test('generated types and API documentation include Work displayTitle', () => {
  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );
  const pluginDocumentation = require('../src/extensions/documentation/documentation/1.0.0/full_documentation.json');
  const openApi = require('../specification.json');

  assert.match(generatedTypes, /displayTitle: Schema\.Attribute\.String/);
  assert.ok(pluginDocumentation.components.schemas.Work.properties.displayTitle);
  assert.ok(
    openApi.components.schemas.ApiWorkWorkDocument.properties.displayTitle,
  );
});
