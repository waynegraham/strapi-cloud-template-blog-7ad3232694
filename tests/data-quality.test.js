'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const migration = require('../database/migrations/2026.06.08T11.00.00.add-work-review-metadata');
const queueService = require('../src/plugins/data-quality/server/src/services/queue');
const routes = require('../src/plugins/data-quality/server/src/routes');
const workSchema = require('../src/api/work/content-types/work/schema.json');
const { contentManagerLayouts } = require('../config/content-manager-layouts');

const projectRoot = path.join(__dirname, '..');

async function workDatabase() {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await knex.schema.createTable('works', (table) => {
    table.increments('id');
    table.string('document_id');
    table.string('iab_code');
    table.string('title_en');
  });
  await knex('works').insert({
    id: 1,
    document_id: 'work-1',
    iab_code: 'IAB-1',
    title_en: 'Example Work',
  });

  return knex;
}

function sampleData() {
  return {
    works: [
      {
        documentId: 'work-1',
        iabCode: 'IAB-1',
        displayTitle: 'IAB-1 - Example Work',
        titleEn: 'Example Work',
        titleAr: '',
        descriptionAr: '<p>&nbsp;</p>',
        gallery: null,
        institution: null,
        agentCredits: [],
        iiif_assets: [],
        reviewStatus: 'needs-review',
      },
      {
        documentId: 'work-2',
        iabCode: 'IAB-1',
        titleEn: 'Duplicate Work',
        titleAr: 'عمل',
        descriptionAr: '<p>وصف</p>',
        gallery: { documentId: 'gallery-1' },
        institution: { documentId: 'institution-1' },
        agentCredits: [{ id: 1 }],
        iiif_assets: [{ documentId: 'asset-1' }],
        reviewStatus: 'approved',
      },
    ],
    assets: [
      {
        documentId: 'asset-failed',
        title: 'Failed Asset',
        processingState: 'failed',
        processingErrors: 'Derivative generation failed.',
      },
    ],
    reports: {
      missingMaterials: [
        {
          source_record_id: 'source-1',
          iab_code: 'IAB-1',
          material: 'Unmatched medium',
        },
      ],
      biographies: [
        {
          source_record_id: 'source-1',
          iab_codes: ['IAB-1'],
          work_title: 'Example Work',
          review_decision: { decision: 'pending' },
        },
      ],
      iiifImages: [
        {
          source_record_id: 'source-1',
          iab_codes: ['IAB-1'],
          title_en: 'Example Work',
          status: 'unresolved',
          reason: 'No confirmed image identifier.',
        },
      ],
      duplicateIdentifiers: [
        {
          iab_code: 'IAB-1',
          count: 2,
        },
      ],
    },
  };
}

test('data-quality service exposes every named queue with Content Manager links', () => {
  const queues = queueService.buildQueues(sampleData());
  const byId = new Map(queues.map((queue) => [queue.id, queue]));

  assert.deepEqual(Array.from(byId.keys()), [
    'missing-arabic',
    'missing-placement',
    'missing-agent-credits',
    'unresolved-materials',
    'missing-or-failed-assets',
    'pending-biographies',
    'pending-image-folio',
    'duplicate-identifiers',
    'requires-review',
  ]);

  for (const queue of queues) {
    assert.ok(queue.items.length > 0, `${queue.id} should contain a sample item`);
  }

  assert.match(
    byId.get('missing-arabic').items[0].detail,
    /title and description/,
  );
  assert.equal(
    byId.get('missing-placement').items[0].adminPath,
    '/admin/content-manager/collection-types/api::work.work/work-1',
  );
  assert.equal(
    byId.get('unresolved-materials').items[0].adminPath,
    null,
    'a duplicated IAB code must not guess which Work owns a source report row',
  );
  assert.equal(
    byId.get('missing-or-failed-assets').items.find((item) =>
      item.key.startsWith('asset-'),
    ).adminPath,
    '/admin/content-manager/collection-types/api::iiif-asset.iiif-asset/asset-failed',
  );
  assert.equal(byId.get('duplicate-identifiers').items.length, 2);
  assert.equal(byId.get('requires-review').items.length, 1);
});

test('ETL report loading is explicit when artifacts are unavailable', () => {
  const result = queueService.loadReports('/path/that/does/not/exist');

  assert.equal(result.generatedAt, null);
  assert.equal(result.warnings.length, 4);
  assert.deepEqual(result.reports.missingMaterials, []);
  assert.deepEqual(result.reports.biographies, []);
});

test('data-quality plugin has an authenticated admin route and no public route', () => {
  assert.deepEqual(Object.keys(routes), ['admin']);
  assert.equal(routes.admin.type, 'admin');
  assert.deepEqual(routes.admin.routes[0].config.policies, [
    'admin::isAuthenticatedAdmin',
  ]);
  assert.equal(routes.admin.routes[0].path, '/queues');

  const pluginConfig = require('../config/plugins')();
  assert.equal(pluginConfig['data-quality'].enabled, true);
  assert.equal(pluginConfig['data-quality'].resolve, './src/plugins/data-quality');
});

test('Work review metadata is generic, private, and available in the staff layout', () => {
  for (const field of ['reviewStatus', 'reviewNotes', 'reviewedAt']) {
    assert.equal(workSchema.attributes[field].private, true);
  }
  assert.deepEqual(workSchema.attributes.reviewStatus.enum, [
    'not-reviewed',
    'needs-review',
    'approved',
    'blocked',
  ]);

  const layout = contentManagerLayouts['content_types::api::work.work'];
  assert.equal(layout.metadatas.reviewStatus.edit.label, 'Review status');
  assert.equal(layout.metadatas.reviewNotes.edit.label, 'Review notes');

  const schemaSource = fs.readFileSync(
    path.join(projectRoot, 'src/api/work/content-types/work/schema.json'),
    'utf8',
  );
  assert.doesNotMatch(schemaSource, /For Wen|Ready to export/i);
});

test('review metadata migration preserves Works and is idempotent', async (context) => {
  const knex = await workDatabase();
  context.after(() => knex.destroy());

  const first = await migration.up(knex);
  const second = await migration.up(knex);
  const work = await knex('works').where({ id: 1 }).first();

  assert.deepEqual(first.added, [
    'review_status',
    'review_notes',
    'reviewed_at',
  ]);
  assert.deepEqual(second.added, []);
  assert.equal(work.iab_code, 'IAB-1');
  assert.equal(work.review_status, 'not-reviewed');
  assert.equal(work.review_notes, null);
  assert.equal(work.reviewed_at, null);
});

test('generated artifacts retain privacy metadata and public OpenAPI omits review fields', () => {
  const openApi = require('../specification.json');
  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );

  assert.match(generatedTypes, /reviewStatus: Schema\.Attribute\.Enumeration/);
  assert.match(generatedTypes, /Schema\.Attribute\.Private/);
  assert.equal(
    openApi.components.schemas.ApiWorkWorkDocument.properties.reviewStatus,
    undefined,
  );
});
