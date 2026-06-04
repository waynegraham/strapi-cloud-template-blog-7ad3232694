'use strict';

/**
 * iiif-image service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::iiif-image.iiif-image');
