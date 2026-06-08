# Strapi Content Model and Staff Editing Report

## Purpose

This report reviews the current Strapi implementation and the 650-record Airtable
source with two goals:

1. Account for source data without forcing every Airtable column onto `Work`.
2. Let non-technical staff correct, reorganize, and enrich records through the
   standard Strapi Content Manager.

The recommendations use VRA Core as a conceptual model where it fits, while
retaining application-specific content types for exhibition and editorial content.

## Executive Summary

The current model has a sound base: `Work`, `Agent`, `Material`, `Institution`,
`Gallery`, rights, and IIIF entities are already separated. The highest-value work
is to correct relationships and add a small number of staff-oriented structures,
not to rebuild the model.

Recommended priorities:

1. Make Gallery hierarchical and change Work-to-Gallery to many-to-one.
2. Add inverse Work relations to Gallery and Institution.
3. Add a shared `Curated Story` collection type.
4. Add repeatable components for inscriptions and typed Work descriptions.
5. Connect IIIF Images to IIIF Assets before importing image annotations or folios.
6. Complete Agent biography matching rather than storing biographies on Work.
7. Resolve duplicate IAB identifiers before loading Works.
8. Configure Strapi edit/list views so staff edit only the owning side of relations.
9. Remove the generic blog-template bootstrap and implicit permission seeding.

## Current Source Coverage

The Airtable dump contains 41 observed fields:

| Status | Count | Meaning |
| --- | ---: | --- |
| Mapped/configured | 23 | Assigned to a current Strapi destination |
| Planned | 12 | Destination is not implemented |
| Ignored | 6 | Airtable workflow fields not intended for migration |
| Unaccounted | 0 | No field is absent from the mapping |

The mapping audit is useful, but `mapped` must mean that the transform actually
creates the destination data. At present, Agent biographies are marked mapped in
`field-mapping.json`, but `transform.js` does not load them onto Agents. The audit
should distinguish `implemented` from `designed` to prevent false confidence.

The field audit validates that every source field has a configured disposition; it
does not currently verify that a `mapped` destination is emitted by the transform.

## Current Model Findings

### Work

Strengths:

- Bilingual title, origin, dimensions, dates, credit lines, descriptions, and
  footnotes are represented.
- Materials and Agent Credits are modeled separately from display text.
- IAB code is required and currently unique.

Issues:

- `gallery` is `oneToOne`. This prevents multiple Works from belonging to one
  Gallery and does not match the source data.
- `institution` is `oneToOne`. Many Works normally belong to one Institution.
- Thirty duplicate primary IAB codes are reported by the transform, but `iabCode`
  is unique. Those records cannot all load successfully without reconciliation.
- Staff must understand both `materialDisplay*` and `materials`. Their labels need
  to explain that one is the published statement and the other is controlled data.
- `earliestDate` and `latestDate` are derived/search fields but are editable like
  ordinary catalog text.

### Gallery

The current Gallery type has bilingual names and descriptions, media, a slug, and
a Biennale Edition relation. It should be retained.

The source has nine Sub-gallery values, all nested under either `AlBidayah` or
`AlMadar`. This is a hierarchy within Gallery, not a second independent entity.

Missing:

- Parent/children hierarchy.
- Sort order.
- Inverse list of Works.
- A clear staff-facing display title that distinguishes similarly named sections.

### Agent and Agent Credit

Agent already has bilingual biographies, which is the correct destination for
artist biographies.

Issues:

- Airtable does not provide a reliable artist relation in the reviewed columns.
  Biography import requires an artist/Agent reconciliation step.
- The ETL currently extracts writers and curators, not all artists represented by
  biography text.
- The Agent Credit component is appropriate for Work-level roles, but ETL relation
  references must ultimately become component objects containing both `agent` and
  `agent_role`.

### IIIF

`IIIF Asset` relates to Work, but `IIIF Image` is disconnected from both. Staff
cannot reliably determine which image receives an annotation or opening-folio
label.

`IIIF Image.rights` is currently a string even though a Rights Statement content
type exists.

### Controlled Vocabularies

Material and Agent Role are suitable controlled vocabularies. Staff should select
these records rather than retype terms.

The Rights Statement schema contains a likely typo: `labenAr` should be `labelAr`.

## Data Entry and Usability Critique

The current schemas describe the data, but they do not yet provide a coherent
cataloging interface. Without additional configuration, staff will see technical
field names, long undifferentiated forms, ambiguous relations, and fields whose
authority is unclear.

