'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const records = require('../etl/airtable_dump.json');
const { transformCuratedStories } = require('../etl/transform');
const migration = require('../database/migrations/2026.06.08T03.00.00.preserve-curated-story-relations');

const projectRoot = path.join(__dirname, '..');

test('Curated Story schema owns shared Work and Gallery relations', () => {
  const story = require('../src/api/curated-story/content-types/curated-story/schema.json');
  const work = require('../src/api/work/content-types/work/schema.json');
  const gallery = require('../src/api/gallery/content-types/gallery/schema.json');

  assert.equal(story.options.draftAndPublish, true);
  assert.equal(story.attributes.authors.component, 'shared.agent-credit');
  assert.equal(story.attributes.authors.repeatable, true);
  assert.equal(story.attributes.works.relation, 'manyToMany');
  assert.equal(story.attributes.works.inversedBy, 'curatedStories');
  assert.equal(story.attributes.galleries.relation, 'manyToMany');
  assert.equal(story.attributes.galleries.inversedBy, 'curatedStories');
  assert.equal(work.attributes.curatedStories.mappedBy, 'works');
  assert.equal(gallery.attributes.curatedStories.mappedBy, 'galleries');
});

test('ETL creates shared exact-text stories and retains every Work association', () => {
  const { stories, report } = transformCuratedStories(records);
  const sourceRows = records.filter((record) =>
    String((record.fields || {})['Curated Story Essay'] || '').trim(),
  );

  assert.equal(sourceRows.length, 50);
  assert.equal(stories.length, 11);
  assert.equal(report.exact_groups, 11);
  assert.equal(report.source_rows, 50);
  assert.equal(report.near_duplicates.length, 1);
  assert.ok(
    report.metadata_conflicts.some((conflict) => conflict.field === 'authors'),
  );

  const relatedWorkCount = stories.reduce(
    (count, story) => count + story.relations.works.length,
    0,
  );
  assert.equal(relatedWorkCount, sourceRows.length);

  for (const story of stories) {
    assert.ok(story.request.body.data.titleEn);
    assert.ok(story.request.body.data.slug);
    assert.ok(story.request.body.data.essayEn);
    assert.ok(story.relations.works.length >= 1);
    for (const author of story.relations.authors || []) {
      assert.equal(author.agent.content_type, 'agent');
      assert.equal(author.agent_role.content_type, 'agent-role');
      assert.ok(author.sortOrder > 0);
    }
  }
});

test('ETL reports conflicting story metadata instead of merging or discarding it', () => {
  const essay = 'Shared essay';
  const { stories, report } = transformCuratedStories([
    {
      id: 'one',
      fields: {
        'IAB Code': 'IAB-1',
        'Curated Story Essay': essay,
        'Curated Story Essay AR': 'Arabic one',
      },
    },
    {
      id: 'two',
      fields: {
        'IAB Code': 'IAB-2',
        'Curated Story Essay': essay,
        'Curated Story Essay AR': 'Arabic two',
      },
    },
  ]);

  assert.equal(stories.length, 1);
  assert.equal(stories[0].request.body.data.essayAr, undefined);
  assert.equal(report.metadata_conflicts.length, 1);
  assert.deepEqual(report.metadata_conflicts[0].values, ['Arabic one', 'Arabic two']);
});

test('Curated Story relation migration validates without rewriting rows', async (context) => {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  context.after(() => knex.destroy());

  await knex.schema.createTable('curated_stories_works_lnk', (table) => {
    table.increments('id');
    table.integer('curated_story_id');
    table.integer('work_id');
  });
  await knex('curated_stories_works_lnk').insert([
    { curated_story_id: 1, work_id: 10 },
    { curated_story_id: 1, work_id: 11 },
  ]);

  const before = await knex('curated_stories_works_lnk').select().orderBy('id');
  await migration.up(knex);
  const after = await knex('curated_stories_works_lnk').select().orderBy('id');
  assert.deepEqual(after, before);
});

test('Curated Story relation migration rejects duplicate pairs', async (context) => {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  context.after(() => knex.destroy());

  await knex.schema.createTable('curated_stories_works_lnk', (table) => {
    table.increments('id');
    table.integer('curated_story_id');
    table.integer('work_id');
  });
  await knex('curated_stories_works_lnk').insert([
    { curated_story_id: 1, work_id: 10 },
    { curated_story_id: 1, work_id: 10 },
  ]);

  await assert.rejects(migration.up(knex), /duplicate relation pair/i);
});

test('generated types and API documentation include Curated Stories', () => {
  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );
  const pluginDocumentation = require('../src/extensions/documentation/documentation/1.0.0/full_documentation.json');
  const openApi = require('../specification.json');

  assert.match(generatedTypes, /interface ApiCuratedStoryCuratedStory/);
  assert.match(
    generatedTypes,
    /authors: Schema\.Attribute\.Component<'shared\.agent-credit', true>/,
  );
  assert.ok(pluginDocumentation.components.schemas.CuratedStory);
  assert.ok(openApi.components.schemas.ApiCuratedStoryCuratedStoryDocument);
});
