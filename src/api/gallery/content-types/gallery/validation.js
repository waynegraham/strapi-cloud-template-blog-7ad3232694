'use strict';

const { errors } = require('@strapi/utils');
const {
  cleanName,
  normalizeName,
} = require('../../../shared/authority-validation');

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
  const level = data.level === undefined ? current && current.level : data.level;
  const nameEn = data.nameEn === undefined ? current && current.nameEn : data.nameEn;
  const nameAr = data.nameAr === undefined ? current && current.nameAr : data.nameAr;

  if (galleryDocumentId && parentDocumentId === galleryDocumentId) {
    throw new errors.ValidationError('A Gallery cannot be its own parent.');
  }

  if (!String(nameEn || nameAr || '').trim()) {
    throw new errors.ValidationError(
      'Gallery requires a preferred English or Arabic name.',
    );
  }

  if (level === 'section' && !parentDocumentId) {
    throw new errors.ValidationError(
      'Choose the parent Gallery for this section.',
    );
  }

  const parent = await findGallery(strapi, parentDocumentId);
  let ancestor = parent;
  const visited = new Set();
  while (ancestor && ancestor.documentId && !visited.has(ancestor.documentId)) {
    if (ancestor.documentId === galleryDocumentId) {
      throw new errors.ValidationError(
        'A Gallery cannot use one of its descendants as its parent.',
      );
    }
    visited.add(ancestor.documentId);
    ancestor = await findGallery(strapi, relationDocumentId(ancestor.parent));
  }

  if (parent) {
    const parentEditionDocumentId = editionDocumentId(parent);
    if (parentEditionDocumentId !== childEditionDocumentId) {
      throw new errors.ValidationError(
        'A Gallery section and its parent must belong to the same Biennale Edition.',
      );
    }
  }

  const preferredName = String(nameEn || nameAr).trim();
  if (preferredName) {
    const duplicates = await strapi.documents(GALLERY_UID).findMany({
      status: 'draft',
      fields: ['nameEn', 'nameAr'],
      populate: {
        parent: true,
        biennale_edition: true,
      },
      limit: 10000,
    });
    const duplicate = duplicates.find(
      (gallery) =>
        gallery.documentId !== galleryDocumentId &&
        relationDocumentId(gallery.parent) === parentDocumentId &&
        editionDocumentId(gallery) === childEditionDocumentId &&
        normalizeName(gallery.nameEn || gallery.nameAr) ===
          normalizeName(preferredName),
    );
    if (duplicate) {
      const matchType =
        cleanName(duplicate.nameEn || duplicate.nameAr).toLocaleLowerCase() ===
        cleanName(preferredName).toLocaleLowerCase()
          ? 'Exact'
          : 'Normalized';
      throw new errors.ValidationError(
        `A Gallery scope cannot contain two matching names. ${matchType} duplicate candidate: "${duplicate.nameEn || duplicate.nameAr}" under the same parent and Biennale Edition.`,
      );
    }
  }

  if (preferredName) {
    data.displayTitle =
      parent && (parent.nameEn || parent.nameAr)
        ? `${parent.nameEn || parent.nameAr} / ${preferredName}`
        : preferredName;
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