### Summary of Usability Risks

| Issue | Staff impact | Priority |
| --- | --- | --- |
| Incorrect one-to-one relations | Valid Gallery and Institution assignments are blocked or overwritten | Critical |
| No configured Content Manager layouts | Forms follow schema order instead of staff workflow | High |
| Mixed naming conventions | API and admin labels expose implementation terminology | High |
| Bilingual fields are not explicitly paired | English and Arabic corrections can drift apart | High |
| Display text and controlled terms overlap | Staff cannot tell which field drives publication or search | High |
| Derived fields are editable | Search dates and slugs can contradict source values | High |
| Repeated narrative content lacks ownership | Corrections must be repeated across Works | High |
| Relations are not consistently bidirectional | Staff cannot review related records from authority entries | Medium |
| Validation is sparse | Incomplete or internally inconsistent records can be saved | High |
| IIIF Image records lack context | Image-level corrections are difficult and error-prone | High |
| Person-specific workflow flags are discarded | Useful review intent may be lost instead of generalized | Medium |
| Generic template bootstrap remains active | Startup can attempt irrelevant seed operations and permissions | High |

### 1. Forms Reflect Storage, Not Cataloging Tasks

Strapi uses schema order as the initial edit layout. The Work schema therefore
presents a long sequence of fields without explicit sections for identity,
placement, authority data, display statements, narrative text, and media.

This increases the chance that staff:

- Miss required contextual fields.
- Edit a derived field instead of its source.
- Enter controlled data into free-text fields.
- Save only one language because its companion field is far away.

Recommendation:

- Configure every staff-facing Content Manager edit and list view.
- Order fields by cataloging task, not by schema implementation history.
- Use field descriptions and staff-facing labels that avoid API terminology.
- Keep infrequently edited technical fields at the bottom or make them
  non-editable.

### 2. Bilingual Entry Is Repetitive and Easy to Desynchronize

The current model uses paired fields such as `titleEn`/`titleAr` and
`descriptionEn`/`descriptionAr`. This is reasonable for the API, but the default
admin does not guarantee that the pair is presented together or completed
consistently.

Recommendation:

- Place each English/Arabic pair on the same row where field size permits.
- Label fields consistently as “Title (English)” and “Title (Arabic)”.
- Add descriptions indicating whether Arabic is required, optional, or pending.
- Add a generic `translationStatus` such as `not-required`, `needed`,
  `in-progress`, and `complete` if staff need translation workflow.
- Use one rich-text technology consistently. Work currently uses CKEditor while
  Agent, Gallery, Institution, and Biennale Edition use Strapi Blocks. Different
  editors create different formatting behavior and training requirements.

Do not create a reusable bilingual component for every title or short label solely
for visual grouping. Components add nesting to REST responses and can make simple
list columns and filters harder. Prefer configured form layout for simple pairs.

### 3. Field Ownership Is Ambiguous

Several concepts currently have both a display form and a normalized form:

- `materialDisplayEn`/`materialDisplayAr` versus `materials`.
- Agent names in Credit Line versus Agent Credit relations.
- Date display strings versus `earliestDate`/`latestDate`.
- IIIF image rights text versus Rights Statement records.

This pattern is valid when the distinction is intentional, but staff need to know
which field is authoritative for each purpose.

Recommendation:

| Concept | Authoritative staff field | Derived/supporting field |
| --- | --- | --- |
| Published material wording | Material statement | Controlled Material terms for filtering |
| Published date wording | Date display fields | Earliest/latest year for search |
| Work participants | Agent Credits | Credit Line remains the displayed ownership/lender statement |
| Image rights | Rights Statement relation | Optional verbatim rights note only when needed |
| URL slugs | Title/name | Slug generated and normally read-only |

Use admin descriptions that explicitly state “displayed publicly”, “used for
filtering”, or “calculated automatically”.

### 4. Derived and Technical Fields Are Too Editable

Fields such as slugs, earliest/latest dates, sequence values, IIIF URLs,
Cantaloupe identifiers, processing state, dimensions in pixels, and S3 keys are
technical or derived. Editing them casually can break links or create data that
disagrees with source values.

Recommendation:

- Hide or disable derived fields for general editorial roles.
- Recompute earliest/latest dates when date display text changes.
- Generate slugs from the preferred title/name, with an administrator-only
  override.
- Restrict IIIF processing fields to digital asset administrators.
- Add a clearly labeled “Reprocess asset” action rather than asking staff to edit
  processing state or URLs.

