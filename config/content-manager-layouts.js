'use strict';

const LAYOUT_VERSION = 1;

function edit(
  label,
  description = '',
  { visible = true, editable = true, mainField } = {},
) {
  return {
    edit: {
      label,
      description,
      placeholder: '',
      visible,
      editable,
      ...(mainField ? { mainField } : {}),
    },
    list: {
      label,
      searchable: true,
      sortable: true,
    },
  };
}

function hidden(label, description = '') {
  return edit(label, description, { visible: false, editable: false });
}

function relation(label, description, mainField, options = {}) {
  return edit(label, description, { ...options, mainField });
}

function row(...fields) {
  return fields.map(([name, size]) => ({ name, size }));
}

function settings(mainField, defaultSortBy = mainField, defaultSortOrder = 'ASC') {
  return {
    bulkable: true,
    filterable: true,
    searchable: true,
    pageSize: 20,
    relationOpenMode: 'modal',
    mainField,
    defaultSortBy,
    defaultSortOrder,
  };
}

function workDisplayTitle({ iabCode, titleEn } = {}) {
  return [iabCode, titleEn].map((value) => String(value || '').trim()).filter(Boolean).join(' - ');
}

function mergeConfiguration(existing, desired) {
  const metadatas = { ...(existing.metadatas || {}) };

  for (const [field, metadata] of Object.entries(desired.metadatas || {})) {
    metadatas[field] = {
      ...(metadatas[field] || {}),
      ...metadata,
      edit: {
        ...(metadatas[field] || {}).edit,
        ...(metadata.edit || {}),
      },
      list: {
        ...(metadatas[field] || {}).list,
        ...(metadata.list || {}),
      },
    };
  }

  return {
    ...existing,
    settings: {
      ...(existing.settings || {}),
      ...(desired.settings || {}),
    },
    metadatas,
    layouts: {
      ...(existing.layouts || {}),
      ...(desired.layouts || {}),
    },
    options: {
      ...(existing.options || {}),
      staffLayoutVersion: LAYOUT_VERSION,
    },
  };
}

