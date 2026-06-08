'use strict';

const RELATION_TABLE = 'iiif_images_iiif_asset_lnk';

function identifierParts(value) {
  const text = String(value || '').trim().toLocaleLowerCase();
  if (!text) return [];

  const decoded = (() => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  })();
  const normalized = decoded.replace(/\\/g, '/').replace(/[?#].*$/, '');
  const pathValue = (() => {
    try {
      return new URL(normalized).pathname;
    } catch {
      return normalized;
    }
  })();
  const segments = pathValue.split('/').filter(Boolean);
  const identifiers = segments.flatMap((segment) => {
    const stem = segment.replace(/\.(?:json|jpe?g|png|tiff?|jp2|webp)$/i, '');
    return [segment, stem];
  });

  if (segments.length === 0) identifiers.push(pathValue);

  return Array.from(
    new Set(
      identifiers.filter(
        (identifier) =>
          identifier.length >= 6 &&
          !['manifest', 'manifests', 'info.json', 'thumbnail'].includes(identifier),
      ),
    ),
  );
}

function identifiersForRow(row, fields) {
  return new Set(fields.flatMap((field) => identifierParts(row[field])));
}

function matchImagesToAssets(images, assets) {
  const assetIdentifiers = assets.map((asset) => ({
    asset,
    identifiers: identifiersForRow(asset, [
      'manifest_url',
      'title',
      'iiif_base_url',
    ]),
  }));
  const matches = [];
  const unresolved = [];
  const ambiguous = [];

  for (const image of images) {
    const imageIdentifiers = identifiersForRow(image, [
      's_3_key',
      'cantaloupe_identifier',
      'info_json_url',
      'thumbnail_url',
      'file_name',
      'file_url',
    ]);
    const candidates = assetIdentifiers
      .map(({ asset, identifiers }) => ({
        asset,
        shared: Array.from(imageIdentifiers).filter((value) =>
          identifiers.has(value),
        ),
      }))
      .filter((candidate) => candidate.shared.length > 0)
      .sort((left, right) => right.shared.length - left.shared.length);

    if (candidates.length === 0) {
      unresolved.push({
        image_id: image.id,
        document_id: image.document_id,
        cantaloupe_identifier: image.cantaloupe_identifier,
        s3_key: image.s_3_key,
      });
      continue;
    }

    const bestScore = candidates[0].shared.length;
    const best = candidates.filter(
      (candidate) => candidate.shared.length === bestScore,
    );
    if (best.length !== 1) {
      ambiguous.push({
        image_id: image.id,
        document_id: image.document_id,
        candidate_asset_ids: best.map((candidate) => candidate.asset.id),
        shared_identifiers: best.map((candidate) => candidate.shared),
      });
      continue;
    }

    matches.push({
      image_id: image.id,
      asset_id: best[0].asset.id,
      matched_identifiers: best[0].shared,
    });
  }

  return { matches, unresolved, ambiguous };
}

async function imageRows(knex) {
  const hasFileRelations = await knex.schema.hasTable('files_related_mph');
  const hasFiles = await knex.schema.hasTable('files');

  if (!hasFileRelations || !hasFiles) {
    return knex('iiif_images').select();
  }

  return knex('iiif_images as image')
    .leftJoin('files_related_mph as relation', function joinFileRelation() {
      this.on('relation.related_id', '=', 'image.id')
        .andOnVal('relation.related_type', '=', 'api::iiif-image.iiif-image')
        .andOnVal('relation.field', '=', 'file');
    })
    .leftJoin('files as file', 'file.id', 'relation.file_id')
    .select('image.*', 'file.name as file_name', 'file.url as file_url');
}

async function ensureRelationTable(knex) {
  if (await knex.schema.hasTable(RELATION_TABLE)) return;

  await knex.schema.createTable(RELATION_TABLE, (table) => {
    table.increments('id');
    table.integer('iiif_image_id').references('id').inTable('iiif_images').onDelete('CASCADE');
    table.integer('iiif_asset_id').references('id').inTable('iiif_assets').onDelete('CASCADE');
    table.float('iiif_image_ord');
    table.unique(['iiif_image_id', 'iiif_asset_id']);
    table.unique(['iiif_image_id']);
  });
}

module.exports = {
  identifierParts,
  matchImagesToAssets,

  async up(knex) {
    if (
      !(await knex.schema.hasTable('iiif_images')) ||
      !(await knex.schema.hasTable('iiif_assets'))
    ) {
      return;
    }

    const images = await imageRows(knex);
    if (images.length === 0) return;

    const assets = await knex('iiif_assets').select();
    const report = matchImagesToAssets(images, assets);

    if (report.unresolved.length > 0 || report.ambiguous.length > 0) {
      throw new Error(
        `Cannot connect IIIF Images safely. Unresolved-image report: ${JSON.stringify({
          unresolved: report.unresolved,
          ambiguous: report.ambiguous,
        })}`,
      );
    }

    await ensureRelationTable(knex);
    const existing = await knex(RELATION_TABLE).select(
      'iiif_image_id',
      'iiif_asset_id',
    );
    const existingImageIds = new Set(
      existing.map((relation) => String(relation.iiif_image_id)),
    );

    const inserts = report.matches
      .filter((match) => !existingImageIds.has(String(match.image_id)))
      .map((match) => ({
        iiif_image_id: match.image_id,
        iiif_asset_id: match.asset_id,
      }));

    if (inserts.length > 0) await knex(RELATION_TABLE).insert(inserts);

    const duplicateSequences = await knex('iiif_images as image')
      .join(
        `${RELATION_TABLE} as relation`,
        'relation.iiif_image_id',
        'image.id',
      )
      .select('relation.iiif_asset_id', 'image.sequence')
      .count({ count: '*' })
      .whereNotNull('image.sequence')
      .groupBy('relation.iiif_asset_id', 'image.sequence')
      .havingRaw('COUNT(*) > 1');

    if (duplicateSequences.length > 0) {
      throw new Error(
        `Cannot connect IIIF Images safely: found ${duplicateSequences.length} duplicate sequence value(s) within an asset.`,
      );
    }
  },
};
