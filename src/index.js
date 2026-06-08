'use strict';

const {
  registerGalleryValidation,
} = require('./api/gallery/content-types/gallery/validation');
const {
  registerWorkValidation,
} = require('./api/work/content-types/work/validation');
const {
  registerIiifImageValidation,
} = require('./api/iiif-image/content-types/iiif-image/validation');
const {
  registerAuthorityValidation,
} = require('./api/shared/authority-validation');
const {
  contentManagerLayouts,
  mergeConfiguration,
} = require('../config/content-manager-layouts');

async function applyStaffContentManagerLayouts(strapi) {
  const store = strapi.store({
    type: 'plugin',
    name: 'content_manager',
  });

  for (const [modelKey, desired] of Object.entries(contentManagerLayouts)) {
    const key = `configuration_${modelKey}`;
    const existing = (await store.get({ key })) || {};
    const configuration = mergeConfiguration(existing, desired);

    if (JSON.stringify(existing) !== JSON.stringify(configuration)) {
      await store.set({ key, value: configuration });
    }
  }
}

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }) {
    registerGalleryValidation(strapi);
    registerWorkValidation(strapi);
    registerIiifImageValidation(strapi);
    registerAuthorityValidation(strapi);
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    await applyStaffContentManagerLayouts(strapi);
  },
};
