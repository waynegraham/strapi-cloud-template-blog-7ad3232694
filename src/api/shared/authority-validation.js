'use strict';

const { errors } = require('@strapi/utils');

const WRITE_ACTIONS = new Set(['create', 'update']);
const AUTHORITY_CONFIG = {
  'api::agent.agent': {
    label: 'Agent',
    nameFields: ['nameEn', 'nameAr'],
    identifierField: 'externalIdentifier',
  },
  'api::institution.institution': {
    label: 'Institution',
    nameFields: ['nameEn', 'nameAr'],
  },
  'api::material.material': {
    label: 'Material',
    nameFields: ['nameEn', 'nameAr'],
  },
  'api::agent-role.agent-role': {
    label: 'Agent Role',
    nameFields: ['labelEn', 'labelAr'],
  },
};

function cleanName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizeName(value) {
  return cleanName(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function preferredName(record, fields) {
  for (const field of fields) {
    const value = cleanName(record && record[field]);
    if (value) return value;
  }
  return '';
}

function mergeWriteData(current, data, fields) {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      Object.prototype.hasOwnProperty.call(data, field)
        ? data[field]
        : current && current[field],
    ]),
  );
}

function agentsAreDisambiguated(candidate, duplicate, identifierField) {
  if (!identifierField) return false;

  const candidateIdentifier = cleanName(candidate[identifierField]);
  const duplicateIdentifier = cleanName(duplicate[identifierField]);

  return (
    candidateIdentifier &&
    duplicateIdentifier &&
    candidateIdentifier.toLocaleLowerCase() !== duplicateIdentifier.toLocaleLowerCase()
  );
}

async function validateAuthorityWrite(strapi, context) {
  const config = AUTHORITY_CONFIG[context.uid];
  if (!config || !WRITE_ACTIONS.has(context.action)) return;

  const data = context.params.data || {};
  const fields = [
    ...config.nameFields,
    ...(config.identifierField ? [config.identifierField] : []),
  ];
  const current =
    context.action === 'update'
      ? await strapi.documents(context.uid).findOne({
          documentId: context.params.documentId,
          status: 'draft',
          fields,
        })
      : undefined;
  const candidate = mergeWriteData(current, data, fields);
  const name = preferredName(candidate, config.nameFields);

  if (!name) {
    throw new errors.ValidationError(
      `${config.label} requires a preferred English or Arabic name.`,
    );
  }

  const records = await strapi.documents(context.uid).findMany({
    status: 'draft',
    fields,
    limit: 10000,
  });
  const candidateExact = cleanName(name).toLocaleLowerCase();
  const candidateNormalized = normalizeName(name);
  const candidateIdentifier = config.identifierField
    ? cleanName(candidate[config.identifierField])
    : '';

  for (const record of records) {
    if (record.documentId === context.params.documentId) continue;

    const recordName = preferredName(record, config.nameFields);
    const recordIdentifier = config.identifierField
      ? cleanName(record[config.identifierField])
      : '';
    if (
      candidateIdentifier &&
      recordIdentifier &&
      candidateIdentifier.toLocaleLowerCase() ===
        recordIdentifier.toLocaleLowerCase()
    ) {
      throw new errors.ValidationError(
        `${config.label} external identifier "${candidateIdentifier}" is already used by "${recordName}" (${record.documentId}).`,
      );
    }

    if (!recordName || normalizeName(recordName) !== candidateNormalized) continue;
    if (agentsAreDisambiguated(candidate, record, config.identifierField)) continue;

    const matchType =
      cleanName(recordName).toLocaleLowerCase() === candidateExact
        ? 'Exact'
        : 'Normalized';
    const identifier = record.documentId ? ` (${record.documentId})` : '';
    const resolution = config.identifierField
      ? 'Reuse the existing record, or give both people distinct external identifiers.'
      : 'Reuse the existing record instead of creating another authority entry.';
    throw new errors.ValidationError(
      `${matchType} duplicate ${config.label} candidate: "${recordName}"${identifier}. ${resolution}`,
    );
  }
}

function registerAuthorityValidation(strapi) {
  strapi.documents.use(async (context, next) => {
    await validateAuthorityWrite(strapi, context);
    return next();
  });
}

module.exports = {
  cleanName,
  normalizeName,
  preferredName,
  registerAuthorityValidation,
  validateAuthorityWrite,
};
