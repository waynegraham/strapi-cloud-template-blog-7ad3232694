'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  gallerySectionKey,
  transformGalleries,
  transformWorks,
} = require('../etl/transform');
const {
  registerGalleryValidation,
  validateGalleryWrite,
} = require('../src/api/gallery/content-types/gallery/validation');

const projectRoot = path.join(__dirname, '..');
const records = require('../etl/airtable_dump.json');
const fieldMapping = require('../etl/field-mapping.json');

function hierarchyReport() {
  return {
    gallery_hierarchy: {
      section_assignments: 0,
      unique_sections: 0,
      missing_parent: [],
      duplicate_child_names: [],
    },
  };
}

function galleryStrapi(galleries) {
  return {
    documents(uid) {
      assert.equal(uid, 'api::gallery.gallery');
      return {
        async findOne({ documentId }) {
          return galleries.find((gallery) => gallery.documentId === documentId);
        },
        async findMany({ filters }) {
          const parentId = filters.parent.documentId.$eq;
          const name = filters.nameEn.$eqi.toLocaleLowerCase();
          return galleries.filter(
            (gallery) =>
              gallery.parent &&
              gallery.parent.documentId === parentId &&
              gallery.nameEn.toLocaleLowerCase() === name,
          );
        },
      };
    },
  };
}

test('Gallery and Work schemas define owned and inverse hierarchy relations', () => {
  const gallery = require('../src/api/gallery/content-types/gallery/schema.json');
  const work = require('../src/api/work/content-types/work/schema.json');

  assert.deepEqual(gallery.attributes.level.enum, ['gallery', 'section']);
  assert.equal(gallery.attributes.parent.relation, 'manyToOne');
  assert.equal(gallery.attributes.parent.inversedBy, 'children');
  assert.equal(gallery.attributes.children.relation, 'oneToMany');
  assert.equal(gallery.attributes.children.mappedBy, 'parent');
  assert.equal(gallery.attributes.works.relation, 'oneToMany');
  assert.equal(gallery.attributes.works.mappedBy, 'gallery');
  assert.equal(work.attributes.gallery.relation, 'manyToOne');
  assert.equal(work.attributes.gallery.inversedBy, 'works');
});

test('ETL creates parent-scoped Gallery sections and assigns all populated rows', () => {
  const report = hierarchyReport();
  const galleries = transformGalleries(records, report);
  const { works } = transformWorks(
    records,
    { byExact: new Map(), byPhrase: [] },
    fieldMapping,
  );
  const sections = galleries.filter((gallery) => gallery.request.body.data.level === 'section');
  const workBySourceId = new Map(works.map((work) => [work.key.split('--').at(-1), work]));
  const sourceRowsWithSections = records.filter((record) =>
    String((record.fields || {})['Sub-gallery'] || '').trim(),
  );

  assert.equal(report.gallery_hierarchy.section_assignments, 36);
  assert.equal(report.gallery_hierarchy.unique_sections, 9);
  assert.equal(report.gallery_hierarchy.missing_parent.length, 0);
  assert.equal(report.gallery_hierarchy.duplicate_child_names.length, 0);
  assert.equal(sections.length, 9);

  for (const record of sourceRowsWithSections) {
    const work = workBySourceId.get(record.id);
    assert.ok(work, `missing transformed Work for ${record.id}`);
    assert.equal(
      work.relations.gallery.key,
      gallerySectionKey(record.fields.Gallery, record.fields['Sub-gallery']),
    );
  }
});

test('ETL reports normalized duplicate child names within one parent', () => {
  const report = hierarchyReport();
  transformGalleries(
    [
      { id: 'one', fields: { Gallery: 'Parent', 'Sub-gallery': 'Faith & Practice' } },
      { id: 'two', fields: { Gallery: 'Parent', 'Sub-gallery': 'Faith Practice' } },
    ],
    report,
  );

  assert.equal(report.gallery_hierarchy.duplicate_child_names.length, 1);
});

test('Gallery validation rejects self-parenting', async () => {
  const strapi = galleryStrapi([]);
  await assert.rejects(
    validateGalleryWrite(strapi, {
      uid: 'api::gallery.gallery',
      action: 'update',
      params: {
        documentId: 'gallery-1',
        data: { parent: 'gallery-1' },
      },
    }),
    /cannot be its own parent/i,
  );
});

test('Gallery validation rejects parent and child edition mismatches', async () => {
  const strapi = galleryStrapi([
    {
      documentId: 'parent',
      nameEn: 'AlMadar',
      biennale_edition: { documentId: 'edition-1' },
    },
  ]);

  await assert.rejects(
    validateGalleryWrite(strapi, {
      uid: 'api::gallery.gallery',
      action: 'create',
      params: {
        data: {
          nameEn: 'Section',
          parent: 'parent',
          biennale_edition: 'edition-2',
        },
      },
    }),
    /same Biennale Edition/i,
  );
});

test('Gallery validation derives section metadata and rejects duplicate siblings', async () => {
  const parent = {
    documentId: 'parent',
    nameEn: 'AlMadar',
    biennale_edition: { documentId: 'edition-1' },
  };
  const strapi = galleryStrapi([parent]);
  const context = {
    uid: 'api::gallery.gallery',
    action: 'create',
    params: {
      data: {
        nameEn: 'Section',
        parent: 'parent',
        biennale_edition: 'edition-1',
      },
    },
  };

  await validateGalleryWrite(strapi, context);
  assert.equal(context.params.data.displayTitle, 'AlMadar / Section');
  assert.equal(context.params.data.level, 'section');

  await assert.rejects(
    validateGalleryWrite(
      galleryStrapi([
        parent,
        {
          documentId: 'existing-section',
          nameEn: 'Section',
          parent: { documentId: 'parent' },
          biennale_edition: { documentId: 'edition-1' },
        },
      ]),
      {
        uid: 'api::gallery.gallery',
        action: 'create',
        params: {
          data: {
            nameEn: 'section',
            parent: 'parent',
            biennale_edition: 'edition-1',
          },
        },
      },
    ),
    /cannot contain two sections/i,
  );
});

test('register installs Gallery validation as Document Service middleware', () => {
  let middleware;
  registerGalleryValidation({
    documents: {
      use(candidate) {
        middleware = candidate;
      },
    },
  });

  assert.equal(typeof middleware, 'function');
});

test('cardinality migration exists and does not rewrite relation rows', () => {
  const migrationPath = path.join(
    projectRoot,
    'database/migrations/2026.06.08T00.00.00.preserve-work-gallery-relations.js',
  );
  const source = fs.readFileSync(migrationPath, 'utf8');

  assert.match(source, /works_gallery_lnk/);
  assert.doesNotMatch(source, /\.(?:delete|del|truncate)\s*\(/);
});
