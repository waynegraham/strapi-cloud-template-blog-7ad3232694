'use strict';

const CONTENT_MANAGER_ACTION = 'plugin::content-manager.explorer';

const actions = {
  create: `${CONTENT_MANAGER_ACTION}.create`,
  read: `${CONTENT_MANAGER_ACTION}.read`,
  update: `${CONTENT_MANAGER_ACTION}.update`,
  delete: `${CONTENT_MANAGER_ACTION}.delete`,
  publish: `${CONTENT_MANAGER_ACTION}.publish`,
};

const uploadActions = {
  copyLink: 'plugin::upload.assets.copy-link',
  create: 'plugin::upload.assets.create',
  download: 'plugin::upload.assets.download',
  read: 'plugin::upload.read',
  update: 'plugin::upload.assets.update',
};

const subjects = {
  agent: 'api::agent.agent',
  agentRole: 'api::agent-role.agent-role',
  biennaleEdition: 'api::biennale-edition.biennale-edition',
  curatedStory: 'api::curated-story.curated-story',
  gallery: 'api::gallery.gallery',
  iiifAsset: 'api::iiif-asset.iiif-asset',
  iiifImage: 'api::iiif-image.iiif-image',
  institution: 'api::institution.institution',
  institutionRegion: 'api::institution-region.institution-region',
  material: 'api::material.material',
  rightsStatement: 'api::rights-statement.rights-statement',
  work: 'api::work.work',
};

const fields = {
  [subjects.agent]: [
    'nameEn',
    'nameAr',
    'externalIdentifier',
    'slug',
    'biographyEn',
    'biographyAr',
    'url',
    'image',
    'agent_roles',
  ],
  [subjects.agentRole]: ['labelEn', 'labelAr', 'agents', 'gettyTerm', 'aatId'],
  [subjects.biennaleEdition]: [
    'date',
    'titleEn',
    'titleAr',
    'slug',
    'descriptionEn',
    'descriptionAr',
    'agentCredits',
    'galleries',
  ],
  [subjects.curatedStory]: [
    'titleEn',
    'titleAr',
    'slug',
    'essayEn',
    'essayAr',
    'footnotesEn',
    'footnotesAr',
    'authors',
    'works',
    'galleries',
    'sortOrder',
  ],
  [subjects.gallery]: [
    'eyebrowEn',
    'eyebrowAr',
    'nameEn',
    'nameAr',
    'displayTitle',
    'slug',
    'sortOrder',
    'level',
    'coverMedia',
    'descriptionEn',
    'descriptionAr',
    'biennale_edition',
    'parent',
    'children',
    'works',
    'curatedStories',
  ],
  [subjects.iiifAsset]: [
    'processingState',
    'manifestUrl',
    'work',
    'title',
    'iiifBaseUrl',
    'processingErrors',
    'images',
  ],
  [subjects.iiifImage]: [
    'file',
    'sequence',
    'label',
    'folioLabel',
    's3key',
    'cantaloupeIdentifier',
    'width',
    'height',
    'infoJsonUrl',
    'thumbnailUrl',
    'captionEn',
    'captionAr',
    'rightsStatement',
    'rightsNote',
    'iiifAsset',
  ],
  [subjects.institution]: [
    'nameEn',
    'nameAr',
    'slug',
    'descriptionEn',
    'descriptionAr',
    'logo',
    'url',
    'location',
    'works',
  ],
  [subjects.institutionRegion]: ['labelEn', 'labelAr'],
  [subjects.material]: [
    'nameEn',
    'nameAr',
    'gettyTerm',
    'type',
    'vocabulary',
    'refId',
  ],
  [subjects.rightsStatement]: ['labelEn', 'labelAr', 'uri'],
  [subjects.work]: [
    'iabCode',
    'displayTitle',
    'identifiers',
    'inscriptions',
    'titleEn',
    'titleAr',
    'originEn',
    'originAr',
    'dimensionEn',
    'dimensionAr',
    'materialDisplayEn',
    'materialDisplayAr',
    'dateDisplayGregorianEn',
    'dateDisplayGregorianAr',
    'dateDisplayHijriEn',
    'dateDisplayHijriAr',
    'earliestDate',
    'latestDate',
    'creditLineEn',
    'creditLineAr',
    'contributorUrl',
    'gallery',
    'institution',
    'materials',
    'agentCredits',
    'descriptionEn',
    'descriptionAr',
    'additionalDescriptions',
    'footnoteEn',
    'footnoteAr',
    'iiif_assets',
    'curatedStories',
    'reviewStatus',
    'reviewNotes',
    'reviewedAt',
  ],
};

function permission(action, subject, permittedFields) {
  return {
    action,
    subject,
    properties: permittedFields ? { fields: permittedFields } : {},
    conditions: [],
  };
}

function pluginPermission(action) {
  return {
    action,
    subject: null,
    properties: {},
    conditions: [],
  };
}

const sharedMediaPermissions = [
  pluginPermission(uploadActions.read),
  pluginPermission(uploadActions.create),
  pluginPermission(uploadActions.download),
  pluginPermission(uploadActions.copyLink),
];

