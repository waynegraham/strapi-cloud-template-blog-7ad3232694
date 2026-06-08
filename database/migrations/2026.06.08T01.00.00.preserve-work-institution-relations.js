'use strict';

module.exports = {
  async up(knex) {
    const hasRelationTable = await knex.schema.hasTable('works_institution_lnk');
    if (!hasRelationTable) return;

    const duplicateLinks = await knex('works_institution_lnk')
      .select('work_id', 'institution_id')
      .count({ count: '*' })
      .groupBy('work_id', 'institution_id')
      .havingRaw('COUNT(*) > 1');

    if (duplicateLinks.length > 0) {
      throw new Error(
        `Cannot migrate Work.institution safely: found ${duplicateLinks.length} duplicate relation pair(s).`,
      );
    }

    const worksWithMultipleInstitutions = await knex('works_institution_lnk')
      .select('work_id')
      .countDistinct({ institution_count: 'institution_id' })
      .groupBy('work_id')
      .havingRaw('COUNT(DISTINCT institution_id) > 1');

    if (worksWithMultipleInstitutions.length > 0) {
      throw new Error(
        `Cannot migrate Work.institution safely: found ${worksWithMultipleInstitutions.length} Work record(s) linked to multiple Institutions.`,
      );
    }
  },
};