### 5. Relations Need Clear Ownership and Search Labels

Bidirectional relations are useful for navigation, but asking staff to edit both
sides creates contradictory assignments. Relation dropdowns are also difficult to
use when entries display only a short or repeated name.

Recommendation:

- Designate one editable owning side for every relationship.
- Make inverse collections review-only in the staff layout.
- Use disambiguated relation titles:
  - Work: `IAB code - English title`
  - Gallery: `Edition / Parent / Name`
  - Agent: `Name (role or dates)`
  - Institution: `Name - location`
- Ensure searchable identifying fields are populated before relation-heavy data
  entry begins.

### 6. Authority Records Need Duplicate Prevention

Agents, Institutions, Materials, Galleries, and Agent Roles are shared authority
records. The current schemas generally do not require their names and do not
enforce normalized duplicate detection.

Staff can accidentally create:

- Spelling variants of the same Agent.
- Duplicate Institutions with slightly different punctuation.
- Material terms that should have reused an existing AAT-backed record.
- Galleries with the same name under the same parent.

Recommendation:

- Require the preferred English name or an explicitly defined fallback.
- Add external identifiers where available.
- Normalize names for duplicate checks without changing the displayed form.
- Before creating an authority record, search exact and fuzzy matches.
- Limit creation and deletion of controlled vocabulary records to catalog
  administrators.
- Let editors select existing authority records.

Do not make all human-readable names globally unique. The same name may be valid
for different people or sections; uniqueness should use identifiers or scoped
rules.

### 7. Components Improve Local Editing but Reduce Global Reuse

The Agent Credit component is a good fit because each credit belongs to its parent
record and needs ordering. The same reasoning supports components for inscriptions
and typed Work descriptions.

However, components are embedded data:

- They are easy to edit on the parent.
- They cannot be managed conveniently as independent shared records.
- They are not ideal when the same text is reused across many Works.

This is why Curated Story should be a collection type while Inscription should
normally be a component. Staff should not have to understand this technical
distinction; the edit interface should simply place each concept where corrections
are most naturally made.

### 8. Publication and Review State Are Underspecified

Draft & Publish distinguishes public from unpublished content, but it does not
fully represent catalog review. Ignoring `For Wen to Check`, `Ready to export`, and
similar fields is correct if they are obsolete, but the underlying need for review
may remain.

Recommendation:

- Confirm whether staff need an internal workflow.
- If needed, add generic fields such as:
  - `reviewStatus`: `not-reviewed`, `needs-review`, `approved`, `blocked`
  - `reviewNotes`: private text
  - `reviewedBy`: administrator/user reference where feasible
  - `reviewedAt`: datetime
- Do not use a person’s name in a permanent field.
- Keep workflow metadata private and out of the public Content API.

For complex approval workflows, evaluate Strapi Review Workflows if available in
the deployed edition before implementing custom status logic.

### 9. List Views and Bulk Correction Are Missing From the Design

Staff often correct data by finding a set of records, comparing them, and applying
the same change repeatedly. Edit forms alone do not support that workflow.

Recommendation:

- Configure list columns and default sorting for each content type.
- Expose filters for missing Arabic, review status, Gallery, Institution,
  publication status, missing media, and failed IIIF processing.
- Add saved operational queries or lightweight report endpoints for common queues.
- Provide controlled bulk scripts for changes such as moving multiple Works to a
  section or replacing a Material term.
- Never require staff to edit generated JSON or rerun ETL for ordinary corrections.

### 10. Error Messages and Validation Should Be Domain-Specific

Most current fields are optional. A record can therefore be saved while missing
the context staff expect, and generic database errors may be the first indication
that something is wrong.

Recommendation:

- Add required fields only where the rule is genuinely universal.
- Add lifecycle or document-service validation for cross-field rules:
  - `earliestDate <= latestDate`
  - Section Galleries require a parent
  - Parent Gallery belongs to the same Biennale Edition
  - Preferred identifier exists
  - Agent Credit contains both Agent and role
  - IIIF Image sequence is unique within an asset
- Return messages in cataloging language, for example:
  “Choose the parent Gallery for this section” rather than a relation constraint
  error.

### 11. The Generic Template Bootstrap Should Be Removed

`src/bootstrap.js` still imports blog-template categories, authors, articles,
global data, and public permissions on first run. Those content types are no longer
part of this domain model.

This creates several risks:

- New environments attempt irrelevant seed operations.
- Public permissions may be configured for obsolete APIs.
- Startup errors are hidden behind generic “Could not import seed data” logging.
- Staff and developers cannot easily distinguish production initialization from
  example-template behavior.

