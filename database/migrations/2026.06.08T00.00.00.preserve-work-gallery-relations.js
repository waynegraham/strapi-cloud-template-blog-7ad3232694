'use strict';

module.exports = {
  async up(knex) {
    const hasWorkGalleryTable = await knex.schema.hasTable('works_gallery_lnk');
    if (!hasWorkGalleryTable) return;

    const duplicateLinks = await knex('works_gallery_lnk')
      .select('work_id', 'gallery_id')
      .count({ count: '*' })
      .groupBy('work_id', 'gallery_id')
      .havingRaw('COUNT(*) > 1');

    if (duplicateLinks.length > 0) {
      throw new Error(
        `Cannot migrate Work.gallery safely: found ${duplicateLinks.length} duplicate relation pair(s).`,
      );
    }

    const worksWithMultipleGalleries = await knex('works_gallery_lnk')
      .select('work_id')
      .countDistinct({ gallery_count: 'gallery_id' })
      .groupBy('work_id')
      .havingRaw('COUNT(DISTINCT gallery_id) > 1');

    if (worksWithMultipleGalleries.length > 0) {
      throw new Error(
        `Cannot migrate Work.gallery safely: found ${worksWithMultipleGalleries.length} Work record(s) linked to multiple Galleries.`,
      );
    }

    const hasGalleryParentTable = await knex.schema.hasTable('galleries_parent_lnk');
    if (!hasGalleryParentTable) return;

    const siblings = await knex('galleries_parent_lnk as relation')
      .join('galleries as child', 'child.id', 'relation.gallery_id')
      .select(
        'relation.inv_gallery_id as parentId',
        'child.id as childId',
        'child.name_en as childName',
      );
    const siblingKeys = new Map();
    const duplicateSiblings = [];

    for (const sibling of siblings) {
      const normalizedName = String(sibling.childName || '').trim().toLocaleLowerCase();
      if (!normalizedName) continue;

      const key = `${sibling.parentId}:${normalizedName}`;
      if (siblingKeys.has(key)) {
        duplicateSiblings.push({
          parentId: sibling.parentId,
          childIds: [siblingKeys.get(key), sibling.childId],
          childName: sibling.childName,
        });
      } else {
        siblingKeys.set(key, sibling.childId);
      }
    }

    if (duplicateSiblings.length > 0) {
      throw new Error(
        `Cannot migrate Gallery hierarchy safely: found ${duplicateSiblings.length} duplicate child name(s) within the same parent.`,
      );
    }

    const hasGalleryEditionTable = await knex.schema.hasTable(
      'galleries_biennale_edition_lnk',
    );
    if (!hasGalleryEditionTable) return;

    const editionLinks = await knex('galleries_biennale_edition_lnk').select(
      'gallery_id as galleryId',
      'biennale_edition_id as editionId',
    );
    const editionByGallery = new Map(
      editionLinks.map((link) => [String(link.galleryId), String(link.editionId)]),
    );
    const editionMismatches = siblings.filter(
      (sibling) =>
        editionByGallery.get(String(sibling.childId)) !==
        editionByGallery.get(String(sibling.parentId)),
    );

    if (editionMismatches.length > 0) {
      throw new Error(
        `Cannot migrate Gallery hierarchy safely: found ${editionMismatches.length} parent/child Biennale Edition mismatch(es).`,
      );
    }
  },
};
