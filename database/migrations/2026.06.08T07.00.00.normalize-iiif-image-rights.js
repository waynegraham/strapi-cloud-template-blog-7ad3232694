'use strict';

const RELATION_TABLE = 'iiif_images_rights_statement_lnk';
const RIGHTS_LAYOUT_KEY =
  'plugin_content_manager_configuration_content_types::api::rights-statement.rights-statement';

function normalizeRightsValue(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();

  if (!normalized) return '';

  try {
    const url = new URL(normalized);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return normalized;
  }
}

function rightsDocumentId(row) {
  return String(row.document_id || `physical:${row.id}`);
}

function matchingRightsRows(value, statements) {
  const normalized = normalizeRightsValue(value);
  if (!normalized) return [];

  return statements.filter((statement) =>
    [
      statement.uri,
      statement.label_en,
      statement.label_ar,
      statement.laben_ar,
    ].some((candidate) => normalizeRightsValue(candidate) === normalized),
  );
}

function selectPhysicalStatement(image, candidates) {
  const imageIsPublished = Boolean(image.published_at);
  const sameLocale = candidates.filter(
    (candidate) => (candidate.locale || null) === (image.locale || null),
  );
  const localeCandidates = sameLocale.length > 0 ? sameLocale : candidates;
  const sameStatus = localeCandidates.filter(
    (candidate) => Boolean(candidate.published_at) === imageIsPublished,
  );

  return (sameStatus.length > 0 ? sameStatus : localeCandidates)
    .slice()
    .sort((left, right) => left.id - right.id)[0];
}

function matchRightsValue(image, statements) {
  const matches = matchingRightsRows(image.rights, statements);
  const documentIds = Array.from(new Set(matches.map(rightsDocumentId)));

  if (documentIds.length === 0) {
    return { status: 'unmatched' };
  }

  if (documentIds.length > 1) {
    return {
      status: 'ambiguous',
      candidate_document_ids: documentIds,
    };
  }

  return {
    status: 'matched',
    statement: selectPhysicalStatement(image, matches),
  };
}

async function preserveArabicLabels(knex) {
  if (!(await knex.schema.hasTable('rights_statements'))) return;

  const hasLegacy = await knex.schema.hasColumn('rights_statements', 'laben_ar');
  if (!hasLegacy) return;

  const hasCorrected = await knex.schema.hasColumn('rights_statements', 'label_ar');
  if (!hasCorrected) {
    await knex.schema.alterTable('rights_statements', (table) => {
      table.renameColumn('laben_ar', 'label_ar');
    });
    return;
  }

  const rows = await knex('rights_statements')
    .whereNotNull('laben_ar')
    .select('id', 'label_ar', 'laben_ar');

  for (const row of rows) {
    if (String(row.label_ar || '').trim()) continue;
    await knex('rights_statements')
      .where({ id: row.id })
      .update({ label_ar: row.laben_ar });
  }
}

async function ensureRightsNoteColumn(knex) {
  if (
    !(await knex.schema.hasTable('iiif_images')) ||
    (await knex.schema.hasColumn('iiif_images', 'rights_note'))
  ) {
    return;
  }

  await knex.schema.alterTable('iiif_images', (table) => {
    table.text('rights_note');
  });
}

async function ensureRelationTable(knex) {
  if (await knex.schema.hasTable(RELATION_TABLE)) return;

  await knex.schema.createTable(RELATION_TABLE, (table) => {
    table.increments('id');
    table.integer('iiif_image_id').references('id').inTable('iiif_images').onDelete('CASCADE');
    table.integer('rights_statement_id').references('id').inTable('rights_statements').onDelete('CASCADE');
    table.float('iiif_image_ord');
    table.unique(['iiif_image_id']);
  });
}

async function configureRightsStatementList(knex) {
  if (!(await knex.schema.hasTable('strapi_core_store_settings'))) return;

  const row = await knex('strapi_core_store_settings')
    .where({ key: RIGHTS_LAYOUT_KEY })
    .first('id', 'value');
  if (!row || !row.value) return;

  const configuration =
    typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  configuration.settings = {
    ...(configuration.settings || {}),
    mainField: 'labelEn',
    defaultSortBy: 'labelEn',
    defaultSortOrder: 'ASC',
  };
  configuration.layouts = {
    ...(configuration.layouts || {}),
    list: ['labelEn', 'labelAr', 'uri'],
  };

  await knex('strapi_core_store_settings')
    .where({ id: row.id })
    .update({ value: JSON.stringify(configuration) });
}

async function migrateImageRights(knex) {
  const report = {
    matched: [],
    unmatched: [],
    ambiguous: [],
  };

  if (
    !(await knex.schema.hasTable('iiif_images')) ||
    !(await knex.schema.hasTable('rights_statements')) ||
    !(await knex.schema.hasColumn('iiif_images', 'rights'))
  ) {
    return report;
  }

  const images = await knex('iiif_images')
    .whereNotNull('rights')
    .whereRaw("TRIM(rights) <> ''")
    .select('id', 'document_id', 'rights', 'rights_note', 'published_at', 'locale');
  if (images.length === 0) return report;

  const statements = await knex('rights_statements').select();
  await ensureRelationTable(knex);
  const existingLinks = await knex(RELATION_TABLE).select('iiif_image_id');
  const linkedImageIds = new Set(
    existingLinks.map((link) => String(link.iiif_image_id)),
  );

  for (const image of images) {
    if (linkedImageIds.has(String(image.id))) continue;

    const result = matchRightsValue(image, statements);
    if (result.status === 'matched') {
      await knex(RELATION_TABLE).insert({
        iiif_image_id: image.id,
        rights_statement_id: result.statement.id,
      });
      report.matched.push({
        image_id: image.id,
        image_document_id: image.document_id,
        rights: image.rights,
        rights_statement_id: result.statement.id,
        rights_statement_document_id: result.statement.document_id,
      });
      continue;
    }

    if (!String(image.rights_note || '').trim()) {
      await knex('iiif_images')
        .where({ id: image.id })
        .update({ rights_note: image.rights });
    }

    report[result.status].push({
      image_id: image.id,
      image_document_id: image.document_id,
      rights: image.rights,
      ...(result.candidate_document_ids
        ? { candidate_document_ids: result.candidate_document_ids }
        : {}),
    });
  }

  return report;
}

module.exports = {
  matchRightsValue,
  normalizeRightsValue,

  async up(knex) {
    await preserveArabicLabels(knex);
    await ensureRightsNoteColumn(knex);
    const report = await migrateImageRights(knex);
    await configureRightsStatementList(knex);

    if (report.unmatched.length > 0 || report.ambiguous.length > 0) {
      console.warn(
        `IIIF Image rights migration review: ${JSON.stringify({
          unmatched: report.unmatched,
          ambiguous: report.ambiguous,
        })}`,
      );
    }

    return report;
  },
};