Recommendation:

- Remove the generic seed bootstrap from normal application startup.
- Replace it with explicit, idempotent domain setup commands.
- Keep reference-data loads, demo data, and permission setup as separate scripts.
- Never grant public API permissions implicitly during application bootstrap.

### 12. Naming and Schema Consistency Need Cleanup

The project mixes camelCase and snake_case attributes:

- `biennale_edition`, `agent_roles`, `agent_role`, and `iiif_assets`
- alongside `creditLineEn`, `agentCredits`, and `processingState`

The API can technically support this, but inconsistent names increase ETL mistakes
and make generated documentation harder to read. The Rights Statement typo
`labenAr` illustrates the same problem.

Recommendation:

- Standardize new attributes on camelCase.
- Rename existing fields through planned migrations, not ad hoc schema edits.
- Give staff-facing labels natural names independent of API property names.
- Add a schema validation test that detects misspelled bilingual pairs and
  unmatched relation names.

## Overall Ease-of-Use Improvements

The following improvements apply across content types.

### Provide a Small Number of Clear Entry Points

Organize the admin navigation around staff tasks:

- Catalog: Works, Agents, Institutions, Materials.
- Exhibition: Biennale Editions, Galleries, Curated Stories.
- Digital Assets: IIIF Assets, IIIF Images, Rights Statements.
- Administration: Agent Roles and other controlled vocabularies.

Hide Global/About/template content from cataloging roles unless those staff also
maintain the public website.

### Add Record Completeness Indicators

Staff should be able to tell what remains incomplete without opening every record.
Consider a calculated completeness state or report for:

- Missing Arabic title or description.
- Missing Gallery or Institution.
- Missing Agent Credit.
- Unresolved Material term.
- Missing or failed IIIF Asset.
- Pending biography/image reconciliation.

Avoid a single opaque percentage. Named missing requirements are more actionable.

### Preserve Provenance Without Cluttering Forms

For imported records, retain source identifiers and import timestamps in private,
read-only fields or a dedicated import log. Do not expose the full Airtable row as
an editable JSON field.

Recommended provenance:

- Source system.
- Airtable record ID.
- Import batch ID and timestamp.
- Last source checksum.
- Reconciliation notes where required.

This lets staff and developers trace problems without asking editors to understand
ETL internals.

### Separate Routine Corrections From Structural Administration

Define at least two staff roles:

| Role | Typical permissions |
| --- | --- |
| Editor/Cataloger | Edit Works, select relations, edit narrative and bilingual fields |
| Catalog Administrator | Create/merge authorities, change hierarchy, manage vocabularies and identifiers |
| Digital Asset Administrator | Manage IIIF processing, image order, captions, and rights |

This reduces accidental structural changes while allowing routine corrections to
remain fast.

### Document the Correction Path

For every visible field, staff should know where a correction belongs:

- Artist name or biography -> Agent.
- Role label -> Agent Role.
- Material wording -> Work material statement.
- Material normalization -> Material relation.
- Gallery placement -> Work Gallery relation.
- Gallery name/order -> Gallery.
- Story essay -> Curated Story.
- Image caption/folio -> IIIF Image.
- Rights label/URI -> Rights Statement.

Include this as a short editorial guide and reinforce it with field descriptions in
the admin interface.

## Recommended Content Model

### 1. Keep Gallery and Add Hierarchy

Do not create a separate Sub-gallery content type.

Add to `Gallery`:

| Field | Type | Staff purpose |
| --- | --- | --- |
| `parent` | many-to-one Gallery | Select the containing Gallery |
| `children` | one-to-many Gallery | Derived inverse; display read-only |
| `works` | one-to-many Work | Derived inverse; use for review |
| `sortOrder` | integer | Control frontend order |
| `level` | enum: `gallery`, `section` | Optional clarity and validation |
| `displayTitle` | string or generated field | Show `AlMadar / Arising from Paper` |

Change `Work.gallery` to many-to-one and make it the owning side.

Staff workflow:

- To move a Work, edit the Work and choose one Gallery/section.
- To reorganize a section, edit the Gallery and choose a parent.
- Do not ask staff to maintain `children` or `works`; Strapi derives them.

VRA alignment: Galleries and sections can be exported as VRA Collections with a
`partOf` relationship. The Strapi name can remain Gallery.

### 2. Curated Story Collection Type

