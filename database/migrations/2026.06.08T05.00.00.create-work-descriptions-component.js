'use strict';

const COMPONENT_TABLE = 'components_shared_work_descriptions';

module.exports = {
  async up(knex) {
    if (await knex.schema.hasTable(COMPONENT_TABLE)) return;

    await knex.schema.createTable(COMPONENT_TABLE, (table) => {
      table.increments('id');
      table.string('type').notNullable().defaultTo('general');
      table.string('label_en');
      table.string('label_ar');
      table.text('body_en');
      table.text('body_ar');
      table.integer('sort_order');
    });
  },
};