const contentManagerLayouts = {
  'content_types::api::work.work': {
    settings: settings('displayTitle', 'iabCode'),
    layouts: {
      list: ['iabCode', 'titleEn', 'gallery', 'institution', 'publishedAt'],
      edit: [
        row(['iabCode', 6], ['displayTitle', 6]),
        row(['titleEn', 6], ['titleAr', 6]),
        row(['identifiers', 12]),
        row(['gallery', 6], ['institution', 6]),
        row(['agentCredits', 12]),
        row(['dateDisplayGregorianEn', 6], ['dateDisplayGregorianAr', 6]),
        row(['dateDisplayHijriEn', 6], ['dateDisplayHijriAr', 6]),
        row(['originEn', 6], ['originAr', 6]),
        row(['dimensionEn', 6], ['dimensionAr', 6]),
        row(['materialDisplayEn', 6], ['materialDisplayAr', 6]),
        row(['materials', 6]),
        row(['descriptionEn', 12]),
        row(['descriptionAr', 12]),
        row(['additionalDescriptions', 12]),
        row(['inscriptions', 12]),
        row(['footnoteEn', 12]),
        row(['footnoteAr', 12]),
        row(['curatedStories', 6], ['iiif_assets', 6]),
        row(['creditLineEn', 6], ['creditLineAr', 6]),
        row(['contributorUrl', 6]),
        row(['earliestDate', 4], ['latestDate', 4]),
      ],
    },
    metadatas: {
      iabCode: edit('Primary IAB code', 'Derived from the preferred IAB identifier; used for search and sorting.', { editable: false }),
      displayTitle: hidden('Staff display title', 'Calculated from IAB code and English title for relation selectors.'),
      identifiers: edit('Identifiers', 'Primary and alternate identifiers. Exactly one IAB identifier must be preferred.'),
      titleEn: edit('Title (English)', 'Primary public title in English.'),
      titleAr: edit('Title (Arabic)', 'Arabic companion title when available.'),
      gallery: relation('Gallery / section', 'Choose the most specific Gallery section.', 'displayTitle'),
      institution: relation('Institution', 'Holding or contributing institution for this Work.', 'nameEn'),
      agentCredits: edit('Agent credits', 'People and organizations credited on this Work with their roles.'),
      dateDisplayGregorianEn: edit('Gregorian date (English)', 'Published Gregorian date wording.'),
      dateDisplayGregorianAr: edit('Gregorian date (Arabic)', 'Arabic companion for the published Gregorian date wording.'),
      dateDisplayHijriEn: edit('Hijri date (English)', 'Published Hijri date wording.'),
      dateDisplayHijriAr: edit('Hijri date (Arabic)', 'Arabic companion for the published Hijri date wording.'),
      earliestDate: edit('Earliest year', 'Calculated/search year. Do not edit unless correcting cataloging metadata.', { editable: false }),
      latestDate: edit('Latest year', 'Calculated/search year. Do not edit unless correcting cataloging metadata.', { editable: false }),
      originEn: edit('Origin (English)', 'Published origin or place wording in English.'),
      originAr: edit('Origin (Arabic)', 'Arabic companion origin or place wording.'),
      dimensionEn: edit('Dimensions (English)', 'Published dimensions in English.'),
      dimensionAr: edit('Dimensions (Arabic)', 'Arabic companion dimensions.'),
      materialDisplayEn: edit('Material statement (English)', 'Published wording; may include techniques and support.'),
      materialDisplayAr: edit('Material statement (Arabic)', 'Arabic companion published material wording.'),
      materials: relation('Controlled material terms', 'Controlled terms used for search and filtering, not the published wording.', 'nameEn'),
      descriptionEn: edit('Description (English)', 'Primary public description in English.'),
      descriptionAr: edit('Description (Arabic)', 'Arabic companion public description.'),
      additionalDescriptions: edit('Additional typed descriptions', 'Specialized manuscript, object, or general descriptions.'),
      inscriptions: edit('Inscriptions', 'Source text, translation, language, type, and position.'),
      footnoteEn: edit('Footnotes (English)', 'Published English footnotes.'),
      footnoteAr: edit('Footnotes (Arabic)', 'Arabic companion footnotes.'),
      curatedStories: relation('Curated stories', 'Shared editorial stories related to this Work.', 'titleEn'),
      iiif_assets: relation('IIIF assets', 'Digital asset manifests for this Work. Review here; asset details are managed on IIIF Asset records.', 'title'),
      creditLineEn: edit('Credit line (English)', 'Published ownership, lender, or contributor credit line.'),
      creditLineAr: edit('Credit line (Arabic)', 'Arabic companion credit line.'),
      contributorUrl: edit('Contributor URL', 'Public URL for the contributor or lender when supplied.'),
    },
  },

  'content_types::api::gallery.gallery': {
    settings: settings('displayTitle', 'displayTitle'),
    layouts: {
      list: ['displayTitle', 'parent', 'biennale_edition', 'sortOrder', 'publishedAt'],
      edit: [
        row(['nameEn', 6], ['nameAr', 6]),
        row(['displayTitle', 6], ['slug', 6]),
        row(['parent', 6], ['level', 6]),
        row(['sortOrder', 4], ['biennale_edition', 6]),
        row(['eyebrowEn', 6], ['eyebrowAr', 6]),
        row(['descriptionEn', 12]),
        row(['descriptionAr', 12]),
        row(['coverMedia', 6]),
        row(['children', 6], ['works', 6]),
        row(['curatedStories', 6]),
      ],
    },
    metadatas: {
      nameEn: edit('Name (English)', 'Gallery or section name in English.'),
      nameAr: edit('Name (Arabic)', 'Arabic companion Gallery or section name.'),
      displayTitle: edit('Display title', 'Generated hierarchical title used in relation selectors.', { editable: false }),
      slug: edit('Slug', 'Generated from the English name; normally leave unchanged.', { editable: false }),
      parent: relation('Parent Gallery', 'Select only for sections nested under a Gallery.', 'displayTitle'),
      level: edit('Level', 'Use Gallery for top-level areas and Section for nested areas.'),
      sortOrder: edit('Sort order', 'Display order within the same parent or edition.'),
      biennale_edition: relation('Biennale edition', 'Edition this Gallery belongs to.', 'titleEn'),
      eyebrowEn: edit('Eyebrow (English)', 'Optional short label displayed above the title.'),
      eyebrowAr: edit('Eyebrow (Arabic)', 'Arabic companion eyebrow label.'),
      descriptionEn: edit('Description (English)', 'Public Gallery description in English.'),
      descriptionAr: edit('Description (Arabic)', 'Arabic companion Gallery description.'),
      coverMedia: edit('Cover media', 'Public media for this Gallery.'),
      children: relation('Child sections', 'Inverse list for review; edit section parent from the child record.', 'displayTitle', { editable: false }),
      works: relation('Works', 'Inverse list for review; assign Gallery from the Work record.', 'displayTitle', { editable: false }),
      curatedStories: relation('Curated stories', 'Stories associated with this Gallery.', 'titleEn'),
    },
  },

  'content_types::api::agent.agent': {
    settings: settings('nameEn', 'nameEn'),
    layouts: {
      list: ['nameEn', 'nameAr', 'agent_roles', 'publishedAt'],
      edit: [
        row(['nameEn', 6], ['nameAr', 6]),
        row(['slug', 6], ['url', 6]),
        row(['agent_roles', 6]),
        row(['biographyEn', 12]),
        row(['biographyAr', 12]),
        row(['image', 6]),
      ],
    },
    metadatas: {
      nameEn: edit('Name (English)', 'Preferred public name in English.'),
      nameAr: edit('Name (Arabic)', 'Arabic companion name when available.'),
      slug: edit('Slug', 'Generated from the English name; normally leave unchanged.', { editable: false }),
      agent_roles: relation('Agent roles', 'Controlled roles used for credits and filtering.', 'labelEn'),
      biographyEn: edit('Biography (English)', 'Biography owned by the Agent record, not copied onto Works.'),
      biographyAr: edit('Biography (Arabic)', 'Arabic companion biography.'),
      url: edit('External URL', 'Public reference URL for this Agent.'),
      image: edit('Image', 'Portrait or representative image.'),
    },
  },

  'content_types::api::institution.institution': {
    settings: settings('nameEn', 'nameEn'),
    layouts: {
      list: ['nameEn', 'nameAr', 'url', 'publishedAt'],
      edit: [
        row(['nameEn', 6], ['nameAr', 6]),
        row(['slug', 6], ['url', 6]),
        row(['descriptionEn', 12]),
        row(['descriptionAr', 12]),
        row(['logo', 6]),
        row(['location', 6]),
        row(['works', 6]),
      ],
    },
    metadatas: {
      nameEn: edit('Name (English)', 'Preferred institution name in English.'),
      nameAr: edit('Name (Arabic)', 'Arabic companion institution name.'),
      slug: edit('Slug', 'Generated from the English name; normally leave unchanged.', { editable: false }),
      descriptionEn: edit('Description (English)', 'Public institution description in English.'),
      descriptionAr: edit('Description (Arabic)', 'Arabic companion institution description.'),
      logo: edit('Logo', 'Public institution logo.'),
      url: edit('Institution URL', 'Official or reference URL.'),
      location: edit('Location', 'Institution location for maps and search.'),
      works: relation('Works', 'Inverse list for review; assign Institution from the Work record.', 'displayTitle', { editable: false }),
    },
  },

  'content_types::api::material.material': {
    settings: settings('nameEn', 'nameEn'),
    layouts: {
      list: ['nameEn', 'nameAr', 'type', 'gettyTerm', 'refId'],
      edit: [
        row(['nameEn', 6], ['nameAr', 6]),
        row(['type', 6], ['vocabulary', 6]),
        row(['gettyTerm', 6], ['refId', 6]),
      ],
    },
    metadatas: {
      nameEn: edit('Material term (English)', 'Controlled material term in English.'),
      nameAr: edit('Material term (Arabic)', 'Arabic companion controlled material term.'),
      type: edit('Material type', 'Medium or support.'),
      vocabulary: edit('Vocabulary', 'Authority vocabulary, usually AAT.'),
      gettyTerm: edit('Getty term', 'Getty AAT label or URL when reconciled.'),
      refId: edit('Reference ID', 'Authority identifier such as an AAT ID.'),
    },
  },

  'content_types::api::curated-story.curated-story': {
    settings: settings('titleEn', 'titleEn'),
    layouts: {
      list: ['titleEn', 'titleAr', 'sortOrder', 'publishedAt'],
      edit: [
        row(['titleEn', 6], ['titleAr', 6]),
        row(['slug', 6], ['sortOrder', 4]),
        row(['essayEn', 12]),
        row(['essayAr', 12]),
        row(['footnotesEn', 12]),
        row(['footnotesAr', 12]),
        row(['authors', 12]),
        row(['works', 6], ['galleries', 6]),
      ],
    },
    metadatas: {
      titleEn: edit('Title (English)', 'Staff-facing story title in English.'),
      titleAr: edit('Title (Arabic)', 'Arabic companion story title.'),
      slug: edit('Slug', 'Generated from the English title; normally leave unchanged.', { editable: false }),
      essayEn: edit('Essay (English)', 'Shared public story essay in English.'),
      essayAr: edit('Essay (Arabic)', 'Arabic companion story essay.'),
      footnotesEn: edit('Footnotes (English)', 'Shared story footnotes in English.'),
      footnotesAr: edit('Footnotes (Arabic)', 'Arabic companion story footnotes.'),
      authors: edit('Authors', 'Agent credits for story authors.'),
      works: relation('Related Works', 'Works connected to this shared story.', 'displayTitle'),
      galleries: relation('Related Galleries', 'Galleries connected to this shared story.', 'displayTitle'),
      sortOrder: edit('Sort order', 'Display order for staff and public presentation.'),
    },
  },

  'content_types::api::iiif-asset.iiif-asset': {
    settings: settings('title', 'title'),
    layouts: {
      list: ['title', 'work', 'processingState', 'publishedAt'],
      edit: [
        row(['title', 6], ['work', 6]),
        row(['images', 6]),
        row(['processingState', 6]),
        row(['manifestUrl', 12]),
        row(['iiifBaseUrl', 12]),
        row(['processingErrors', 12]),
      ],
    },
    metadatas: {
      title: edit('Asset title', 'Staff label for this IIIF asset or manifest.'),
      work: relation('Work', 'Work represented by this IIIF asset.', 'displayTitle'),
      images: relation('Images', 'Image records in this IIIF asset.', 'label'),
      processingState: edit('Processing state', 'Read-only processing status for digital asset staff.', { editable: false }),
      manifestUrl: hidden('Manifest URL', 'Generated IIIF manifest URL.'),
      iiifBaseUrl: hidden('IIIF base URL', 'Technical IIIF service base URL.'),
      processingErrors: hidden('Processing errors', 'Technical processing diagnostics.'),
    },
  },

  'content_types::api::iiif-image.iiif-image': {
    settings: settings('label', 'sequence'),
    layouts: {
      list: ['label', 'sequence', 'iiifAsset', 'rightsStatement', 'publishedAt'],
      edit: [
        row(['label', 6], ['folioLabel', 6]),
        row(['sequence', 4], ['iiifAsset', 6]),
        row(['captionEn', 6], ['captionAr', 6]),
        row(['rightsStatement', 6], ['rightsNote', 6]),
        row(['file', 6]),
        row(['s3key', 6], ['cantaloupeIdentifier', 6]),
        row(['width', 4], ['height', 4]),
        row(['infoJsonUrl', 12]),
        row(['thumbnailUrl', 12]),
      ],
    },
    metadatas: {
      label: edit('Image label', 'Staff-facing image label.'),
      folioLabel: edit('Folio label', 'Folio or opening label when applicable.'),
      sequence: edit('Sequence', 'Display sequence within the asset.'),
      iiifAsset: relation('IIIF asset', 'Parent IIIF asset for this image.', 'title'),
      captionEn: edit('Caption (English)', 'Public image caption in English.'),
      captionAr: edit('Caption (Arabic)', 'Arabic companion image caption.'),
      rightsStatement: relation('Rights statement', 'Controlled rights statement for this image.', 'labelEn'),
      rightsNote: edit('Rights note', 'Optional verbatim rights note when the controlled statement is insufficient.'),
      file: edit('Source file', 'Uploaded image file.'),
      s3key: hidden('S3 key', 'Technical object storage key.'),
      cantaloupeIdentifier: hidden('Cantaloupe identifier', 'Technical IIIF image server identifier.'),
      width: hidden('Width', 'Calculated pixel width.'),
      height: hidden('Height', 'Calculated pixel height.'),
      infoJsonUrl: hidden('Info JSON URL', 'Generated IIIF info.json URL.'),
      thumbnailUrl: hidden('Thumbnail URL', 'Generated thumbnail URL.'),
    },
  },

  'content_types::api::rights-statement.rights-statement': {
    settings: settings('labelEn', 'labelEn'),
    layouts: {
      list: ['labelEn', 'labelAr', 'uri', 'publishedAt'],
      edit: [
        row(['labelEn', 6], ['labelAr', 6]),
        row(['uri', 12]),
      ],
    },
    metadatas: {
      labelEn: edit('Rights label (English)', 'Controlled rights label in English.'),
      labelAr: edit('Rights label (Arabic)', 'Arabic companion rights label.'),
      uri: edit('Rights URI', 'Canonical URI for the rights statement.'),
    },
  },

  'components::shared.agent-credit': {
    settings: settings('agent'),
    layouts: {
      edit: [
        row(['agent', 6], ['agent_role', 6]),
        row(['sortOrder', 4]),
      ],
      list: ['agent', 'agent_role', 'sortOrder'],
    },
    metadatas: {
      agent: relation('Agent', 'Person or organization credited.', 'nameEn'),
      agent_role: relation('Role', 'Controlled role for this credit.', 'labelEn'),
      sortOrder: edit('Sort order', 'Order credits appear publicly.'),
    },
  },

  'components::shared.work-identifier': {
    settings: settings('value'),
    layouts: {
      edit: [
        row(['value', 6], ['type', 6]),
        row(['preferred', 6], ['source', 6]),
      ],
      list: ['value', 'type', 'preferred'],
    },
    metadatas: {
      value: edit('Identifier value', 'Identifier exactly as it should be searched or displayed.'),
      type: edit('Identifier type', 'Identifier scheme, usually IAB.'),
      preferred: edit('Preferred', 'Exactly one IAB identifier must be preferred for each Work.'),
      source: edit('Source', 'Where this identifier came from.'),
    },
  },

  'components::shared.inscription': {
    settings: settings('text'),
    layouts: {
      edit: [
        row(['text', 12]),
        row(['translation', 12]),
        row(['language', 6], ['type', 6]),
        row(['position', 6], ['author', 6]),
        row(['sortOrder', 4]),
      ],
      list: ['type', 'language', 'text'],
    },
    metadatas: {
      text: edit('Source text', 'Inscription text as it appears on the object.'),
      translation: edit('Translation', 'Translation or transliteration when available.'),
      language: edit('Language', 'Language or script of the source text.'),
      type: edit('Inscription type', 'Signature, mark, caption, date, text, translation, or other.'),
      position: edit('Position', 'Where the inscription appears.'),
      author: relation('Author', 'Agent associated with the inscription when known.', 'nameEn'),
      sortOrder: edit('Sort order', 'Order inscriptions appear publicly.'),
    },
  },

  'components::shared.work-description': {
    settings: settings('labelEn'),
    layouts: {
      edit: [
        row(['type', 6], ['sortOrder', 4]),
        row(['labelEn', 6], ['labelAr', 6]),
        row(['bodyEn', 12]),
        row(['bodyAr', 12]),
        row(['author', 6]),
      ],
      list: ['type', 'labelEn', 'sortOrder'],
    },
    metadatas: {
      type: edit('Description type', 'Manuscript, object, or general description.'),
      labelEn: edit('Label (English)', 'Optional English label for this description.'),
      labelAr: edit('Label (Arabic)', 'Arabic companion label.'),
      bodyEn: edit('Body (English)', 'Description body in English.'),
      bodyAr: edit('Body (Arabic)', 'Arabic companion description body.'),
      author: relation('Author', 'Agent associated with this description when known.', 'nameEn'),
      sortOrder: edit('Sort order', 'Order descriptions appear publicly.'),
    },
  },
};

module.exports = {
  LAYOUT_VERSION,
  contentManagerLayouts,
  mergeConfiguration,
  workDisplayTitle,
};
