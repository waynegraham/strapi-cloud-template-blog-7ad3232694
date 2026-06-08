'use strict';

const { errors } = require('@strapi/utils');

const IIIF_IMAGE_UID = 'api::iiif-image.iiif-image';
const WRITE_ACTIONS = new Set(['create', 'update']);

function relationDocumentId(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value.documentId) return value.documentId;
  if (Array.isArray(value)) return relationDocumentId(value[value.length - 1]);

  for (const operation of ['set', 'connect']) {
    if (value[operation]) return relationDocumentId(value[operation]);
  }

  return undefined;
}

async function findImage(strapi, documentId) {
  if (!documentId) return undefined;

  return strapi.documents(IIIF_IMAGE_UID).findOne({
    documentId,
    status: 'draft',
    populate: {
      iiifAsset: true,
    },
  });
}

async function validateIiifImageWrite(strapi, context) {
  if (context.uid !== IIIF_IMAGE_UID || !WRITE_ACTIONS.has(context.action)) return;

  const data = context.params.data || {};
  const current = await findImage(strapi, context.params.documentId);
  const imageDocumentId = context.params.documentId || (current && current.documentId);
  const assetDocumentId = Object.prototype.hasOwnProperty.call(data, 'iiifAsset')
    ? relationDocumentId(data.iiifAsset)
    : relationDocumentId(current && current.iiifAsset);
  const sequence = Object.prototype.hasOwnProperty.call(data, 'sequence')
    ? data.sequence
    : current && current.sequence;

  if (!assetDocumentId) {
    throw new errors.ValidationError('Every IIIF Image requires one IIIF Asset.');
  }

  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new errors.ValidationError(
      'IIIF Image sequence must be a positive integer.',
    );
  }

  const duplicates = await strapi.documents(IIIF_IMAGE_UID).findMany({
    status: 'draft',
    filters: {
      sequence: { $eq: sequence },
      iiifAsset: { documentId: { $eq: assetDocumentId } },
    },
    limit: 2,
  });
  const duplicate = duplicates.find(
    (image) => image.documentId !== imageDocumentId,
  );

  if (duplicate) {
    throw new errors.ValidationError(
      `IIIF Image sequence ${sequence} is already used within this IIIF Asset.`,
    );
  }
}

function registerIiifImageValidation(strapi) {
  strapi.documents.use(async (context, next) => {
    await validateIiifImageWrite(strapi, context);
    return next();
  });
}

module.exports = {
  registerIiifImageValidation,
  relationDocumentId,
  validateIiifImageWrite,
};
