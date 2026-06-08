'use strict';

const {
  contentManagerLayouts,
  mergeConfiguration,
  workDisplayTitle,
} = require('../../config/content-manager-layouts');

const STORE_PREFIX = 'plugin_content_manager_configuration_';

function parseConfiguration(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function upsertConfiguration(knex, modelKey, desired) {
  const key = `${STORE_PREFIX}${modelKey}`;
  const row = await knex('strapi_core_store_settings')
    .where({ key })
    .first('id', 'value');
  const value = JSON.stringify(
    mergeConfiguration(parseConfiguration(row && row.value), desired),
  );

  if (row) {
    await knex('strapi_core_store_settings').where({ id: row.id }).update({ value });
    return 'updated';
  }

  const columns = await knex('strapi_core_store_settings').columnInfo();
  await knex('strapi_core_store_settings').insert({
    key,
    value,
    ...(columns.type ? { type: 'object' } : {}),
  });
  return 'inserted';
}

async function configureLayouts(knex) {
  if (!(await knex.schema.hasTable('strapi_core_store_settings'))) {
    return { inserted: 0, updated: 0, skipped: true };
  }

  const report = { inserted: 0, updated: 0, skipped: false };
  for (const [modelKey, configuration] of Object.entries(contentManagerLayouts)) {
    const result = await upsertConfiguration(knex, modelKey, configuration);
    report[result] += 1;
  }
  return report;
}

async function backfillWorkDisplayTitles(knex) {
  if (!(await knex.schema.hasTable('works'))) {
    return { updated: 0, skipped: true };
  }

  if (!(await knex.schema.hasColumn('works', 'display_title'))) {
    await knex.schema.alterTable('works', (table) => {
      table.string('display_title');
    });
  }

  const rows = await knex('works').select('id', 'iab_code', 'title_en', 'display_title');
  let updated = 0;

  for (const row of rows) {
    const displayTitle = workDisplayTitle({
      iabCode: row.iab_code,
      titleEn: row.title_en,
    });
    if (row.display_title === displayTitle) continue;

    await knex('works').where({ id: row.id }).update({ display_title: displayTitle });
    updated += 1;
  }

  return { updated, skipped: false };
}

module.exports = {
  configureLayouts,
  mergeConfiguration,
  upsertConfiguration,

  async up(knex) {
    return {
      layouts: await configureLayouts(knex),
      workDisplayTitles: await backfillWorkDisplayTitles(knex),
    };
  },
};
