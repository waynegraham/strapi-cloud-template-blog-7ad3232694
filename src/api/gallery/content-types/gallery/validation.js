'use strict';

const { errors } = require('@strapi/utils');

const GALLERY_UID = 'api::gallery.gallery';
const WRITE_ACTIONS = new Set(['create', 'update']);

function relationDocumentId(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value.documentId) return value.documentId;

  if (Array.isArray(value)) {
    return relationDocumentId(value[value.length - 1]);
  }

  for (const operation of ['set', 'connect']) {
    if (value[operation]) {
      return relationDocumentId(value[operation]);
    }
  }

  return undefined;
}

async function findGallery(strapi, documentId) {
  if (!documentId) return undefined;

  return strapi.documents(GALLERY_UID).findOne({
    documentId,
    status: 'draft',
    populate: {
      parent: true,
      biennale_edition: true,
    },
  });
}

function editionDocumentId(gallery) {
  return relationDocumentId(gallery && gallery.biennale_edition);
}

async function validateGalleryWrite(strapi, context) {
  if (context.uid !== GALLERY_UID || !WRITE_ACTIONS.has(context.action)) return;

  const data = context.params.data || {};
  const current = await findGallery(strapi, context.params.documentId);
  const galleryDocumentId = context.params.documentId || (current && current.documentId);
  const parentWasProvided = Object.prototype.hasOwnProperty.call(data, 'parent');
  const editionWasProvided = Object.prototype.hasOwnProperty.call(data, 'biennale_edition');
  const parentDocumentId = parentWasProvided
    ? relationDocumentId(data.parent)
    : relationDocumentId(current && current.parent);
  const childEditionDocumentId = editionWasProvided
    ? relationDocumentId(data.biennale_edition)
    : editionDocumentId(current);

  if (galleryDocumentId && parentDocumentId === galleryDocumentId) {
    throw new errors.ValidationError('A Gallery cannot be its own parent.');
  }

  const parent = await findGallery(strapi, parentDocumentId);
  if (parent) {
    const parentEditionDocumentId = editionDocumentId(parent);
    if (parentEditionDocumentId !== childEditionDocumentId) {
      throw new errors.ValidationError(
        'A Gallery section and its parent must belong to the same Biennale Edition.',
      );
    }
  }

  const nameEn = data.nameEn === undefined ? current && current.nameEn : data.nameEn;
  if (parent && nameEn) {
    const duplicates = await strapi.documents(GALLERY_UID).findMany({
      status: 'draft',
      filters: {
        nameEn: { $eqi: nameEn },
        parent: { documentId: { $eq: parentDocumentId } },
      },
      limit: 2,
    });
    const duplicate = duplicates.find((gallery) => gallery.documentId !== galleryDocumentId);
    if (duplicate) {
      throw new errors.ValidationError(
        'A Gallery parent cannot contain two sections with the same English name.',
      );
    }
  }

  if (nameEn) {
    data.displayTitle = parent && parent.nameEn ? `${parent.nameEn} / ${nameEn}` : nameEn;
  }

  if (parentDocumentId) {
    data.level = 'section';
  } else if (parentWasProvided || !current) {
    data.level = 'gallery';
  }
}

function registerGalleryValidation(strapi) {
  strapi.documents.use(async (context, next) => {
    await validateGalleryWrite(strapi, context);
    return next();
  });
}

module.exports = {
  editionDocumentId,
  registerGalleryValidation,
  relationDocumentId,
  validateGalleryWrite,
};
