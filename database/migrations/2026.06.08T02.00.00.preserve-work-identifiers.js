'use strict';

const COMPONENT_TABLE = 'components_shared_work_identifiers';
const COMPONENT_UID = 'shared.work-identifier';
const COMPONENT_FIELD = 'identifiers';

module.exports = {
  async up(knex) {
    const hasWorks = await knex.schema.hasTable('works');
    if (!hasWorks) return;

    const worksWithoutCodes = await knex('works')
      .whereNull('iab_code')
      .orWhere('iab_code', '')
      .select('id');

    if (worksWithoutCodes.length > 0) {
      throw new Error(
        `Cannot migrate Work identifiers safely: found ${worksWithoutCodes.length} Work row(s) without iab_code.`,
      );
    }

    if (!(await knex.schema.hasTable(COMPONENT_TABLE))) {
      await knex.schema.createTable(COMPONENT_TABLE, (table) => {
        table.increments('id');
        table.string('value').notNullable();
        table.string('type').notNullable().defaultTo('IAB');
        table.boolean('preferred').notNullable().defaultTo(false);
        table.string('source');
      });
    }

    const hasComponentLinks = await knex.schema.hasTable('works_cmps');
    if (!hasComponentLinks) {
      throw new Error(
        'Cannot migrate Work identifiers safely: works_cmps does not exist.',
      );
    }

    const existingLinks = await knex('works_cmps')
      .where({
        component_type: COMPONENT_UID,
        field: COMPONENT_FIELD,
      })
      .select('entity_id');
    const linkedWorkIds = new Set(existingLinks.map((link) => String(link.entity_id)));
    const works = await knex('works').select('id', 'iab_code');

    for (const work of works) {
      if (linkedWorkIds.has(String(work.id))) continue;

      const [insertedComponent] = await knex(COMPONENT_TABLE)
        .insert({
          value: String(work.iab_code).trim(),
          type: 'IAB',
          preferred: true,
          source: 'Existing Work.iabCode',
        })
        .returning('id');
      const componentId =
        typeof insertedComponent === 'object'
          ? insertedComponent.id
          : insertedComponent;

      await knex('works_cmps').insert({
        entity_id: work.id,
        cmp_id: componentId,
        component_type: COMPONENT_UID,
        field: COMPONENT_FIELD,
        order: 1,
      });
    }
  },
};
