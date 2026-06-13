'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const fieldMapping = require('../etl/field-mapping.json');
const { transformWorks } = require('../etl/transform');

test('ETL reports Work titles longer than 255 characters', () => {
  const records = [
    {
      id: 'at-limit',
      fields: {
        'IAB Code': 'IAB-255',
        'Title of Object': 'a'.repeat(255),
      },
    },
    {
      id: 'over-limit',
      fields: {
        'IAB Code': 'IAB-256',
        'Title of Object': 'b'.repeat(256),
      },
    },
  ];

  const { report } = transformWorks(
    records,
    { byExact: new Map(), byPhrase: [] },
    fieldMapping,
  );

  assert.deepEqual(report.titles_over_255_characters, [
    {
      title: 'b'.repeat(256),
      iabCode: 'IAB-256',
    },
  ]);
});
