'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const records = require('../etl/airtable_dump.json');
const fieldMapping = require('../etl/field-mapping.json');
const {
  toBlocks,
  transformAgentBiographies,
  transformAgents,
} = require('../etl/transform');

const projectRoot = path.join(__dirname, '..');

test('biography reconciliation reports every source row without importing pending matches', () => {
  const result = transformAgentBiographies(records, []);
  const populatedRows = records.filter((record) => {
    const fields = record.fields || {};
    return [
      fields['Artist Biography for the Islamic Arts Biennale'],
      fields['Artist Biography for the Islamic Arts Biennale AR'],
    ].some((value) => String(value || '').trim());
  });

  assert.equal(result.review.length, populatedRows.length);
  assert.equal(result.report.source_rows, populatedRows.length);
  assert.equal(result.report.confirmed_rows, 0);
  assert.equal(result.report.imported_agents, 0);
  assert.equal(result.report.pending_rows, populatedRows.length);
  assert.equal(result.biographies.size, 0);
  assert.ok(result.review.every((item) => item.review_decision.decision === 'pending'));
  assert.ok(
    result.review.some(
      (item) =>
        item.source_record_id === 'recojoTvbjSQYdjo4' &&
        item.work_title === 'Soft Gates' &&
        item.iab_codes[0] === '25-G1-01-5034' &&
        item.proposed_agent.name_en === 'Hayat Osamah' &&
        item.proposed_agent.confidence === 'high',
    ),
  );
});

test('confirmed identical bilingual biographies produce one Artist Agent', () => {
  const source = [
    {
      id: 'one',
      fields: {
        'Title of Object': 'One',
        'IAB Code': 'IAB-1',
        'Artist Biography for the Islamic Arts Biennale': '**Artist One**\n\nBiography.',
        'Artist Biography for the Islamic Arts Biennale AR': 'سيرة',
      },
    },
    {
      id: 'two',
      fields: {
        'Title of Object': 'Two',
        'IAB Code': 'IAB-2',
        'Artist Biography for the Islamic Arts Biennale': '**Artist One**\n\nBiography.',
        'Artist Biography for the Islamic Arts Biennale AR': 'سيرة',
      },
    },
  ];
  const decisions = source.map((record) => ({
    source_record_id: record.id,
    decision: 'confirmed',
    agent_name_en: 'Artist One',
    agent_name_ar: 'الفنان الأول',
  }));
  const result = transformAgentBiographies(source, decisions);
  const agents = transformAgents(result.confirmedAgents, result.biographies);

  assert.equal(result.report.confirmed_rows, 2);
  assert.equal(result.report.imported_agents, 1);
  assert.equal(result.report.conflicts.length, 0);
  assert.equal(agents.length, 1);
  assert.deepEqual(
    agents[0].request.body.data.biographyEn,
    toBlocks('**Artist One**\n\nBiography.'),
  );
  assert.deepEqual(agents[0].request.body.data.biographyAr, toBlocks('سيرة'));
});

test('conflicting confirmed biography pairs are reported and not imported', () => {
  const source = ['First biography', 'Second biography'].map((biography, index) => ({
    id: `record-${index}`,
    fields: {
      'Title of Object': `Work ${index}`,
      'IAB Code': `IAB-${index}`,
      'Artist Biography for the Islamic Arts Biennale': biography,
      'Artist Biography for the Islamic Arts Biennale AR': `Arabic ${index}`,
    },
  }));
  const decisions = source.map((record) => ({
    source_record_id: record.id,
    decision: 'confirmed',
    agent_name_en: 'Same Artist',
  }));
  const result = transformAgentBiographies(source, decisions);

  assert.equal(result.report.conflicts.length, 1);
  assert.equal(result.report.imported_agents, 0);
  assert.equal(result.biographies.size, 0);
  assert.equal(result.confirmedAgents.length, 0);
  assert.match(result.report.conflicts[0].resolution, /No biography imported/);
});

test('field mapping and generated schema artifacts keep biographies on Agent', () => {
  assert.equal(
    fieldMapping.fields['Artist Biography for the Islamic Arts Biennale'].status,
    'mapped',
  );
  assert.equal(
    fieldMapping.fields['Artist Biography for the Islamic Arts Biennale AR'].status,
    'mapped',
  );

  const schema = require('../src/api/agent/content-types/agent/schema.json');
  assert.equal(schema.attributes.biographyEn.type, 'blocks');
  assert.equal(schema.attributes.biographyAr.type, 'blocks');

  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );
  const documentation = require('../src/extensions/documentation/documentation/1.0.0/full_documentation.json');
  assert.match(generatedTypes, /biographyEn: Schema\.Attribute\.Blocks/);
  assert.match(generatedTypes, /biographyAr: Schema\.Attribute\.Blocks/);
  assert.ok(documentation.components.schemas.Agent);
});
