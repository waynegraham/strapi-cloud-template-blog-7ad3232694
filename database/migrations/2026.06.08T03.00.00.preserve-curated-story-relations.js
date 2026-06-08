'use strict';

async function validateRelationTable(knex, tableName, ownerColumn, targetColumn) {
  if (!(await knex.schema.hasTable(tableName))) return;

  const duplicateLinks = await knex(tableName)
    .select(ownerColumn, targetColumn)
    .count({ count: '*' })
    .groupBy(ownerColumn, targetColumn)
    .havingRaw('COUNT(*) > 1');

  if (duplicateLinks.length > 0) {
    throw new Error(
      `Cannot migrate Curated Story relations safely: found ${duplicateLinks.length} duplicate relation pair(s) in ${tableName}.`,
    );
  }
}

module.exports = {
  async up(knex) {
    await validateRelationTable(
      knex,
      'curated_stories_works_lnk',
      'curated_story_id',
      'work_id',
    );
    await validateRelationTable(
      knex,
      'curated_stories_galleries_lnk',
      'curated_story_id',
      'gallery_id',
    );
  },
};
