# GitHub Issues: Strapi Content Model and Editorial Usability

Copy each section into a separate GitHub issue. Keep the report linked as the
architectural reference:

`docs/strapi-content-model-staff-editing-report.md`

---

# Epic: Improve Strapi Content Model and Editorial Usability

## Objective

Implement the recommendations in the Strapi content model report so
non-technical staff can correct, organize, and enrich collection data through the standard Strapi Content Manager.

## Outcomes

- Correct relationship cardinality and ownership.
- Represent shared and record-specific content appropriately.
- Make routine corrections possible without editing JSON or rerunning ETL.
- Improve bilingual entry, relation labels, validation, and review queues.
- Preserve source provenance and prevent migration data loss.

## Child Issues

- [ ] Remove generic blog-template bootstrap
- [ ] Add Gallery hierarchy and correct Work-to-Gallery relation
- [ ] Correct Work-to-Institution relation
- [ ] Design and implement repeatable Work identifiers
- [ ] Add Curated Story content type
- [ ] Add repeatable Inscription component
- [ ] Add typed Work Description component
- [ ] Connect IIIF Assets and IIIF Images
- [ ] Normalize Rights Statement usage
- [ ] Implement Agent biography reconciliation
- [ ] Improve ETL field-mapping statuses and validation
- [ ] Configure staff-oriented Content Manager layouts
- [ ] Add domain validation and duplicate prevention
- [ ] Add data-quality reports and staff review queues
- [ ] Run migration dry run and staff acceptance testing

## Reference

See `docs/strapi-content-model-staff-editing-report.md`.

---

# Issue: Remove Generic Blog-Template Bootstrap

## Objective

Prevent application startup from importing obsolete blog data or changing public
permissions for content types that are no longer part of this project.

## Current Behavior

`src/bootstrap.js` imports example categories, authors, articles, global content,
and About content. It also grants public permissions for template APIs.

## Proposed Changes

- Remove the example blog seed process from normal application bootstrap.
- Remove implicit public-permission changes.
- Preserve any domain-specific initialization that is actually required.
- Move optional demo/reference-data loading into explicit scripts.
- Ensure initialization scripts are idempotent and environment-aware.

## Acceptance Criteria

- [ ] Starting Strapi does not import blog-template records.
- [ ] Starting Strapi does not modify public API permissions.
- [ ] No code references obsolete Article, Author, or Category APIs.
- [ ] Existing application data is not deleted or modified.
- [ ] Strapi production build succeeds.
- [ ] Startup succeeds against both a new and an existing database.

## Dependencies

None. Complete this first.

---

# Issue: Add Gallery Hierarchy and Correct Work-to-Gallery Relation

## Objective

Allow staff to organize Galleries and sections hierarchically and move Works
between them using one relation dropdown.

## Current Behavior

- `Work.gallery` is one-to-one.
- Gallery has no parent, children, inverse Works, or sort order.
- Airtable Sub-gallery values are sections under `AlBidayah` or `AlMadar`.

## Proposed Changes

Add to Gallery:

- `parent`: many-to-one self relation.
- `children`: one-to-many inverse self relation.
- `works`: one-to-many inverse Work relation.
- `sortOrder`: integer.
- `level`: optional enumeration with `gallery` and `section`.
- A staff-friendly display title, such as `Parent / Name`.

Change `Work.gallery` to many-to-one with `inversedBy: "works"`.

Update ETL so:

- Top-level Airtable Gallery values create/reuse Gallery records.
- Sub-gallery values create child Gallery records.
- A Work is assigned to its Sub-gallery when present, otherwise its Gallery.

## Migration

- Preserve existing Gallery records.
- Reconnect existing Work relations after changing cardinality.
- Detect duplicate child names within the same parent.

## Acceptance Criteria

- [ ] Multiple Works can belong to one Gallery.
- [ ] A Gallery section can select one parent Gallery.
- [ ] Children and Works appear from the inverse side.
- [ ] Staff edit only `Work.gallery` and `Gallery.parent`.
- [ ] ETL assigns all 36 populated Sub-gallery values correctly.
- [ ] Parent and child belong to the same Biennale Edition.
- [ ] A Gallery cannot be its own parent.
- [ ] Strapi build and ETL field audit succeed.

