'use strict';

const {
  upsertConfiguration,
} = require('./2026.06.08T08.00.00.configure-staff-content-manager-layouts');
const {
  contentManagerLayouts,
} = require('../../config/content-manager-layouts');

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable('strapi_core_store_settings'))) {
      return { layout: { skipped: true } };
    }

    const modelKey = 'components::shared.agent-credit';
    return {
      layout: {
        modelKey,
        status: await upsertConfiguration(
          knex,
          modelKey,
          contentManagerLayouts[modelKey],
        ),
        skipped: false,
      },
    };
  },
};
