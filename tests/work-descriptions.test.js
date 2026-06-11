'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const records = require('../etl/airtable_dump.json');
const fieldMapping = require('../etl/field-mapping.json');
const { transformWorks } = require('../etl/transform');
const migration = require('../database/migrations/2026.06.08T05.00.00.create-work-descriptions-component');

const projectRoot = path.join(__dirname, '..');
const manuscriptField =
  'Extra Manuscript Description (endowment, author, calligrapher, page layout,etc)';
const objectField =
  'Extra Object Related Information (maker, inscription, annotation, etc)';

test('Work schema exposes the repeatable typed description component', () => {
  const schema = require('../src/api/work/content-types/work/schema.json');
  const component = require('../src/components/shared/work-description.json');

  assert.deepEqual(schema.attributes.additionalDescriptions, {
    type: 'component',
    component: 'shared.work-description',
    repeatable: true,
  });
  assert.equal(component.info.displayName, 'Work Description');
  assert.deepEqual(component.attributes.type.enum, [
    'manuscript',
    'object',
    'general',
  ]);
  assert.equal(component.attributes.type.required, true);
  assert.equal(component.attributes.bodyEn.customField, 'plugin::ckeditor5.CKEditor');
  assert.equal(component.attributes.bodyAr.customField, 'plugin::ckeditor5.CKEditor');
  assert.equal(component.attributes.author.target, 'api::agent.agent');
});

test('ETL pairs all four source fields into typed bilingual components', () => {
  const { works } = transformWorks(
    records,
    { byExact: new Map(), byPhrase: [] },
    fieldMapping,
  );
  const sourceById = new Map(records.map((record) => [record.id, record]));
  const transformed = works.filter((work) =>
    Array.isArray(work.request.body.data.additionalDescriptions),
  );

  assert.equal(transformed.length, 263);
  assert.equal(
    transformed.reduce(
      (count, work) => count + work.request.body.data.additionalDescriptions.length,
      0,
    ),
    263,
  );

  const populatedCounts = {
    manuscriptEn: 0,
    manuscriptAr: 0,
    objectEn: 0,
    objectAr: 0,
  };

  for (const work of transformed) {
    const sourceId = work.key.split('--').at(-1);
    const fields = sourceById.get(sourceId).fields;
    const descriptions = work.request.body.data.additionalDescriptions;

    assert.deepEqual(
      descriptions.map((description) => description.sortOrder),
      descriptions.map((description) => (description.type === 'manuscript' ? 1 : 2)),
    );
    assert.ok(
      descriptions.every(
        (description) =>
          !description.bodyEn || description.bodyEn.startsWith('<'),
      ),
    );
    assert.ok(
      descriptions.every(
        (description) =>
          !description.bodyAr || description.bodyAr.startsWith('<'),
      ),
    );

    for (const description of descriptions) {
      if (description.type === 'manuscript') {
        if (description.bodyEn) populatedCounts.manuscriptEn += 1;
        if (description.bodyAr) populatedCounts.manuscriptAr += 1;
      }
      if (description.type === 'object') {
        if (description.bodyEn) populatedCounts.objectEn += 1;
        if (description.bodyAr) populatedCounts.objectAr += 1;
      }
    }
  }

  assert.deepEqual(populatedCounts, {
    manuscriptEn: records.filter((record) =>
      String((record.fields || {})[manuscriptField] || '').trim(),
    ).length,
    manuscriptAr: records.filter((record) =>
      String((record.fields || {})[`${manuscriptField} AR`] || '').trim(),
    ).length,
    objectEn: records.filter((record) =>
      String((record.fields || {})[objectField] || '').trim(),
    ).length,
    objectAr: records.filter((record) =>
      String((record.fields || {})[`${objectField} AR`] || '').trim(),
    ).length,
  });
});

test('field mapping marks all typed description source fields implemented', () => {
  for (const field of [
    manuscriptField,
    `${manuscriptField} AR`,
    objectField,
    `${objectField} AR`,
  ]) {
    assert.equal(fieldMapping.fields[field].status, 'mapped');
    assert.match(fieldMapping.fields[field].target, /work\.additionalDescriptions/);
  }
});

test('Work Description component migration is idempotent', async (context) => {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  context.after(() => knex.destroy());

  await migration.up(knex);
  await migration.up(knex);

  assert.equal(
    await knex.schema.hasTable('components_shared_work_descriptions'),
    true,
  );
  const columns = await knex('components_shared_work_descriptions').columnInfo();
  assert.equal(columns.type.nullable, false);
  assert.equal(columns.body_en.type, 'text');
  assert.equal(columns.body_ar.type, 'text');
  assert.equal(columns.sort_order.type, 'integer');
});

test('generated types and API documentation include Work descriptions', () => {
  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );
  const generatedComponents = fs.readFileSync(
    path.join(projectRoot, 'types/generated/components.d.ts'),
    'utf8',
  );
  const pluginDocumentation = require('../src/extensions/documentation/documentation/1.0.0/full_documentation.json');
  const openApi = require('../specification.json');

  assert.match(
    generatedTypes,
    /additionalDescriptions: Schema\.Attribute\.Component<\s*'shared\.work-description',\s*true\s*>/,
  );
  assert.match(generatedComponents, /interface SharedWorkDescription/);
  assert.ok(pluginDocumentation.components.schemas.SharedWorkDescriptionComponent);
  assert.ok(openApi.components.schemas.SharedWorkDescriptionEntry);
});
