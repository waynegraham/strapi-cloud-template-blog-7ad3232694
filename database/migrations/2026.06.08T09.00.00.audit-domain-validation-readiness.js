'use strict';

function cleanName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizeName(value) {
  return cleanName(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function logicalRows(rows) {
  const byDocument = new Map();

  for (const row of rows) {
    const key = row.document_id || `row:${row.id}`;
    const existing = byDocument.get(key);
    if (!existing || (existing.published_at && !row.published_at)) {
      byDocument.set(key, row);
    }
  }

  return Array.from(byDocument.values());
}

function auditAuthorityRows(rows, { label, nameColumns, identifierColumn }) {
  const missingNames = [];
  const duplicates = [];
  const byName = new Map();

  for (const row of logicalRows(rows)) {
    const name = nameColumns.map((column) => cleanName(row[column])).find(Boolean);
    if (!name) {
      missingNames.push({ id: row.id, documentId: row.document_id });
      continue;
    }

    const key = normalizeName(name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { row, name });
      continue;
    }

    const identifiersDiffer =
      identifierColumn &&
      cleanName(existing.row[identifierColumn]) &&
      cleanName(row[identifierColumn]) &&
      cleanName(existing.row[identifierColumn]).toLocaleLowerCase() !==
        cleanName(row[identifierColumn]).toLocaleLowerCase();
    if (!identifiersDiffer) {
      duplicates.push({
        label,
        names: [existing.name, name],
        documentIds: [existing.row.document_id, row.document_id],
      });
    }
  }

  return { missingNames, duplicates };
}

function auditWorkRows(rows) {
  return logicalRows(rows)
    .filter(
      (row) =>
        row.earliest_date !== null &&
        row.earliest_date !== undefined &&
        row.latest_date !== null &&
        row.latest_date !== undefined &&
        row.earliest_date > row.latest_date,
    )
    .map((row) => ({
      id: row.id,
      documentId: row.document_id,
      earliestDate: row.earliest_date,
      latestDate: row.latest_date,
    }));
}

function auditGalleryRows(rows, parentLinks, editionLinks) {
  const parentByGallery = new Map(
    parentLinks.map((link) => [
      String(link.gallery_id),
      String(link.inv_gallery_id),
    ]),
  );
  const editionByGallery = new Map(
    editionLinks.map((link) => [
      String(link.gallery_id),
      String(link.biennale_edition_id),
    ]),
  );
  const missingNames = [];
  const duplicates = [];
  const byScope = new Map();

  for (const row of logicalRows(rows)) {
    const name = cleanName(row.name_en || row.name_ar);
    if (!name) {
      missingNames.push({ id: row.id, documentId: row.document_id });
      continue;
    }

    const key = [
      parentByGallery.get(String(row.id)) || 'root',
      editionByGallery.get(String(row.id)) || 'no-edition',
      normalizeName(name),
    ].join(':');
    const existing = byScope.get(key);
    if (existing) {
      duplicates.push({
        label: 'Gallery',
        names: [existing.name, name],
        documentIds: [existing.row.document_id, row.document_id],
      });
    } else {
      byScope.set(key, { row, name });
    }
  }

  return { missingNames, duplicates };
}

async function tableRows(knex, table) {
  if (!(await knex.schema.hasTable(table))) return [];
  return knex(table).select();
}

module.exports = {
  auditAuthorityRows,
  auditGalleryRows,
  auditWorkRows,
  cleanName,
  logicalRows,
  normalizeName,

  async up(knex) {
    const hasAgentIdentifier = await knex.schema.hasColumn(
      'agents',
      'external_identifier',
    );
    const authorities = [
      {
        table: 'agents',
        label: 'Agent',
        nameColumns: ['name_en', 'name_ar'],
        ...(hasAgentIdentifier ? { identifierColumn: 'external_identifier' } : {}),
      },
      {
        table: 'institutions',
        label: 'Institution',
        nameColumns: ['name_en', 'name_ar'],
      },
      {
        table: 'materials',
        label: 'Material',
        nameColumns: ['name_en', 'name_ar'],
      },
      {
        table: 'agent_roles',
        label: 'Agent Role',
        nameColumns: ['label_en', 'label_ar'],
      },
    ];
    const report = {
      invalidWorkDateRanges: auditWorkRows(await tableRows(knex, 'works')),
      missingPreferredNames: [],
      duplicateAuthorityCandidates: [],
    };

    for (const authority of authorities) {
      const audit = auditAuthorityRows(
        await tableRows(knex, authority.table),
        authority,
      );
      report.missingPreferredNames.push(
        ...audit.missingNames.map((record) => ({
          authority: authority.label,
          ...record,
        })),
      );
      report.duplicateAuthorityCandidates.push(...audit.duplicates);
    }

    const galleryAudit = auditGalleryRows(
      await tableRows(knex, 'galleries'),
      await tableRows(knex, 'galleries_parent_lnk'),
      await tableRows(knex, 'galleries_biennale_edition_lnk'),
    );
    report.missingPreferredNames.push(
      ...galleryAudit.missingNames.map((record) => ({
        authority: 'Gallery',
        ...record,
      })),
    );
    report.duplicateAuthorityCandidates.push(...galleryAudit.duplicates);

    if (
      report.invalidWorkDateRanges.length > 0 ||
      report.missingPreferredNames.length > 0 ||
      report.duplicateAuthorityCandidates.length > 0
    ) {
      console.warn(
        `Domain validation migration review: ${JSON.stringify(report)}`,
      );
    }

    return report;
  },
};
