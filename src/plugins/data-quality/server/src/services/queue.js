'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WORK_UID = 'api::work.work';
const ASSET_UID = 'api::iiif-asset.iiif-asset';

const QUEUE_DEFINITIONS = [
  ['missing-arabic', 'Missing Arabic content', 'Works missing an Arabic title or description.'],
  ['missing-placement', 'Missing Gallery or Institution', 'Works missing collection placement or institution context.'],
  ['missing-agent-credits', 'Missing Agent Credits', 'Works without a person or organization credit.'],
  ['unresolved-materials', 'Unresolved Material terms', 'Source material values that did not match the controlled vocabulary.'],
  ['missing-or-failed-assets', 'Missing or failed IIIF Assets', 'Works without an IIIF Asset and assets whose processing failed.'],
  ['pending-biographies', 'Pending biography reconciliation', 'Artist biographies awaiting a confirmed Agent match.'],
  ['pending-image-folio', 'Pending image or folio reconciliation', 'Image-level labels or annotations awaiting a confirmed IIIF Image match.'],
  ['duplicate-identifiers', 'Duplicate identifiers', 'Preferred IAB identifiers used by more than one source Work.'],
  ['requires-review', 'Entries requiring review', 'Works not yet approved through the generic catalog review workflow.'],
];

function hasContent(value) {
  if (value === undefined || value === null) return false;
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim().length > 0;
}

function relationCount(value) {
  if (Array.isArray(value)) return value.length;
  return value ? 1 : 0;
}

function workPath(work) {
  return work && work.documentId
    ? `/admin/content-manager/collection-types/${WORK_UID}/${work.documentId}`
    : null;
}

function assetPath(asset) {
  return asset && asset.documentId
    ? `/admin/content-manager/collection-types/${ASSET_UID}/${asset.documentId}`
    : null;
}

function workItem(work, detail, suffix = '') {
  return {
    key: `${work.documentId || work.id || work.iabCode}${suffix}`,
    title: work.displayTitle || [work.iabCode, work.titleEn].filter(Boolean).join(' - ') || 'Untitled Work',
    detail,
    adminPath: workPath(work),
  };
}

function sourceItem(row, work, detail, suffix) {
  const iabCode = (row.iab_codes || [row.iab_code]).filter(Boolean).join(', ');
  return {
    key: `${row.source_record_id || iabCode || suffix}-${suffix}`,
    title: work
      ? workItem(work, '').title
      : [iabCode, row.work_title || row.title_en].filter(Boolean).join(' - ') || 'Unmatched source record',
    detail,
    adminPath: workPath(work),
  };
}

function worksByIabCode(works) {
  const index = new Map();
  for (const work of works) {
    if (!work.iabCode) continue;
    const matches = index.get(work.iabCode) || [];
    matches.push(work);
    index.set(work.iabCode, matches);
  }
  return index;
}

function firstMatchedWork(index, row) {
  const codes = row.iab_codes || [row.iab_code];
  for (const code of codes.filter(Boolean)) {
    const matches = index.get(code);
    if (matches && matches.length === 1) return matches[0];
  }
  return undefined;
}