Create a `Curated Story` collection type. There are 56 populated English essay
cells but only 11 unique texts, so embedding the essay on every Work would create
duplicate editing and inconsistent corrections.

Suggested fields:

| Field | Type |
| --- | --- |
| `titleEn`, `titleAr` | string |
| `slug` | UID |
| `essayEn`, `essayAr` | CKEditor rich text |
| `footnotesEn`, `footnotesAr` | CKEditor rich text |
| `authors` | repeatable Agent Credit component |
| `works` | many-to-many Work |
| `galleries` | many-to-many Gallery, optional |
| `sortOrder` | integer |

Staff workflow:

- Correct an essay once and all associated Works use the corrected version.
- Add/remove Works from the story relation.
- Keep story publication independent from Work publication.

This is editorial application content, not a VRA Core record.

### 3. Repeatable Inscription Component

Use a repeatable component on Work instead of a global collection type unless
inscriptions need independent URLs, publication, or reuse.

The source contains 68 populated values and 65 unique values, so most inscriptions
belong to one Work.

Suggested `shared.inscription` fields:

| Field | Type |
| --- | --- |
| `text` | rich text or long text |
| `translation` | rich text or long text |
| `language` | string or controlled term |
| `type` | enum: signature, mark, caption, date, text, translation, other |
| `position` | string |
| `author` | Agent relation, optional |
| `sortOrder` | integer |

Staff workflow:

- Add, remove, and reorder inscription blocks directly on a Work.
- Use labels such as “Signature” or “Inscription on reverse” rather than editing a
  separate global record.

VRA alignment: this corresponds to VRA `inscriptionSet`.

### 4. Typed Work Description Component

Represent manuscript and object-specific notes as repeatable typed descriptions,
not separate top-level content types.

Suggested `shared.work-description` fields:

| Field | Type |
| --- | --- |
| `type` | enum: manuscript, object, general |
| `labelEn`, `labelAr` | optional string |
| `bodyEn`, `bodyAr` | CKEditor rich text |
| `author` | Agent relation, optional |
| `sortOrder` | integer |

Staff workflow:

- Staff add a clearly labeled description block on the Work.
- English and Arabic remain adjacent in the same component.
- New description categories do not require new schema fields.

VRA alignment: this corresponds conceptually to repeatable VRA Description
elements.

### 5. Connect IIIF Asset and IIIF Image

Add:

- `IIIF Asset.images`: one-to-many IIIF Image.
- `IIIF Image.iiifAsset`: many-to-one IIIF Asset.
- `IIIF Image.rightsStatement`: many-to-one Rights Statement.

Use existing fields:

- `Image annotation` -> `IIIF Image.captionEn` after image matching.
- `Opening Folio No. On Display` -> `IIIF Image.label` or a dedicated
  `folioLabel` field after image matching.
- `sequence` controls order.

Staff workflow:

- Open the Work, navigate to its IIIF Asset, and review an ordered image list.
- Correct captions and labels on the specific image, not on Work.

If staff need region-level annotations, use IIIF Web Annotations rather than a
single image caption field.

### 6. Complete Agent Biography Import

Keep biographies on Agent.

Before import, generate a reconciliation file containing:

- Airtable record ID and Work title.
- Biography text.
- Proposed Agent.
- Confidence/matching basis.
- Review status.

Do not automatically infer an artist solely from Credit Line text. Import only
confirmed matches.

Staff workflow:

- Correct an Agent biography once.
- All Works crediting that Agent reflect the correction.

### 7. Add Repeatable Work Identifiers

The current unique `iabCode` conflicts with 30 reported duplicate primary codes and
16 rows containing multiple codes.

Recommended component:

| Field | Type |
| --- | --- |
| `value` | string |
| `type` | enum or string, default `IAB` |
| `preferred` | boolean |
| `source` | string |

Retain a primary display/search identifier if required, but enforce uniqueness only
after duplicate rows are resolved. Staff need to be able to add aliases without
creating duplicate Works.

### 8. Correct Institution Cardinality

Change Work-to-Institution to many-to-one and add `Institution.works` as the
one-to-many inverse.

Staff workflow:

- Select one holding/contributing Institution on Work.
- Correct Institution name, URL, logo, and location once.

If a Work can have multiple institutional relationships, use a repeatable
Institution Credit component with a role rather than a direct relation.

## Staff-Oriented Admin Configuration

Schema design alone will not make the interface easy. Configure Content Manager
views after adding the relationships.

### Work Edit View

Recommended order:

