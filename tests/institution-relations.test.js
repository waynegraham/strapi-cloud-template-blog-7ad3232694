'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const projectRoot = path.join(__dirname, '..');
const migration = require('../database/migrations/2026.06.08T01.00.00.preserve-work-institution-relations');

async function relationDatabase(rows) {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await knex.schema.createTable('works_institution_lnk', (table) => {
    table.increments('id');
    table.integer('work_id');
    table.integer('institution_id');
  });
  await knex('works_institution_lnk').insert(rows);

  return knex;
}

test('Work owns one Institution and Institution exposes inverse Works', () => {
  const institution = require('../src/api/institution/content-types/institution/schema.json');
  const work = require('../src/api/work/content-types/work/schema.json');

  assert.equal(work.attributes.institution.relation, 'manyToOne');
  assert.equal(work.attributes.institution.target, 'api::institution.institution');
  assert.equal(work.attributes.institution.inversedBy, 'works');
  assert.equal(institution.attributes.works.relation, 'oneToMany');
  assert.equal(institution.attributes.works.target, 'api::work.work');
  assert.equal(institution.attributes.works.mappedBy, 'institution');
});

test('institution cardinality migration validates without rewriting relation rows', () => {
  const migrationPath = path.join(
    projectRoot,
    'database/migrations/2026.06.08T01.00.00.preserve-work-institution-relations.js',
  );
  const source = fs.readFileSync(migrationPath, 'utf8');

  assert.match(source, /works_institution_lnk/);
  assert.match(source, /multiple Institutions/);
  assert.doesNotMatch(source, /\.(?:delete|del|truncate|update|insert)\s*\(/);
});

test('institution cardinality migration preserves valid existing links', async (context) => {
  const knex = await relationDatabase([
    { work_id: 1, institution_id: 51 },
    { work_id: 6, institution_id: 52 },
  ]);
  context.after(() => knex.destroy());

  const before = await knex('works_institution_lnk').select().orderBy('id');
  await migration.up(knex);
  const after = await knex('works_institution_lnk').select().orderBy('id');

  assert.deepEqual(after, before);
});

test('institution cardinality migration rejects one Work linked to multiple Institutions', async (context) => {
  const knex = await relationDatabase([
    { work_id: 1, institution_id: 51 },
    { work_id: 1, institution_id: 52 },
  ]);
  context.after(() => knex.destroy());

  await assert.rejects(migration.up(knex), /linked to multiple Institutions/);
});

test('current ETL source does not claim an unsupported Institution mapping', () => {
  const fieldMapping = require('../etl/field-mapping.json');
  const records = require('../etl/airtable_dump.json');
  const observedFields = new Set(
    records.flatMap((record) => Object.keys(record.fields || {})),
  );

  assert.equal(fieldMapping.fields.Institution, undefined);
  assert.equal(observedFields.has('Institution'), false);
});

test('generated types and API documentation include the Institution inverse', () => {
  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );
  const pluginDocumentation = require('../src/extensions/documentation/documentation/1.0.0/full_documentation.json');
  const openApi = require('../specification.json');

  assert.match(
    generatedTypes,
    /works: Schema\.Attribute\.Relation<'oneToMany', 'api::work\.work'>/,
  );
  assert.match(
    generatedTypes,
    /institution: Schema\.Attribute\.Relation<\s*'manyToOne',\s*'api::institution\.institution'/,
  );
  assert.equal(
    pluginDocumentation.components.schemas.Institution.properties.works.type,
    'array',
  );
  assert.equal(
    openApi.components.schemas.ApiInstitutionInstitutionDocument.properties.works.type,
    'array',
  );
  assert.equal(
    openApi.components.schemas.ApiWorkWorkDocument.properties.institution.$ref,
    '#/components/schemas/ApiInstitutionInstitutionDocument',
  );
});
