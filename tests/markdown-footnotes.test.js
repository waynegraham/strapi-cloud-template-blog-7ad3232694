'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  toHtml,
  transformFootnotedContent,
  transformWorks,
} = require('../etl/transform');
const fieldMapping = require('../etl/field-mapping.json');

test('Markdown conversion emits HTML, autolinks URLs, and escapes raw HTML', () => {
  const html = toHtml(
    '**Bold** and _italic_.\n\n<https://example.com>\n\n<script>alert(1)</script>',
  );

  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<a href="https:\/\/example.com">/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('Work footnotes renumber once in deterministic field order across locales', () => {
  const result = transformFootnotedContent({
    contentType: 'work',
    scope: 'work-example',
    sourceRecordId: 'record-1',
    bodies: [
      {
        name: 'descriptionEn',
        locale: 'en',
        value: 'Description **94** then **95**.',
      },
      {
        name: 'descriptionAr',
        locale: 'ar',
        value: 'الوصف94 ثم الوصف95.',
      },
      {
        name: 'manuscriptEn',
        locale: 'en',
        value: 'Manuscript **95**.',
      },
      {
        name: 'objectEn',
        locale: 'en',
        value: 'Object **102**.',
      },
      {
        name: 'inscriptionsEn',
        locale: 'en',
        value: 'Inscription **101**.',
      },
    ],
    footnotes: {
      en: '**94** First.\n\n**95** Second.\n\n**101** Fourth.\n\n**102** Third.',
      ar: '**94.** الأول.\n\n**95.** الثاني.\n\n**101.** الرابع.\n\n**102.** الثالث.',
    },
  });

  assert.deepEqual(result.renumbered, {
    94: '1',
    95: '2',
    101: '4',
    102: '3',
  });
  assert.match(
    result.bodies.descriptionEn,
    /<sup><a href="#work-example-en-footnote-1">1<\/a><\/sup>/,
  );
  assert.match(
    result.bodies.descriptionAr,
    /<sup><a href="#work-example-ar-footnote-1">1<\/a><\/sup>/,
  );
  assert.match(
    result.bodies.objectEn,
    /<sup><a href="#work-example-en-footnote-3">3<\/a><\/sup>/,
  );
  assert.match(
    result.bodies.inscriptionsEn,
    /<sup><a href="#work-example-en-footnote-4">4<\/a><\/sup>/,
  );
  assert.match(
    result.footnotes.en,
    /<strong id="work-example-en-footnote-1">1\.<\/strong>/,
  );
  assert.match(
    result.footnotes.ar,
    /<strong id="work-example-ar-footnote-1">1\.<\/strong>/,
  );
  assert.equal(result.report.unmatched_references.length, 0);
  assert.equal(result.report.unmatched_footnotes.length, 0);
  assert.equal(result.report.repeated_references.length, 1);
  assert.equal(result.report.repeated_references[0].original_number, '95');
});

test('unmatched references and notes retain source numbers and are reported', () => {
  const result = transformFootnotedContent({
    contentType: 'work',
    scope: 'work-review',
    sourceRecordId: 'record-2',
    bodies: [
      {
        name: 'descriptionEn',
        locale: 'en',
        value: 'Matched **94**, missing **96**, repeated **94**.',
      },
    ],
    footnotes: {
      en: '**94** Matched note.\n\n**97** Unreferenced note.',
    },
  });

  assert.match(result.bodies.descriptionEn, />1<\/a><\/sup>/);
  assert.match(result.bodies.descriptionEn, /<strong>96<\/strong>/);
  assert.match(result.footnotes.en, /<strong>97<\/strong>/);
  assert.equal(result.report.unmatched_references.length, 1);
  assert.equal(result.report.unmatched_references[0].original_number, '96');
  assert.equal(result.report.unmatched_footnotes.length, 1);
  assert.equal(result.report.unmatched_footnotes[0].original_number, '97');
  assert.equal(result.report.repeated_references.length, 1);
});

test('Work transform links extra descriptions and inscriptions to Work footnotes', () => {
  const source = [
    {
      id: 'record-3',
      fields: {
        'IAB Code': 'IAB-3',
        'Title of Object': 'Linked Work',
        Description: 'Description **94**.',
        'Extra Manuscript Description (endowment, author, calligrapher, page layout,etc)':
          'Manuscript **95**.',
        Inscriptions: 'Inscription **96**.',
        'Footnote reference':
          '**94** First.\n\n**95** Second.\n\n**96** Third.',
      },
    },
  ];
  const { works, report } = transformWorks(
    source,
    { byExact: new Map(), byPhrase: [] },
    fieldMapping,
  );
  const work = works[0].request.body.data;

  assert.match(work.descriptionEn, />1<\/a><\/sup>/);
  assert.match(work.additionalDescriptions[0].bodyEn, />2<\/a><\/sup>/);
  assert.match(work.inscriptions[0].text, />3<\/a><\/sup>/);
  assert.match(work.footnoteEn, /footnote-3">3\.<\/strong>/);
  assert.deepEqual(report.footnotes.unmatched_references, []);
});
