'use strict';

const COMPONENT_TABLE = 'components_shared_inscriptions';

module.exports = {
  async up(knex) {
    if (await knex.schema.hasTable(COMPONENT_TABLE)) return;

    await knex.schema.createTable(COMPONENT_TABLE, (table) => {
      table.increments('id');
      table.text('text').notNullable();
      table.text('translation');
      table.string('language');
      table.string('type').defaultTo('text');
      table.string('position');
      table.integer('sort_order');
    });
  },
};
