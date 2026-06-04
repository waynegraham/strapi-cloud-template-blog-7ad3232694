'use strict';

/**
 * iiif-asset service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::iiif-asset.iiif-asset');
