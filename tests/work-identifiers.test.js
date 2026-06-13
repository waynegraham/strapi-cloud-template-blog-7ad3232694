'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const records = require('../etl/airtable_dump.json');
const fieldMapping = require('../etl/field-mapping.json');
const { transformWorks } = require('../etl/transform');
const migration = require('../database/migrations/2026.06.08T02.00.00.preserve-work-identifiers');
const {
  registerWorkValidation,
  validateAgentCredits,
  validateDateRange,
  validateIdentifiers,
  validateWorkWrite,
} = require('../src/api/work/content-types/work/validation');

const projectRoot = path.join(__dirname, '..');

async function workDatabase(works) {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await knex.schema.createTable('works', (table) => {
    table.increments('id');
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
  await knex('works').insert(works);

  return knex;
}

test('Work schema retains searchable iabCode and adds repeatable identifiers', () => {
  const schema = require('../src/api/work/content-types/work/schema.json');
  const component = require('../src/components/shared/work-identifier.json');

  assert.equal(schema.attributes.iabCode.required, true);
  assert.equal(schema.attributes.iabCode.unique, undefined);
  assert.equal(schema.attributes.identifiers.type, 'component');
  assert.equal(schema.attributes.identifiers.component, 'shared.work-identifier');
  assert.equal(schema.attributes.identifiers.repeatable, true);
  assert.equal(schema.attributes.identifiers.required, true);
  assert.equal(component.attributes.value.required, true);
  assert.equal(component.attributes.type.default, 'IAB');
  assert.equal(component.attributes.preferred.default, false);
});

test('identifier validation synchronizes iabCode from one preferred IAB identifier', () => {
  const result = validateIdentifiers([
    { value: ' 25-MD-17-0950 ', preferred: true },
    { value: 'ALT-1', type: 'Legacy', preferred: false, source: ' Catalog ' },
  ]);

  assert.equal(result.iabCode, '25-MD-17-0950');
  assert.deepEqual(result.identifiers, [
    {
      value: '25-MD-17-0950',
      type: 'IAB',
      preferred: true,
    },
    {
      value: 'ALT-1',
      type: 'Legacy',
      preferred: false,
      source: 'Catalog',
    },
  ]);
});

test('identifier validation rejects missing, duplicate, or ambiguous preferred identifiers', () => {
  assert.throws(() => validateIdentifiers([]), /at least one identifier/i);
  assert.throws(
    () =>
      validateIdentifiers([
        { value: 'IAB-1', type: 'IAB', preferred: true },
        { value: 'iab-1', type: 'iab', preferred: false },
      ]),
    /duplicated within this Work/i,
  );
  assert.throws(
    () =>
      validateIdentifiers([
        { value: 'IAB-1', type: 'IAB', preferred: true },
        { value: 'IAB-2', type: 'IAB', preferred: true },
      ]),
    /exactly one preferred IAB/i,
  );
  assert.throws(
    () => validateIdentifiers([{ value: 'ALT-1', type: 'Legacy', preferred: true }]),
    /exactly one preferred IAB/i,
  );
});

test('partial Work updates retain existing identifiers and derived iabCode', async () => {
  const context = {
    uid: 'api::work.work',
    action: 'update',
    params: {
      documentId: 'work-1',
      data: { titleEn: 'Updated title', iabCode: 'ignored-direct-edit' },
    },
  };
  const strapi = {
    documents(uid) {
      assert.equal(uid, 'api::work.work');
      return {
        async findOne() {
          return {
            iabCode: 'IAB-1',
            identifiers: [{ id: 9, value: 'IAB-1', type: 'IAB', preferred: true }],
          };
        },
      };
    },
  };

  await validateWorkWrite(strapi, context);

  assert.equal(context.params.data.iabCode, 'IAB-1');
  assert.deepEqual(context.params.data.identifiers, [
    { id: 9, value: 'IAB-1', type: 'IAB', preferred: true },
  ]);
});

test('partial Work updates do not revalidate unchanged Agent Credit rows', async () => {
  const context = {
    uid: 'api::work.work',
    action: 'update',
    params: {
      documentId: 'work-1',
      data: {
        dateDisplayHijriEn: '1446',
        dateDisplayHijriAr: '١٤٤٦',
        agentCredits: [{}],
      },
    },
  };
  const strapi = {
    documents() {
      return {
        async findOne() {
          return {
            titleEn: 'Soft Gates',
            iabCode: '25-G1-01-5034',
            identifiers: [
              { value: '25-G1-01-5034', type: 'IAB', preferred: true },
            ],
            agentCredits: [{ id: 101, agent: null, agent_role: null, sortOrder: 1 }],
          };
        },
      };
    },
  };

  await validateWorkWrite(strapi, context);

  assert.equal(context.params.data.dateDisplayHijriEn, '1446');
  assert.equal(Object.prototype.hasOwnProperty.call(context.params.data, 'agentCredits'), false);
});

test('partial Work updates preserve complete Agent Credits from id-only form rows', async () => {
  const context = {
    uid: 'api::work.work',
    action: 'update',
    params: {
      documentId: 'work-1',
      data: {
        dateDisplayHijriEn: '1446',
        dateDisplayHijriAr: '١٤٤٦',
        agentCredits: [{ id: 101 }],
      },
    },
  };
  const strapi = {
    documents() {
      return {
        async findOne() {
          return {
            titleEn: 'Soft Gates',
            iabCode: '25-G1-01-5034',
            identifiers: [
              { value: '25-G1-01-5034', type: 'IAB', preferred: true },
            ],
            agentCredits: [
              {
                id: 101,
                agent: { documentId: 'agent-1' },
                agent_role: { documentId: 'role-1' },
                sortOrder: 1,
              },
            ],
          };
        },
      };
    },
  };

  await validateWorkWrite(strapi, context);

  assert.equal(context.params.data.dateDisplayHijriEn, '1446');
  assert.equal(Object.prototype.hasOwnProperty.call(context.params.data, 'agentCredits'), false);
});

test('partial Work updates ignore empty Agent Credit relation mutations', async () => {
  const context = {
    uid: 'api::work.work',
    action: 'update',
    params: {
      documentId: 'work-1',
      data: {
        titleEn: 'Soft Gates',
        agentCredits: [
          {
            id: 101,
            agent: { connect: [], disconnect: [] },
            agent_role: { connect: [], disconnect: [] },
            sortOrder: 1,
          },
        ],
      },
    },
  };
  const strapi = {
    documents() {
      return {
        async findOne() {
          return {
            titleEn: 'Soft Gates',
            iabCode: '25-G1-01-5034',
            identifiers: [
              { value: '25-G1-01-5034', type: 'IAB', preferred: true },
            ],
            agentCredits: [
              {
                id: 101,
                agent: { documentId: 'agent-1' },
                agent_role: { documentId: 'role-1' },
                sortOrder: 1,
              },
            ],
          };
        },
      };
    },
  };

  await validateWorkWrite(strapi, context);

  assert.equal(Object.prototype.hasOwnProperty.call(context.params.data, 'agentCredits'), false);
});

test('partial Work updates still reject changed incomplete Agent Credits', async () => {
  const context = {
    uid: 'api::work.work',
    action: 'update',
    params: {
      documentId: 'work-1',
      data: {
        agentCredits: [{ id: 101, agent: { connect: ['agent-1'] } }],
      },
    },
  };
  const strapi = {
    documents() {
      return {
        async findOne() {
          return {
            titleEn: 'Soft Gates',
            iabCode: '25-G1-01-5034',
            identifiers: [
              { value: '25-G1-01-5034', type: 'IAB', preferred: true },
            ],
            agentCredits: [
              {
                id: 101,
                agent: { documentId: 'agent-old' },
                agent_role: { documentId: 'role-1' },
              },
            ],
          };
        },
      };
    },
  };

  await assert.rejects(validateWorkWrite(strapi, context), /requires an Agent Role/i);
});

test('Work validation rejects inverted date ranges and incomplete Agent Credits', () => {
  assert.throws(() => validateDateRange(1900, 1800), /earliest year/i);
  assert.doesNotThrow(() => validateDateRange(1800, 1900));
  assert.throws(
    () =>
      validateAgentCredits([
        {
          agent: { documentId: 'agent-1' },
        },
      ]),
    /requires an Agent Role/i,
  );
  assert.throws(
    () =>
      validateAgentCredits([
        {
          agent_role: { connect: ['role-1'] },
        },
      ]),
    /requires an Agent/i,
  );
  assert.doesNotThrow(() =>
    validateAgentCredits([
      {
        agent: { connect: ['agent-1'] },
        agent_role: { set: ['role-1'] },
      },
    ]),
  );
});

test('partial Work updates validate dates against retained values', async () => {
  const context = {
    uid: 'api::work.work',
    action: 'update',
    params: {
      documentId: 'work-1',
      data: { earliestDate: 1950 },
    },
  };
  const strapi = {
    documents() {
      return {
        async findOne() {
          return {
            titleEn: 'Work',
            iabCode: 'IAB-1',
            earliestDate: 1800,
            latestDate: 1900,
            identifiers: [
              { value: 'IAB-1', type: 'IAB', preferred: true },
            ],
          };
        },
      };
    },
  };

  await assert.rejects(validateWorkWrite(strapi, context), /earliest year/i);
});

test('register installs Work validation as Document Service middleware', () => {
  let middleware;
  registerWorkValidation({
    documents: {
      use(candidate) {
        middleware = candidate;
      },
    },
  });

  assert.equal(typeof middleware, 'function');
});

test('identifier migration backfills every physical Work row without merging duplicates', async (context) => {
  const knex = await workDatabase([
    { id: 1, iab_code: 'IAB-1' },
    { id: 2, iab_code: 'IAB-1' },
    { id: 3, iab_code: 'IAB-2' },
  ]);
  context.after(() => knex.destroy());

  await migration.up(knex);

  assert.deepEqual(
    await knex('components_shared_work_identifiers')
      .select('value', 'type', 'preferred', 'source')
      .orderBy('id'),
    [
      { value: 'IAB-1', type: 'IAB', preferred: 1, source: 'Existing Work.iabCode' },
      { value: 'IAB-1', type: 'IAB', preferred: 1, source: 'Existing Work.iabCode' },
      { value: 'IAB-2', type: 'IAB', preferred: 1, source: 'Existing Work.iabCode' },
    ],
  );
  assert.equal(
    await knex('works_cmps')
      .where({ component_type: 'shared.work-identifier', field: 'identifiers' })
      .count({ count: '*' })
      .first()
      .then((row) => Number(row.count)),
    3,
  );
});

test('identifier migration is idempotent and rejects Work rows without codes', async (context) => {
  const knex = await workDatabase([{ id: 1, iab_code: 'IAB-1' }]);
  context.after(() => knex.destroy());

  await migration.up(knex);
  await migration.up(knex);
  assert.equal(
    await knex('components_shared_work_identifiers')
      .count({ count: '*' })
      .first()
      .then((row) => Number(row.count)),
    1,
  );

  const invalidKnex = await workDatabase([{ id: 2, iab_code: null }]);
  context.after(() => invalidKnex.destroy());
  await assert.rejects(migration.up(invalidKnex), /without iab_code/i);
});

test('ETL preserves every source IAB code and marks exactly one preferred', () => {
  const { works, report } = transformWorks(
    records,
    { byExact: new Map(), byPhrase: [] },
    fieldMapping,
  );
  const sourceById = new Map(records.map((record) => [record.id, record]));
  const multiCodeWorks = works.filter(
    (work) => work.request.body.data.identifiers.length > 1,
  );

  assert.equal(multiCodeWorks.length, 16);
  assert.equal(report.duplicate_source_rows.length, 16);
  assert.equal(report.duplicate_iab_codes.length, 30);

  for (const work of works) {
    const sourceId = work.key.split('--').at(-1);
    const sourceCodes = String(sourceById.get(sourceId).fields['IAB Code'])
      .split(/\s*,\s*/)
      .map((code) => code.trim())
      .filter(Boolean);
    const identifiers = work.request.body.data.identifiers;

    assert.deepEqual(
      identifiers.map((identifier) => identifier.value),
      sourceCodes,
    );
    assert.equal(
      identifiers.filter((identifier) => identifier.preferred).length,
      1,
    );
    assert.equal(work.request.body.data.iabCode, identifiers[0].value);
  }
});

test('generated types and API documentation include Work identifiers', () => {
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
    /identifiers: Schema\.Attribute\.Component<'shared\.work-identifier', true>/,
  );
  assert.doesNotMatch(
    generatedTypes,
    /iabCode: Schema\.Attribute\.String &\s*Schema\.Attribute\.Required &\s*Schema\.Attribute\.Unique/,
  );
  assert.match(generatedComponents, /interface SharedWorkIdentifier/);
  assert.ok(pluginDocumentation.components.schemas.SharedWorkIdentifierComponent);
  assert.ok(openApi.components.schemas.SharedWorkIdentifierEntry);
});
