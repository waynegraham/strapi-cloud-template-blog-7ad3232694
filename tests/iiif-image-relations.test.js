'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createKnex = require('knex');

const records = require('../etl/airtable_dump.json');
const migration = require('../database/migrations/2026.06.08T06.00.00.connect-iiif-images-to-assets');
const {
  registerIiifImageValidation,
  validateIiifImageWrite,
} = require('../src/api/iiif-image/content-types/iiif-image/validation');

const projectRoot = path.join(__dirname, '..');

function imageStrapi(images) {
  return {
    documents(uid) {
      assert.equal(uid, 'api::iiif-image.iiif-image');
      return {
        async findOne({ documentId }) {
          return images.find((image) => image.documentId === documentId);
        },
        async findMany({ filters }) {
          const assetId = filters.iiifAsset.documentId.$eq;
          const sequence = filters.sequence.$eq;
          return images.filter(
            (image) =>
              image.sequence === sequence &&
              image.iiifAsset &&
              image.iiifAsset.documentId === assetId,
          );
        },
      };
    },
  };
}

async function iiifDatabase({ assets = [], images = [] }) {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await knex.schema.createTable('iiif_assets', (table) => {
    table.increments('id');
    table.string('document_id');
    table.string('manifest_url');
    table.string('title');
    table.string('iiif_base_url');
  });
  await knex.schema.createTable('iiif_images', (table) => {
    table.increments('id');
    table.string('document_id');
    table.integer('sequence');
    table.string('s_3_key');
    table.string('cantaloupe_identifier');
    table.string('info_json_url');
    table.string('thumbnail_url');
  });
  if (assets.length > 0) await knex('iiif_assets').insert(assets);
  if (images.length > 0) await knex('iiif_images').insert(images);

  return knex;
}

test('IIIF schemas connect Asset to ordered Images and retain a dedicated folio label', () => {
  const asset = require('../src/api/iiif-asset/content-types/iiif-asset/schema.json');
  const image = require('../src/api/iiif-image/content-types/iiif-image/schema.json');

  assert.deepEqual(asset.attributes.images, {
    type: 'relation',
    relation: 'oneToMany',
    target: 'api::iiif-image.iiif-image',
    mappedBy: 'iiifAsset',
  });
  assert.equal(image.attributes.iiifAsset.relation, 'manyToOne');
  assert.equal(image.attributes.iiifAsset.inversedBy, 'images');
  assert.equal(image.attributes.iiifAsset.required, true);
  assert.equal(image.attributes.sequence.required, true);
  assert.equal(image.attributes.sequence.min, 1);
  assert.equal(image.attributes.folioLabel.type, 'string');
});

test('IIIF Image validation rejects missing assets and duplicate asset sequences', async () => {
  await assert.rejects(
    validateIiifImageWrite(imageStrapi([]), {
      uid: 'api::iiif-image.iiif-image',
      action: 'create',
      params: { data: { sequence: 1 } },
    }),
    /requires one IIIF Asset/i,
  );

  await assert.rejects(
    validateIiifImageWrite(
      imageStrapi([
        {
          documentId: 'existing',
          sequence: 1,
          iiifAsset: { documentId: 'asset-1' },
        },
      ]),
      {
        uid: 'api::iiif-image.iiif-image',
        action: 'create',
        params: { data: { sequence: 1, iiifAsset: 'asset-1' } },
      },
    ),
    /already used within this IIIF Asset/i,
  );

  await assert.doesNotReject(
    validateIiifImageWrite(
      imageStrapi([
        {
          documentId: 'other-asset-image',
          sequence: 1,
          iiifAsset: { documentId: 'asset-2' },
        },
      ]),
      {
        uid: 'api::iiif-image.iiif-image',
        action: 'create',
        params: { data: { sequence: 1, iiifAsset: 'asset-1' } },
      },
    ),
  );
});

test('register installs IIIF Image validation as Document Service middleware', () => {
  let middleware;
  registerIiifImageValidation({
    documents: {
      use(candidate) {
        middleware = candidate;
      },
    },
  });
  assert.equal(typeof middleware, 'function');
});

test('migration uniquely matches image and asset identifiers and preserves order', async (context) => {
  const knex = await iiifDatabase({
    assets: [
      {
        id: 1,
        document_id: 'asset-1',
        manifest_url: 'https://example.org/manifests/G3_50_0276.json',
      },
    ],
    images: [
      {
        id: 10,
        document_id: 'image-1',
        sequence: 1,
        cantaloupe_identifier: 'G3_50_0276',
      },
      {
        id: 11,
        document_id: 'image-2',
        sequence: 2,
        info_json_url: 'https://images.example.org/G3_50_0276/info.json',
      },
    ],
  });
  context.after(() => knex.destroy());

  await migration.up(knex);

  assert.deepEqual(
    await knex('iiif_images_iiif_asset_lnk')
      .select('iiif_image_id', 'iiif_asset_id')
      .orderBy('iiif_image_id'),
    [
      { iiif_image_id: 10, iiif_asset_id: 1 },
      { iiif_image_id: 11, iiif_asset_id: 1 },
    ],
  );
});

test('migration reports unresolved images instead of guessing', async (context) => {
  const knex = await iiifDatabase({
    assets: [{ id: 1, document_id: 'asset-1', title: 'Known asset' }],
    images: [
      {
        id: 10,
        document_id: 'image-1',
        sequence: 1,
        cantaloupe_identifier: 'unmatched-image',
      },
    ],
  });
  context.after(() => knex.destroy());

  await assert.rejects(migration.up(knex), /Unresolved-image report.*image-1/i);
  assert.equal(await knex.schema.hasTable('iiif_images_iiif_asset_lnk'), false);
});

test('migration does not match assets and images only because URLs share a host', () => {
  const report = migration.matchImagesToAssets(
    [
      {
        id: 10,
        document_id: 'image-1',
        info_json_url: 'https://images.example.org/unmatched/info.json',
      },
    ],
    [
      {
        id: 1,
        document_id: 'asset-1',
        manifest_url: 'https://images.example.org/manifests/known.json',
      },
    ],
  );

  assert.equal(report.matches.length, 0);
  assert.equal(report.unresolved.length, 1);
});

test('generated types and API documentation include IIIF Asset/Image relations', () => {
  const generatedTypes = fs.readFileSync(
    path.join(projectRoot, 'types/generated/contentTypes.d.ts'),
    'utf8',
  );
  const pluginDocumentation = require('../src/extensions/documentation/documentation/1.0.0/full_documentation.json');
  const openApi = require('../specification.json');

  assert.match(
    generatedTypes,
    /images: Schema\.Attribute\.Relation<\s*'oneToMany',\s*'api::iiif-image\.iiif-image'/,
  );
  assert.match(
    generatedTypes,
    /iiifAsset: Schema\.Attribute\.Relation<\s*'manyToOne',\s*'api::iiif-asset\.iiif-asset'/,
  );
  assert.match(generatedTypes, /folioLabel: Schema\.Attribute\.String/);
  assert.equal(
    pluginDocumentation.components.schemas.IiifAsset.properties.images.type,
    'array',
  );
  assert.equal(
    openApi.components.schemas.ApiIiifImageIiifImageDocument.properties.iiifAsset.$ref,
    '#/components/schemas/ApiIiifAssetIiifAssetDocument',
  );
});