1. Identity: IAB identifier, English title, Arabic title.
2. Placement: Gallery/section, Institution.
3. Agents: Agent Credits.
4. Cataloging: dates, origin, dimensions, material statement and terms.
5. Narrative: descriptions and typed descriptions.
6. Inscriptions and footnotes.
7. Curated Stories and IIIF Assets.

Use field descriptions:

- `Material statement`: “Published wording; may include techniques and support.”
- `Material terms`: “Controlled terms used for search and filtering.”
- `Gallery/section`: “Choose the most specific section.”

### Gallery Edit View

Show `nameEn`, `nameAr`, `parent`, `level`, `sortOrder`, Edition, descriptions, and
media. Put derived `children` and `works` last and make them non-editable in the
layout where possible.

Set the relation entry title to a disambiguated display value. A generated
`displayTitle` such as `AlBidayah / Pious Gifts (KAWLA)` is preferable to showing
only `nameEn`.

### List Views

Expose fields staff use to find records:

- Work: IAB code, English title, Gallery, Institution, publication status.
- Gallery: display title, parent, Edition, sort order.
- Agent: English name, Arabic name, roles.
- Curated Story: title, related Work count, publication status.
- IIIF Image: label, sequence, asset, processing/rights status.

### Validation and Permissions

- Require names on Agent, Gallery, Institution, and controlled terms.
- Require parent only when Gallery `level` is `section`.
- Prevent a Gallery from selecting itself as parent.
- Limit vocabulary editing to catalog administrators.
- Let general staff select controlled terms but not rename them.
- Use Draft & Publish for public content.
- If internal review is still needed, replace person-specific Airtable flags with
  a generic private `reviewStatus` enum and `internalNotes`, rather than importing
  `For Wen to Check`.

## ETL and Mapping Recommendations

Change mapping statuses to:

| Status | Meaning |
| --- | --- |
| `implemented` | Transform currently emits valid destination data |
| `planned` | Destination is designed but not implemented |
| `ignored` | Intentionally excluded |
| `review` | Requires human reconciliation before import |

Recommended status changes:

- Artist Biography: `review`, until Agent matching is implemented.
- Sub-gallery: `planned`, target `gallery.nameEn` with parent from `Gallery`.
- Curated Story fields: `planned`, target shared Curated Story records.
- Inscriptions: `planned`, target `work.inscriptions[]`.
- Image annotation/opening folio: `review`, until IIIF Image matching exists.

Add validation that:

- Every `implemented` target exists in the current Strapi schema.
- Every emitted Work field exists in `Work.attributes`.
- Planned and ignored fields never appear in Work payloads.
- Relation references point to generated or existing records.

## Suggested Implementation Order

### Phase 1: Correct Existing Relationships

1. Gallery hierarchy and Work cardinality.
2. Institution inverse/cardinality.
3. Rights field typo and IIIF relation design.
4. IAB identifier reconciliation.

### Phase 2: Add Staff-Editable Structures

1. Curated Story collection type.
2. Inscription component.
3. Typed Work Description component.
4. IIIF Asset-to-Image relation.

### Phase 3: Configure Editorial Experience

1. Edit/list view layouts and relation labels.
2. Validation and role permissions.
3. Generic review workflow if required.
4. Staff acceptance testing with representative corrections.

### Phase 4: Load Data

1. Run field audit.
2. Generate reconciliation reports.
3. Dry-run transformed payloads against schema.
4. Load controlled vocabularies and shared records.
5. Load Works and relations.
6. Review samples in the Strapi admin before publishing.

## Acceptance Tests for Staff

Before full migration, ask non-technical staff to complete these tasks:

1. Move a Work from one section to another.
2. Rename a Gallery section without editing its Works.
3. Correct an Agent biography once and verify related Works.
4. Correct a Curated Story once and verify all related Works.
5. Add an inscription and translation to a Work.
6. Change a material display statement without changing controlled terms.
7. Correct the label and caption for one IIIF Image.
8. Add an alternate identifier without creating another Work.

If these tasks require editing both sides of a relation, locating technical IDs, or
changing JSON, the implementation is not ready for staff use.

## References

- VRA Core 4 schemas and documentation:
  https://www.loc.gov/standards/vracore/schemas.html
- VRA Core 4 element descriptions:
  https://www.loc.gov/standards/vracore/VRA_Core4_Element_Description.pdf
- Strapi model relations:
  https://docs.strapi.io/cms/backend-customization/models#relations
- Strapi Content Manager view configuration:
  https://docs.strapi.io/cms/features/content-manager
