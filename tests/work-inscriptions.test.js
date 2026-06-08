'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const records = require('../etl/airtable_dump.json');
const fieldMapping = require('../etl/field-mapping.json');
const { transformWorks, workInscriptions } = require('../etl/transform');
const migration = require('../database/migrations/2026.06.08T04.00.00.create-work-inscriptions-component');
const {
  validateInscriptions,
  validateWorkWrite,
} = require('../src/api/work/content-types/work/validation');

const projectRoot = path.join(__dirname, '..');

test('Work schema exposes the repeatable Inscription component', () => {
  const schema = require('../src/api/work/content-types/work/schema.json');
  const component = require('../src/components/shared/inscription.json');

  assert.deepEqual(schema.attributes.inscriptions, {
    type: 'component',
    component: 'shared.inscription',
    repeatable: true,
  });
  assert.equal(component.info.displayName, 'Inscription');
  assert.equal(component.attributes.text.type, 'text');
  assert.equal(component.attributes.text.required, true);
  assert.deepEqual(component.attributes.type.enum, [
    'signature',
    'mark',
    'caption',
    'date',
    'text',
    'translation',
    'other',
  ]);
  assert.equal(component.attributes.author.target, 'api::agent.agent');
});

test('inscription validation rejects empty rows and preserves source text verbatim', () => {
  assert.throws(
    () => validateInscriptions([{ text: ' \n ' }]),
    /requires source text/i,
  );

  const sourceText = '  First line\r\nSecond line  ';
  assert.deepEqual(validateInscriptions([{ text: sourceText }]), [
    { text: sourceText },
  ]);
});

test('partial Work updates validate inscriptions when supplied', async () => {
  const context = {
    uid: 'api::work.work',
    action: 'update',
    params: {
      documentId: 'work-1',
      data: {
        inscriptions: [{ text: 'Source', translation: ' Translation ' }],
      },
    },
  };
  const strapi = {
    documents() {
      return {
        async findOne() {
          return {
            iabCode: 'IAB-1',
            identifiers: [{ value: 'IAB-1', type: 'IAB', preferred: true }],
          };
        },
      };
    },
  };

  await validateWorkWrite(strapi, context);

  assert.deepEqual(context.params.data.inscriptions, [
    { text: 'Source', translation: ' Translation ' },
  ]);
});

test('ETL maps each populated Airtable Inscriptions value to one component', () => {
  const { works } = transformWorks(
    records,
    { byExact: new Map(), byPhrase: [] },
    fieldMapping,
  );
  const sourceById = new Map(records.map((record) => [record.id, record]));
  const populated = records.filter((record) =>
    String((record.fields || {}).Inscriptions || '').trim(),
  );
  const transformed = works.filter((work) =>
    Array.isArray(work.request.body.data.inscriptions),
  );

  assert.equal(populated.length, 65);
  assert.equal(
    new Set(populated.map((record) => record.fields.Inscriptions)).size,
    64,
  );
  assert.equal(transformed.length, populated.length);

  for (const work of transformed) {
    const sourceId = work.key.split('--').at(-1);
    const sourceText = sourceById.get(sourceId).fields.Inscriptions;

    assert.deepEqual(work.request.body.data.inscriptions, workInscriptions(sourceText));
    assert.equal(work.request.body.data.inscriptions[0].text, sourceText);
    assert.equal(work.request.body.data.inscriptions[0].sortOrder, 1);
  }
});

test('inscription component migration is idempotent', async (context) => {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  context.after(() => knex.destroy());

  await migration.up(knex);
  await migration.up(knex);

  assert.equal(
    await knex.schema.hasTable('components_shared_inscriptions'),
    true,
  );
  const columns = await knex('components_shared_inscriptions').columnInfo();
  assert.equal(columns.text.nullable, false);
  assert.equal(columns.sort_order.type, 'integer');
});

test('generated types and API documentation include Work inscriptions', () => {
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
    /inscriptions: Schema\.Attribute\.Component<'shared\.inscription', true>/,
  );
  assert.match(generatedComponents, /interface SharedInscription/);
  assert.ok(pluginDocumentation.components.schemas.SharedInscriptionComponent);
  assert.ok(openApi.components.schemas.SharedInscriptionEntry);
});