## Dependencies

- Remove generic blog-template bootstrap.

---

# Issue: Correct Work-to-Institution Relation

## Objective

Allow many Works to reference one Institution and let staff correct Institution
data once.

## Current Behavior

`Work.institution` is one-to-one and Institution has no inverse Works relation.

## Proposed Changes

- Change `Work.institution` to many-to-one.
- Add `Institution.works` as the one-to-many inverse.
- Confirm whether each Work has one holding/contributing Institution.
- If multiple institutional roles are required, document and implement an
  Institution Credit component instead of a direct relation.

## Migration

Preserve all existing Work-to-Institution assignments.

## Acceptance Criteria

- [ ] Multiple Works can reference the same Institution.
- [ ] Institution displays its related Works.
- [ ] Staff assign Institution from the Work edit screen.
- [ ] Existing relations are preserved.
- [ ] Strapi build succeeds.

## Dependencies

- Remove generic blog-template bootstrap.

---

# Issue: Design and Implement Repeatable Work Identifiers

## Objective

Represent primary and alternate IAB identifiers without creating duplicate Works
or violating a unique field constraint.

## Current Behavior

- `Work.iabCode` is required and unique.
- ETL reports 30 duplicate primary codes.
- Sixteen Airtable rows contain multiple IAB codes.

## Proposed Changes

Create a repeatable identifier component containing:

- `value`: required string.
- `type`: enumeration or controlled string, default `IAB`.
- `preferred`: boolean.
- `source`: optional string.

Decide whether to retain `iabCode` as a denormalized preferred identifier for
search and display.

Add validation that each Work has exactly one preferred IAB identifier.

## Migration

- Generate a reconciliation report for duplicate and multiple codes.
- Do not automatically merge Works solely because their codes match.
- Preserve all source codes during migration.

## Acceptance Criteria

- [ ] A Work can hold multiple identifiers.
- [ ] Staff can mark one identifier preferred.
- [ ] Duplicate codes are reported for review rather than silently discarded.
- [ ] Existing IAB codes are preserved.
- [ ] Work list view remains searchable by preferred IAB code.
- [ ] ETL handles all multiple-code source rows.
- [ ] Strapi build succeeds.

## Dependencies

- Complete before the production Work load.

---

# Issue: Add Curated Story Content Type

## Objective

Let staff correct shared Curated Story content once and relate it to all relevant
Works.

## Current Behavior

Curated Story essay and footnote text exists in Airtable but has no Strapi content
type. Fifty-six populated English essay cells contain only 11 unique texts.

## Proposed Changes

Create `Curated Story` with:

- `titleEn`, `titleAr`.
- `slug`.
- `essayEn`, `essayAr`.
- `footnotesEn`, `footnotesAr`.
- Repeatable Agent Credits for authors.
- Many-to-many Works relation.
- Optional many-to-many Galleries relation.
- `sortOrder`.
- Draft & Publish.

Update Work with the inverse Curated Stories relation.

## Migration

- Group identical source story text into shared records.
- Produce a review report for near-duplicates rather than merging them
  automatically.
- Preserve English/Arabic associations and footnotes.

## Acceptance Criteria

- [ ] Staff can edit a story once and retain all Work relations.
- [ ] Stories can relate to multiple Works.
- [ ] English and Arabic content are displayed together in the edit layout.
- [ ] Story authors use existing Agent Credits.
- [ ] ETL creates shared records instead of duplicate stories.
- [ ] Strapi build and ETL audit succeed.

## Dependencies

- Gallery hierarchy, if Curated Stories will relate to Galleries.
- Agent Credits must be working correctly.

---

# Issue: Add Repeatable Inscription Component to Work

## Objective

Let staff add and correct structured inscriptions directly on a Work.

## Current Behavior

The source has 68 populated inscription values and 65 unique values. Inscriptions
have no current destination.

## Proposed Changes

Create `shared.inscription` with:

- `text`.
- `translation`.
- `language`.
- `type`: signature, mark, caption, date, text, translation, or other.
- `position`.
- Optional Agent author relation.
- `sortOrder`.

Add a repeatable `inscriptions` component to Work.

## Migration

Import each source inscription as one initial component without attempting to
parse its internal structure automatically.

## Acceptance Criteria

