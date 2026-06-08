'use strict';

async function addColumn(knex, tableName, columnName, define) {
  if (await knex.schema.hasColumn(tableName, columnName)) return false;

  await knex.schema.alterTable(tableName, (table) => define(table));
  return true;
}

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable('works'))) {
      return { skipped: true, added: [] };
    }

    const added = [];
    if (
      await addColumn(knex, 'works', 'review_status', (table) => {
        table.string('review_status').notNullable().defaultTo('not-reviewed');
      })
    ) {
      added.push('review_status');
    }
    if (
      await addColumn(knex, 'works', 'review_notes', (table) => {
        table.text('review_notes');
      })
    ) {
      added.push('review_notes');
    }
    if (
      await addColumn(knex, 'works', 'reviewed_at', (table) => {
        table.datetime('reviewed_at');
      })
    ) {
      added.push('reviewed_at');
    }

    return { skipped: false, added };
  },
};
