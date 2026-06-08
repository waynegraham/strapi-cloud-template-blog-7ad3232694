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
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap() {},
};