- [ ] Staff can add, remove, and reorder inscriptions on Work.
- [ ] Translation and source text are clearly labeled.
- [ ] Existing source text is preserved verbatim.
- [ ] Empty inscription components cannot be saved.
- [ ] ETL maps the Airtable Inscriptions field.
- [ ] Strapi build succeeds.

## Dependencies

None beyond the stable Work schema.

---

# Issue: Add Typed Work Description Component

## Objective

Represent manuscript and object notes without adding a separate schema field for
every description category.

## Current Behavior

Extra Manuscript Description and Extra Object Related Information are planned but
not represented in Strapi.

## Proposed Changes

Create `shared.work-description` with:

- `type`: manuscript, object, or general.
- `labelEn`, `labelAr`.
- `bodyEn`, `bodyAr`.
- Optional Agent author relation.
- `sortOrder`.

Add repeatable `additionalDescriptions` to Work.

## Migration

- Import manuscript fields as type `manuscript`.
- Import object-related fields as type `object`.
- Keep English and Arabic values in the same component.

## Acceptance Criteria

- [ ] Staff can add and reorder typed descriptions on Work.
- [ ] English and Arabic fields are shown together.
- [ ] ETL preserves all four source fields.
- [ ] New description categories do not require new Work attributes.
- [ ] Strapi build succeeds.

## Dependencies

None beyond the stable Work schema.

---

# Issue: Connect IIIF Assets and IIIF Images

## Objective

Give every IIIF Image clear Work/asset context so staff can correct image labels,
captions, order, and rights safely.

## Current Behavior

- IIIF Asset relates to Work.
- IIIF Image is not related to IIIF Asset or Work.
- Image annotation and opening folio values cannot be matched reliably.

## Proposed Changes

- Add `IIIF Asset.images`: one-to-many IIIF Image.
- Add `IIIF Image.iiifAsset`: many-to-one IIIF Asset.
- Keep `sequence` as image order within the asset.
- Decide whether opening folio uses `label` or a dedicated `folioLabel`.
- Add validation for sequence uniqueness within an asset.

## Migration

- Match existing IIIF Images to assets using manifest, file, S3, or Cantaloupe
  identifiers.
- Produce an unresolved-image report.
- Do not import annotation/folio data without a confirmed image match.

## Acceptance Criteria

- [ ] Staff can navigate from Work to Asset to ordered Images.
- [ ] Every migrated IIIF Image has one IIIF Asset.
- [ ] Image sequence is unique within its asset.
- [ ] Unmatched images are reported.
- [ ] Image annotation and opening folio mappings are implemented only after
      matching.
- [ ] Strapi build succeeds.

## Dependencies

- Normalize Rights Statement usage.

---

# Issue: Normalize Rights Statement Schema and Usage

## Objective

Use a controlled Rights Statement relation for IIIF Images and correct schema
naming.

## Current Behavior

- Rights Statement contains `labenAr`, likely a typo.
- IIIF Image stores rights as a free-text string.

## Proposed Changes

- Rename `labenAr` to `labelAr` through a data-preserving migration.
- Add `IIIF Image.rightsStatement` as a many-to-one relation.
- Retain an optional `rightsNote` only if verbatim local wording is needed.
- Configure Rights Statement list views to show label and URI.

## Migration

- Preserve existing Arabic labels.
- Match existing rights strings to Rights Statement records.
- Report unmatched strings.

## Acceptance Criteria

- [ ] Existing Arabic rights labels are preserved.
- [ ] Staff select a Rights Statement instead of retyping standard rights text.
- [ ] Existing unmatched rights text is reported or retained as a note.
- [ ] API documentation and generated types use `labelAr`.
- [ ] Strapi build succeeds.

## Dependencies

Complete before finalizing IIIF Image migration.

---

# Issue: Implement Agent Biography Reconciliation and Import

## Objective

Load artist biographies onto Agent records without guessing the wrong person.

## Current Behavior

Agent has `biographyEn` and `biographyAr`, but ETL only extracts writers and
curators and does not import Airtable biographies.

## Proposed Changes

- Generate a biography reconciliation report with:
  - Airtable record ID.
  - Work title and IAB code.
  - Biography text.
  - Proposed Agent.
  - Match basis/confidence.
  - Review decision.