function read(subject) {
  return permission(actions.read, subject, fields[subject]);
}

function update(subject, permittedFields) {
  return permission(actions.update, subject, permittedFields);
}

function manage(subject, permittedFields = fields[subject]) {
  return [
    permission(actions.create, subject, permittedFields),
    read(subject),
    update(subject, permittedFields),
    permission(actions.delete, subject),
    permission(actions.publish, subject),
  ];
}

const editorWorkFields = fields[subjects.work].filter(
  (field) =>
    ![
      'iabCode',
      'displayTitle',
      'identifiers',
      'earliestDate',
      'latestDate',
      'iiif_assets',
    ].includes(field),
);

const adminRoles = [
  {
    code: 'app-editor-cataloger',
    name: 'Editor/Cataloger',
    description:
      'Routine catalog corrections and narrative editing without structural authority or digital processing access.',
    permissions: [
      read(subjects.work),
      update(subjects.work, editorWorkFields),
      read(subjects.agent),
      update(subjects.agent, ['biographyEn', 'biographyAr', 'url', 'image']),
      read(subjects.institution),
      update(subjects.institution, [
        'descriptionEn',
        'descriptionAr',
        'logo',
        'url',
        'location',
      ]),
      read(subjects.curatedStory),
      update(subjects.curatedStory, [
        'titleEn',
        'titleAr',
        'essayEn',
        'essayAr',
        'footnotesEn',
        'footnotesAr',
        'authors',
        'works',
        'galleries',
        'sortOrder',
      ]),
      read(subjects.biennaleEdition),
      update(subjects.biennaleEdition, ['descriptionEn', 'descriptionAr']),
      read(subjects.gallery),
      read(subjects.material),
      read(subjects.agentRole),
      read(subjects.institutionRegion),
      read(subjects.rightsStatement),
      read(subjects.iiifAsset),
      read(subjects.iiifImage),
      ...sharedMediaPermissions,
    ],
  },
  {
    code: 'app-catalog-administrator',
    name: 'Catalog Administrator',
    description:
      'Structural catalog administration, identifiers, authorities, hierarchy, and controlled vocabularies.',
    permissions: [
      ...manage(subjects.work),
      ...manage(subjects.agent),
      ...manage(subjects.institution),
      ...manage(subjects.gallery),
      ...manage(subjects.material),
      ...manage(subjects.agentRole),
      ...manage(subjects.institutionRegion),
      ...manage(subjects.curatedStory),
      ...manage(subjects.biennaleEdition),
      read(subjects.rightsStatement),
      read(subjects.iiifAsset),
      read(subjects.iiifImage),
      ...sharedMediaPermissions,
    ],
  },
  {
    code: 'app-digital-asset-administrator',
    name: 'Digital Asset Administrator',
    description:
      'IIIF assets, image order, captions, rights, and digital processing fields.',
    permissions: [
      ...manage(subjects.iiifAsset),
      ...manage(subjects.iiifImage),
      ...manage(subjects.rightsStatement),
      read(subjects.work),
      read(subjects.agent),
      read(subjects.institution),
      read(subjects.gallery),
      ...sharedMediaPermissions,
      pluginPermission(uploadActions.update),
    ],
  },
];

const publicProfiles = {
  none: [],
  'public-read': [
    'api::about.about.find',
    'api::agent-role.agent-role.find',
    'api::agent-role.agent-role.findOne',
    'api::agent.agent.find',
    'api::agent.agent.findOne',
    'api::biennale-edition.biennale-edition.find',
    'api::biennale-edition.biennale-edition.findOne',
    'api::curated-story.curated-story.find',
    'api::curated-story.curated-story.findOne',
    'api::gallery.gallery.find',
    'api::gallery.gallery.findOne',
    'api::global.global.find',
    'api::iiif-asset.iiif-asset.find',
    'api::iiif-asset.iiif-asset.findOne',
    'api::iiif-image.iiif-image.find',
    'api::iiif-image.iiif-image.findOne',
    'api::institution-region.institution-region.find',
    'api::institution-region.institution-region.findOne',
    'api::institution.institution.find',
    'api::institution.institution.findOne',
    'api::material.material.find',
    'api::material.material.findOne',
    'api::rights-statement.rights-statement.find',
    'api::rights-statement.rights-statement.findOne',
    'api::work.work.find',
    'api::work.work.findOne',
    'plugin::upload.content-api.find',
    'plugin::upload.content-api.findOne',
  ],
};

const publicProfileByEnvironment = {
  development: 'public-read',
  test: 'none',
  staging: 'public-read',
  production: 'public-read',
};

function publicProfileForEnvironment(environment, override) {
  const profile = override || publicProfileByEnvironment[environment] || 'none';

  if (!Object.hasOwn(publicProfiles, profile)) {
    throw new Error(
      `Unknown PUBLIC_API_PROFILE "${profile}". Expected one of: ${Object.keys(publicProfiles).join(', ')}`,
    );
  }

  return profile;
}

module.exports = {
  actions,
  adminRoles,
  fields,
  publicProfileByEnvironment,
  publicProfileForEnvironment,
  publicProfiles,
  subjects,
  uploadActions,
};
