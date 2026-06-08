'use strict';

/**
 * curated-story service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::curated-story.curated-story');