- Expand Agent extraction to include confirmed artists.
- Import biographies only after confirmation.
- Detect conflicting biographies for the same Agent.

## Acceptance Criteria

- [ ] No biography is imported without a confirmed Agent.
- [ ] Repeated identical biographies map to one Agent record.
- [ ] Conflicting biography text is reported.
- [ ] English and Arabic biographies remain paired.
- [ ] Staff correct biography content on Agent, not Work.
- [ ] Field mapping status reflects actual implementation.

## Dependencies

- Improve ETL field-mapping statuses and validation.

---

# Issue: Improve ETL Field-Mapping Statuses and Schema Validation

## Objective

Make the field-mapping audit distinguish implemented behavior from design intent
and fail before invalid payloads are loaded.

## Current Behavior

The mapping uses `mapped`, `planned`, and `ignored`. A field can be marked mapped
even when the transform does not emit it.

## Proposed Changes

Use statuses:

- `implemented`.
- `planned`.
- `review`.
- `ignored`.

Add validation that:

- Every implemented destination exists in the Strapi schema.
- Every emitted payload field exists in its destination schema.
- Planned, review, and ignored fields do not leak into Work payloads.
- Relation references resolve to generated or existing records.
- Generated files include mapping version and audit timestamp.

## Acceptance Criteria

- [ ] Audit fails for an unknown Airtable field.
- [ ] Audit fails for a nonexistent implemented target.
- [ ] Audit fails if transform output contains an unknown schema field.
- [ ] Agent biographies remain `review` until import exists.
- [ ] Image annotations and folios remain `review` until image matching exists.
- [ ] Audit output clearly separates all four statuses.
- [ ] Automated tests cover validation failures.

## Dependencies

Do this before implementing additional ETL mappings.

---

# Issue: Configure Staff-Oriented Content Manager Layouts

## Objective

Make standard editing tasks clear to non-technical staff without exposing schema
implementation details.

## Proposed Changes

Configure edit/list views for Work, Gallery, Agent, Institution, Material,
Curated Story, IIIF Asset, IIIF Image, and Rights Statement.

Work edit order:

1. Identity.
2. Gallery and Institution.
3. Agent Credits.
4. Dates, origin, dimensions, and materials.
5. Descriptions and additional descriptions.
6. Inscriptions and footnotes.
7. Curated Stories and IIIF Assets.

Also:

- Pair English and Arabic fields visually.
- Add staff-facing labels and descriptions.
- Use disambiguated relation entry titles.
- Put derived and technical fields last or make them non-editable.
- Configure useful list columns, filters, and default sorting.

## Acceptance Criteria

- [ ] Work fields follow the documented cataloging workflow.
- [ ] English and Arabic companion fields are adjacent.
- [ ] Material statement and controlled terms have distinct explanations.
- [ ] Gallery relation shows hierarchical context.
- [ ] Work relation labels show IAB code and title.
- [ ] Technical IIIF fields are hidden from general editors.
- [ ] Staff can find records using configured list columns and filters.
- [ ] Layout changes are documented or reproducible across environments.

## Dependencies

- Complete relevant schema changes first.

---

# Issue: Add Domain Validation and Duplicate Prevention

## Objective

Prevent staff from saving internally inconsistent records or creating duplicate
authority entries.

## Proposed Changes

Add validation for:

- `earliestDate <= latestDate`.
- Gallery section requires a parent.
- Gallery parent belongs to the same Biennale Edition.
- Gallery cannot select itself or a descendant as parent.
- Preferred Work identifier exists.
- Agent Credit contains both Agent and Agent Role.
- IIIF Image sequence is unique within an asset.
- Required preferred names on shared authority records.

Add duplicate checks for:

- Agents.
- Institutions.
- Materials.
- Galleries scoped by parent/edition.
- Agent Roles.

Use domain-specific error messages.

## Acceptance Criteria

- [ ] Invalid cross-field combinations are rejected.
- [ ] Errors tell staff how to correct the record.
- [ ] Exact and normalized duplicate candidates are reported.
- [ ] Valid same-name Agents are still possible when identifiers differ.
- [ ] Validation has automated tests.
- [ ] Strapi build succeeds.

## Dependencies

- Gallery hierarchy.
- Repeatable Work identifiers.
- IIIF Asset/Image relation.

