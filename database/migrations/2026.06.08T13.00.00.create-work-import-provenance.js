'use strict';

const COMPONENT_TABLE = 'components_shared_import_provenances';
const COMPONENT_UID = 'shared.import-provenance';
const COMPONENT_FIELD = 'importProvenance';

async function createComponentTable(knex) {
  if (await knex.schema.hasTable(COMPONENT_TABLE)) return false;

  await knex.schema.createTable(COMPONENT_TABLE, (table) => {
    table.increments('id');
    table.string('source_system').notNullable();
    table.string('source_record_id').notNullable();
    table.string('import_batch_id').notNullable();
    table.datetime('last_imported_at').notNullable();
    table.string('source_checksum', 64).notNullable();
    table.string('reconciliation_status').defaultTo('not-required');
  });
  return true;
}

async function auditExistingWorks(knex) {
  if (
    !(await knex.schema.hasTable('works')) ||
    !(await knex.schema.hasTable('works_cmps'))
  ) {
    return { total: 0, withProvenance: 0, unresolved: [] };
  }

  const works = await knex('works').select('id', 'document_id', 'iab_code');
  const linkedIds = new Set(
    (
      await knex('works_cmps')
        .where({
          component_type: COMPONENT_UID,
          field: COMPONENT_FIELD,
        })
        .pluck('entity_id')
    ).map(Number),
  );

  return {
    total: works.length,
    withProvenance: works.filter((work) => linkedIds.has(Number(work.id))).length,
    unresolved: works
      .filter((work) => !linkedIds.has(Number(work.id)))
      .map((work) => ({
        id: work.id,
        documentId: work.document_id,
        iabCode: work.iab_code,
        reason: 'No trustworthy Airtable record ID is stored on this existing Work.',
      })),
  };
}

module.exports = {
  auditExistingWorks,
  createComponentTable,

  async up(knex) {
    return {
      componentTableCreated: await createComponentTable(knex),
      existingWorks: await auditExistingWorks(knex),
    };
  },
};