function buildQueues({ works = [], assets = [], reports = {} }) {
  const queues = new Map(
    QUEUE_DEFINITIONS.map(([id, label, description]) => [
      id,
      { id, label, description, items: [] },
    ]),
  );
  const byCode = worksByIabCode(works);

  for (const work of works) {
    const missingArabic = [];
    if (!hasContent(work.titleAr)) missingArabic.push('title');
    if (!hasContent(work.descriptionAr)) missingArabic.push('description');
    if (missingArabic.length) {
      queues.get('missing-arabic').items.push(
        workItem(work, `Missing Arabic ${missingArabic.join(' and ')}.`),
      );
    }

    const missingPlacement = [];
    if (!work.gallery) missingPlacement.push('Gallery');
    if (!work.institution) missingPlacement.push('Institution');
    if (missingPlacement.length) {
      queues.get('missing-placement').items.push(
        workItem(work, `Missing ${missingPlacement.join(' and ')}.`),
      );
    }

    if (relationCount(work.agentCredits) === 0) {
      queues.get('missing-agent-credits').items.push(
        workItem(work, 'No Agent Credits are assigned.'),
      );
    }

    if (relationCount(work.iiif_assets) === 0) {
      queues.get('missing-or-failed-assets').items.push(
        workItem(work, 'No IIIF Asset is connected.', '-missing-asset'),
      );
    }

    if (work.reviewStatus !== 'approved') {
      queues.get('requires-review').items.push(
        workItem(work, `Review status: ${work.reviewStatus || 'not-reviewed'}.`),
      );
    }
  }

  for (const asset of assets) {
    if (asset.processingState !== 'failed') continue;
    queues.get('missing-or-failed-assets').items.push({
      key: `asset-${asset.documentId || asset.id}`,
      title: asset.title || 'Untitled IIIF Asset',
      detail: asset.processingErrors || 'IIIF processing failed.',
      adminPath: assetPath(asset),
    });
  }

  for (const row of reports.missingMaterials || []) {
    const work = firstMatchedWork(byCode, row);
    queues.get('unresolved-materials').items.push(
      sourceItem(row, work, `Unmatched source material: ${row.material}.`, 'material'),
    );
  }

  for (const row of reports.biographies || []) {
    if ((row.review_decision || {}).decision !== 'pending') continue;
    const work = firstMatchedWork(byCode, row);
    queues.get('pending-biographies').items.push(
      sourceItem(row, work, 'Biography requires a confirmed Agent match.', 'biography'),
    );
  }

  for (const row of reports.iiifImages || []) {
    if (row.status !== 'unresolved') continue;
    const work = firstMatchedWork(byCode, row);
    queues.get('pending-image-folio').items.push(
      sourceItem(row, work, row.reason || 'Image or folio match is unresolved.', 'image'),
    );
  }

  for (const row of reports.duplicateIdentifiers || []) {
    const matches = byCode.get(row.iab_code) || [undefined];
    for (const [index, work] of matches.entries()) {
      queues.get('duplicate-identifiers').items.push({
        key: `${row.iab_code}-${work ? work.documentId : index}`,
        title: work ? workItem(work, '').title : row.iab_code,
        detail: `Identifier occurs on ${row.count} source Works; do not merge automatically.`,
        adminPath: workPath(work),
      });
    }
  }

  return QUEUE_DEFINITIONS.map(([id]) => queues.get(id));
}

function readJson(filePath, fallback, warnings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    warnings.push(`ETL report unavailable: ${path.basename(filePath)}.`);
    return fallback;
  }
}

function loadReports(projectRoot = process.cwd()) {
  const directory = path.join(projectRoot, 'etl', 'intermediate');
  const warnings = [];
  const report = readJson(path.join(directory, 'report.json'), {}, warnings);
  const biographies = readJson(
    path.join(directory, 'agent-biography-review.json'),
    [],
    warnings,
  );
  const iiifImages = readJson(
    path.join(directory, 'iiif-image-review.json'),
    [],
    warnings,
  );
  const manifest = readJson(path.join(directory, 'manifest.json'), {}, warnings);

  return {
    reports: {
      missingMaterials: report.missing_material_lookup || [],
      duplicateIdentifiers: report.duplicate_iab_codes || [],
      biographies,
      iiifImages,
    },
    generatedAt: manifest.generated_at || null,
    warnings,
  };
}

module.exports = ({ strapi }) => ({
  async getQueues() {
    const [works, assets] = await Promise.all([
      strapi.documents(WORK_UID).findMany({
        fields: [
          'documentId',
          'iabCode',
          'displayTitle',
          'titleEn',
          'titleAr',
          'descriptionAr',
          'reviewStatus',
        ],
        populate: {
          gallery: true,
          institution: true,
          agentCredits: true,
          iiif_assets: true,
        },
      }),
      strapi.documents(ASSET_UID).findMany({
        fields: [
          'documentId',
          'title',
          'processingState',
          'processingErrors',
        ],
      }),
    ]);
    const { reports, generatedAt, warnings } = loadReports();

    return {
      generatedAt,
      warnings,
      queues: buildQueues({ works, assets, reports }),
    };
  },
});

module.exports.buildQueues = buildQueues;
module.exports.hasContent = hasContent;
module.exports.loadReports = loadReports;
