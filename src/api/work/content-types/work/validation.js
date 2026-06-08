'use strict';

const { errors } = require('@strapi/utils');

const WORK_UID = 'api::work.work';

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

async function identifiersForWrite(strapi, context) {
  const { action, params } = context;
  const data = params.data || {};

  if (Object.prototype.hasOwnProperty.call(data, 'identifiers')) {
    return data.identifiers;
  }

  if (action === 'create') return undefined;

  const existing = await strapi.documents(WORK_UID).findOne({
    documentId: params.documentId,
    populate: {
      identifiers: true,
    },
  });

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

  const normalized = validateIdentifiers(
    await identifiersForWrite(strapi, context),
  );

  context.params.data = {
    ...(context.params.data || {}),
    identifiers: normalized.identifiers,
    iabCode: normalized.iabCode,
  };

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
  validateInscriptions,
  validateIdentifiers,
  validateWorkWrite,
};
