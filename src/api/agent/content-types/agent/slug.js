'use strict';

const slugify = require('@sindresorhus/slugify');

const AGENT_UID = 'api::agent.agent';

async function uniqueAgentSlug(strapi, value) {
  const matches = await strapi.documents(AGENT_UID).findMany({
    status: 'draft',
    filters: {
      slug: {
        $startsWith: value,
      },
    },
    fields: ['slug'],
    limit: 10000,
  });
  const existing = new Set(matches.map((agent) => agent.slug).filter(Boolean));

  if (!existing.has(value)) return value;

  let suffix = 1;
  while (existing.has(`${value}-${suffix}`)) suffix += 1;
  return `${value}-${suffix}`;
}

async function generateAgentSlug(strapi, context) {
  if (context.uid !== AGENT_UID || context.action !== 'create') return;

  const data = context.params.data || {};
  if (String(data.slug || '').trim()) return;

  const baseSlug = slugify(String(data.nameEn || '').trim());
  if (!baseSlug) return;

  context.params.data = {
    ...data,
    slug: await uniqueAgentSlug(strapi, baseSlug),
  };
}

function registerAgentSlug(strapi) {
  strapi.documents.use(async (context, next) => {
    await generateAgentSlug(strapi, context);
    return next();
  });
}

module.exports = {
  generateAgentSlug,
  registerAgentSlug,
  uniqueAgentSlug,
};
