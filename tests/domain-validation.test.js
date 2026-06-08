'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const migration = require('../database/migrations/2026.06.08T09.00.00.audit-domain-validation-readiness');
const {
  normalizeName,
  registerAuthorityValidation,
  validateAuthorityWrite,
} = require('../src/api/shared/authority-validation');

function authorityStrapi(records) {
  return {
    documents() {
      return {
        async findOne({ documentId }) {
          return records.find((record) => record.documentId === documentId);
        },
        async findMany() {
          return records;
        },
      };
    },
  };
}

test('authority normalization ignores punctuation, spacing, case, and diacritics', () => {
  assert.equal(normalizeName('  École—Museum '), normalizeName('ecole museum'));
});

test('authority validation requires a preferred name and reports exact candidates', async () => {
  await assert.rejects(
    validateAuthorityWrite(authorityStrapi([]), {
      uid: 'api::institution.institution',
      action: 'create',
      params: { data: {} },
    }),
    /requires a preferred English or Arabic name/i,
  );

  await assert.rejects(
    validateAuthorityWrite(
      authorityStrapi([
        { documentId: 'institution-1', nameEn: 'National Library' },
      ]),
      {
        uid: 'api::institution.institution',
        action: 'create',
        params: { data: { nameEn: 'national library' } },
      },
    ),
    /Exact duplicate Institution candidate.*institution-1/i,
  );
});

test('authority validation reports normalized candidates', async () => {
  await assert.rejects(
    validateAuthorityWrite(
      authorityStrapi([
        { documentId: 'material-1', nameEn: 'Gold-leaf' },
      ]),
      {
        uid: 'api::material.material',
        action: 'create',
        params: { data: { nameEn: 'Gold leaf' } },
      },
    ),
    /Normalized duplicate Material candidate/i,
  );
});

test('same-name Agents are allowed only with distinct external identifiers', async () => {
  const existing = {
    documentId: 'agent-1',
    nameEn: 'Muhammad Ali',
    externalIdentifier: 'ulan:1',
  };

  await assert.doesNotReject(
    validateAuthorityWrite(authorityStrapi([existing]), {
      uid: 'api::agent.agent',
      action: 'create',
      params: {
        data: {
          nameEn: 'Muhammad Ali',
          externalIdentifier: 'ulan:2',
        },
      },
    }),
  );

  await assert.rejects(
    validateAuthorityWrite(authorityStrapi([existing]), {
      uid: 'api::agent.agent',
      action: 'create',
      params: { data: { nameEn: 'Muhammad Ali' } },
    }),
    /duplicate Agent candidate/i,
  );

  await assert.rejects(
    validateAuthorityWrite(authorityStrapi([existing]), {
      uid: 'api::agent.agent',
      action: 'create',
      params: {
        data: {
          nameEn: 'Different Display Name',
          externalIdentifier: 'ULAN:1',
        },
      },
    }),
    /external identifier.*already used/i,
  );
});

test('authority validation preserves values during partial updates', async () => {
  const record = {
    documentId: 'role-1',
    labelEn: 'Curator',
  };
  await assert.doesNotReject(
    validateAuthorityWrite(authorityStrapi([record]), {
      uid: 'api::agent-role.agent-role',
      action: 'update',
      params: {
        documentId: 'role-1',
        data: { labelAr: 'قيّم' },
      },
    }),
  );
});

test('register installs shared authority validation middleware', () => {
  let middleware;
  registerAuthorityValidation({
    documents: {
      use(candidate) {
        middleware = candidate;
      },
    },
  });
  assert.equal(typeof middleware, 'function');
});

test('migration audit reports legacy names, duplicates, and date ranges without rewriting', () => {
  const authorityAudit = migration.auditAuthorityRows(
    [
      { id: 1, document_id: 'one', name_en: 'École Museum' },
      { id: 2, document_id: 'two', name_en: 'Ecole-Museum' },
      { id: 3, document_id: 'three', name_en: '' },
    ],
    {
      label: 'Institution',
      nameColumns: ['name_en', 'name_ar'],
    },
  );
  const dateAudit = migration.auditWorkRows([
    {
      id: 1,
      document_id: 'work-1',
      earliest_date: 1950,
      latest_date: 1900,
    },
  ]);

  assert.equal(authorityAudit.duplicates.length, 1);
  assert.equal(authorityAudit.missingNames.length, 1);
  assert.equal(dateAudit.length, 1);
});

test('migration audit scopes Gallery duplicates by parent and edition', () => {
  const audit = migration.auditGalleryRows(
    [
      { id: 1, document_id: 'one', name_en: 'Section A' },
      { id: 2, document_id: 'two', name_en: 'Section-A' },
      { id: 3, document_id: 'three', name_en: 'Section A' },
    ],
    [
      { gallery_id: 1, inv_gallery_id: 10 },
      { gallery_id: 2, inv_gallery_id: 10 },
      { gallery_id: 3, inv_gallery_id: 11 },
    ],
    [
      { gallery_id: 1, biennale_edition_id: 20 },
      { gallery_id: 2, biennale_edition_id: 20 },
      { gallery_id: 3, biennale_edition_id: 20 },
    ],
  );

  assert.equal(audit.duplicates.length, 1);
  assert.deepEqual(audit.duplicates[0].documentIds, ['one', 'two']);
});

test('Agent schema and staff layout expose the disambiguating external identifier', () => {
  const schema = require('../src/api/agent/content-types/agent/schema.json');
  const { contentManagerLayouts } = require('../config/content-manager-layouts');
  const documentation = require('../src/extensions/documentation/documentation/1.0.0/full_documentation.json');
  const openApi = require('../specification.json');
  const layout = contentManagerLayouts['content_types::api::agent.agent'];

  assert.equal(schema.attributes.externalIdentifier.type, 'string');
  assert.equal(
    documentation.components.schemas.Agent.properties.externalIdentifier.type,
    'string',
  );
  assert.equal(
    openApi.components.schemas.ApiAgentAgentDocument.properties.externalIdentifier.type,
    'string',
  );
  assert.ok(
    layout.layouts.edit
      .flat()
      .some((field) => field.name === 'externalIdentifier'),
  );
});
