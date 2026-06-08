'use strict';

const { errors } = require('@strapi/utils');

const WORK_UID = 'api::work.work';

function workDisplayTitle({ iabCode, titleEn } = {}) {
  return [iabCode, titleEn]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' - ');
}

function cleanIdentifier(identifier) {
  return {
    ...(identifier.id === undefined ? {} : { id: identifier.id }),
    value: String(identifier.value || '').trim(),
    type: String(identifier.type || 'IAB').trim() || 'IAB',
    preferred: identifier.preferred === true,
    ...(String(identifier.source || '').trim()
      ? { source: String(identifier.source).trim() }
      : {}),
  };
}

function validateIdentifiers(identifiers) {
  if (!Array.isArray(identifiers) || identifiers.length === 0) {
    throw new errors.ValidationError(
      'Work identifiers must contain at least one identifier.',
    );
  }

  const cleaned = identifiers.map(cleanIdentifier);
  const emptyIdentifier = cleaned.find((identifier) => !identifier.value);
  if (emptyIdentifier) {
    throw new errors.ValidationError('Every Work identifier requires a value.');
  }

  const seen = new Set();
  for (const identifier of cleaned) {
    const key = `${identifier.type}:${identifier.value}`.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new errors.ValidationError(
        `Work identifier "${identifier.value}" is duplicated within this Work.`,
      );
    }
    seen.add(key);
  }

  const preferred = cleaned.filter((identifier) => identifier.preferred);
  if (preferred.length !== 1 || preferred[0].type.toLocaleUpperCase() !== 'IAB') {
    throw new errors.ValidationError(
      'A Work must have exactly one preferred IAB identifier.',
    );
  }

  return {
    identifiers: cleaned,
    iabCode: preferred[0].value,
  };
}

function cleanInscription(inscription) {
  return {
    ...(inscription.id === undefined ? {} : { id: inscription.id }),
    text: String(inscription.text || ''),
    ...(String(inscription.translation || '').trim()
      ? { translation: String(inscription.translation) }
      : {}),
    ...(String(inscription.language || '').trim()
      ? { language: String(inscription.language).trim() }
      : {}),
    ...(String(inscription.type || '').trim()
      ? { type: String(inscription.type).trim() }
      : {}),
    ...(String(inscription.position || '').trim()
      ? { position: String(inscription.position).trim() }
      : {}),
    ...(inscription.author === undefined || inscription.author === null
      ? {}
      : { author: inscription.author }),
    ...(inscription.sortOrder === undefined || inscription.sortOrder === null
      ? {}
      : { sortOrder: inscription.sortOrder }),
  };
}

function validateInscriptions(inscriptions) {
  if (inscriptions === undefined) return undefined;
  if (inscriptions === null) return inscriptions;
  if (!Array.isArray(inscriptions)) {
    throw new errors.ValidationError('Work inscriptions must be a repeatable list.');
  }

  return inscriptions.map((inscription) => {
    const cleaned = cleanInscription(inscription || {});
    if (!cleaned.text.trim()) {
      throw new errors.ValidationError(
        'Every Work inscription requires source text.',
      );
    }

    return cleaned;
  });
}

function relationIsPresent(value) {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'string' || typeof value === 'number') return true;
  if (Array.isArray(value)) return value.some(relationIsPresent);
  if (value.documentId || value.id) return true;
  if (value.disconnect && !value.connect && !value.set) return false;
  return ['connect', 'set'].some(
    (operation) => value[operation] && relationIsPresent(value[operation]),
  );
}

function validateAgentCredits(agentCredits) {
  if (agentCredits === undefined) return undefined;
  if (agentCredits === null) return agentCredits;
  if (!Array.isArray(agentCredits)) {
    throw new errors.ValidationError(
      'Work Agent Credits must be a repeatable list.',
    );
  }

  for (const [index, credit] of agentCredits.entries()) {
    if (!relationIsPresent(credit && credit.agent)) {
      throw new errors.ValidationError(
        `Agent Credit ${index + 1} requires an Agent.`,
      );
    }
    if (!relationIsPresent(credit && credit.agent_role)) {
      throw new errors.ValidationError(
        `Agent Credit ${index + 1} requires an Agent Role.`,
      );
    }
  }

  return agentCredits;
}

function validateDateRange(earliestDate, latestDate) {
  if (
    earliestDate !== undefined &&
    earliestDate !== null &&
    latestDate !== undefined &&
    latestDate !== null &&
    earliestDate > latestDate
  ) {
    throw new errors.ValidationError(
      'Work earliest year cannot be later than its latest year.',
    );
  }
}

async function workForWrite(strapi, context) {
  if (context.action === 'create') return undefined;

  return strapi.documents(WORK_UID).findOne({
    documentId: context.params.documentId,
    fields: ['titleEn', 'iabCode', 'earliestDate', 'latestDate'],
    populate: {
      identifiers: true,
      agentCredits: {
        populate: {
          agent: true,
          agent_role: true,
        },
      },
    },
  });
}

function identifiersForWrite(context, existing) {
  const { action, params } = context;
  const data = params.data || {};

  if (Object.prototype.hasOwnProperty.call(data, 'identifiers')) {
    return data.identifiers;
  }

  if (action === 'create') return undefined;

  if (existing && Array.isArray(existing.identifiers) && existing.identifiers.length > 0) {
    return existing.identifiers;
  }

  return existing && existing.iabCode
    ? [
        {
          value: existing.iabCode,
          type: 'IAB',
          preferred: true,
          source: 'Work.iabCode migration fallback',
        },
      ]
    : undefined;
}

async function validateWorkWrite(strapi, context) {
  if (context.uid !== WORK_UID) return;
  if (!['create', 'update'].includes(context.action)) return;

  const existing = await workForWrite(strapi, context);
  const normalized = validateIdentifiers(
    identifiersForWrite(context, existing),
  );
  const data = context.params.data || {};
  const titleEn =
    data.titleEn === undefined ? existing && existing.titleEn : data.titleEn;
  const earliestDate =
    data.earliestDate === undefined
      ? existing && existing.earliestDate
      : data.earliestDate;
  const latestDate =
    data.latestDate === undefined ? existing && existing.latestDate : data.latestDate;

  validateDateRange(earliestDate, latestDate);

  context.params.data = {
    ...data,
    identifiers: normalized.identifiers,
    iabCode: normalized.iabCode,
    displayTitle: workDisplayTitle({
      iabCode: normalized.iabCode,
      titleEn,
    }),
  };

  if (Object.prototype.hasOwnProperty.call(data, 'agentCredits')) {
    context.params.data.agentCredits = validateAgentCredits(data.agentCredits);
  }

  if (Object.prototype.hasOwnProperty.call(context.params.data, 'inscriptions')) {
    context.params.data.inscriptions = validateInscriptions(
      context.params.data.inscriptions,
    );
  }
}

function registerWorkValidation(strapi) {
  strapi.documents.use(async (context, next) => {
    await validateWorkWrite(strapi, context);
    return next();
  });
}

module.exports = {
  registerWorkValidation,
  relationIsPresent,
  validateAgentCredits,
  validateDateRange,
  workDisplayTitle,
  validateInscriptions,
  validateIdentifiers,
  validateWorkWrite,
};