---

# Issue: Add Data-Quality Reports and Staff Review Queues

## Objective

Let staff find incomplete or unresolved records without opening every entry.

## Proposed Changes

Provide reports or saved operational queries for:

- Missing Arabic title or description.
- Missing Gallery or Institution.
- Missing Agent Credits.
- Unresolved Material terms.
- Missing or failed IIIF Assets.
- Pending biography reconciliation.
- Pending image/folio reconciliation.
- Duplicate identifiers.
- Entries requiring review.

If internal review is required, use generic private fields such as:

- `reviewStatus`.
- `reviewNotes`.
- `reviewedAt`.

Do not preserve person-specific workflow field names.

## Acceptance Criteria

- [ ] Staff can access named queues for each missing-data condition.
- [ ] Reports link directly to affected Strapi entries.
- [ ] Review metadata is not exposed through the public API.
- [ ] Reports do not require editing JSON or running ad hoc database queries.
- [ ] Workflow terminology is generic and documented.

## Dependencies

- Field mapping validation.
- Relevant content types and relations.

---

# Issue: Define Editorial Roles and Permissions

## Objective

Allow routine corrections while protecting structural vocabularies and digital
asset processing fields.

## Proposed Roles

### Editor/Cataloger

- Edit Works and narrative content.
- Select existing Agents, Institutions, Materials, and Galleries.
- Cannot delete or merge controlled authority records.

### Catalog Administrator

- Create and merge authority records.
- Manage Gallery hierarchy.
- Manage identifiers and controlled vocabularies.

### Digital Asset Administrator

- Manage IIIF Assets and Images.
- Edit image sequence, captions, rights, and processing actions.

## Acceptance Criteria

- [ ] Editors can complete routine correction acceptance tests.
- [ ] Editors cannot rename or delete controlled vocabularies.
- [ ] Only digital asset administrators can change processing fields.
- [ ] Public API permissions are configured explicitly.
- [ ] Permission configuration is documented for each environment.

## Dependencies

- Remove generic bootstrap permission seeding.
- Configure Content Manager layouts.

---

# Issue: Preserve Import Provenance Without Editable Source JSON

## Objective

Make imported records traceable without exposing ETL internals as editable staff
fields.

## Proposed Changes

Store private provenance:

- Source system.
- Airtable record ID.
- Import batch ID.
- Imported/updated timestamp.
- Source checksum.
- Optional reconciliation status.

Use either a private component or an Import Record collection type.

Do not store the complete Airtable row as editable JSON on Work.

## Acceptance Criteria

- [ ] Every imported Work can be traced to its Airtable record.
- [ ] Provenance fields are hidden or read-only for general staff.
- [ ] Re-running an import can identify changed source rows.
- [ ] Public APIs do not expose internal provenance.
- [ ] ETL reports include the import batch ID.

## Dependencies

- Improve ETL field-mapping statuses and validation.

---

# Issue: Run Migration Dry Run and Staff Acceptance Testing

## Objective

Verify that the revised model preserves data and supports routine corrections
before production migration.

## Test Dataset

Use representative records including:

- A Work with a Sub-gallery.
- A Work with multiple IAB codes.
- A Work with Curated Story content.
- A Work with inscriptions and extra descriptions.
- A Work with an Agent biography.
- A Work with multiple IIIF Images.
- A Work containing unresolved Material values.

## Staff Acceptance Tasks

1. Move a Work between Gallery sections.
2. Rename and reorder a Gallery section.
3. Correct an Agent biography once.
4. Correct a Curated Story once.
5. Add an inscription and translation.
6. Change a material statement without changing controlled terms.
7. Correct an IIIF Image label and caption.
8. Add an alternate Work identifier.
9. Find records missing Arabic content.

## Acceptance Criteria

- [ ] Strapi build succeeds.
- [ ] ETL audit has zero unknown fields or schema destinations.
- [ ] Dry run creates no unhandled API errors.
- [ ] Existing source values are preserved.
- [ ] Unresolved matches are reported rather than guessed.
- [ ] Staff complete all tasks without editing JSON or using technical IDs.
- [ ] Findings and model changes are documented before production load.

## Dependencies

All schema, ETL, layout, validation, and permission issues.

