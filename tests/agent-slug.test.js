'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  generateAgentSlug,
  registerAgentSlug,
} = require('../src/api/agent/content-types/agent/slug');

function agentStrapi(records = []) {
  return {
    documents: Object.assign(
      () => ({
        async findMany() {
          return records;
        },
      }),
      {
        use() {},
      },
    ),
  };
}

test('Agent creation generates a slug from the English name', async () => {
  const context = {
    uid: 'api::agent.agent',
    action: 'create',
    params: {
      data: {
        nameEn: 'École Museum',
      },
    },
  };

  await generateAgentSlug(agentStrapi(), context);

  assert.equal(context.params.data.slug, 'ecole-museum');
});

test('Agent creation generates the next available slug for duplicate names', async () => {
  const context = {
    uid: 'api::agent.agent',
    action: 'create',
    params: {
      data: {
        nameEn: 'Jane Doe',
      },
    },
  };

  await generateAgentSlug(
    agentStrapi([
      { slug: 'jane-doe' },
      { slug: 'jane-doe-1' },
      { slug: 'jane-doe-3' },
    ]),
    context,
  );

  assert.equal(context.params.data.slug, 'jane-doe-2');
});

test('Agent creation preserves a supplied slug', async () => {
  const context = {
    uid: 'api::agent.agent',
    action: 'create',
    params: {
      data: {
        nameEn: 'Jane Doe',
        slug: 'jane-doe-curator',
      },
    },
  };

  await generateAgentSlug(agentStrapi(), context);

  assert.equal(context.params.data.slug, 'jane-doe-curator');
});

test('register installs Agent slug middleware', () => {
  let middleware;
  const strapi = {
    documents: {
      use(candidate) {
        middleware = candidate;
      },
    },
  };

  registerAgentSlug(strapi);

  assert.equal(typeof middleware, 'function');
});
