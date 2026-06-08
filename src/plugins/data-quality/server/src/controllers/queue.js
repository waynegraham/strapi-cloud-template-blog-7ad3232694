'use strict';

module.exports = ({ strapi }) => ({
  async index(ctx) {
    ctx.body = await strapi.plugin('data-quality').service('queue').getQueues();
  },
});
