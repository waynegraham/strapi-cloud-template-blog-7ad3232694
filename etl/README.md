# ETL Pipeline

This directory contains the Airtable-to-Strapi ETL work for the CMS.

The current pipeline is intentionally split into stages:

1. Extract Airtable source rows.
2. Normalize distinct vocabularies such as agents and materials.
3. Transform source rows into intermediate Strapi API representations.
4. Load the intermediate records into Strapi through the Content API.

The transform stage does not write to Strapi directly. It produces reviewable JSON files under `etl/intermediate/` so data quality issues can be inspected before loading.

## Field Mapping Audit

The source-to-Strapi accounting is configured in:

```txt
field-mapping.json
```

Each Airtable field must have one status:

```txt
mapped   Implemented by the current transform.
planned  Accounted for, but waiting for a content type, component, relation, or matcher.
ignored  Intentionally excluded from Strapi.
```

Run the audit without generating Strapi payloads:

```sh
npm run audit:fields
```

This writes `intermediate/field-coverage.json` and exits unsuccessfully if a field
in the Airtable dump is absent from the mapping config. The report also includes
the number of populated records for each source field.

## Environment

Create `etl/.env` with the Airtable and Strapi values used by the scripts:

```env
AIRTABLE_API_KEY=...
AIRTABLE_BASE_ID=...
AIRTABLE_TABLE_NAME=...
STRAPI_API_URL=http://localhost:1337
STRAPI_API_TOKEN=...
```

Use `STRAPI_API_URL=https://localhost:1337` if your local Strapi instance is actually serving HTTPS. The generated intermediate request URLs use this value.

## Extract

Run the Airtable extraction from this directory:

```sh
node extract.js
```

This writes:

```txt
airtable_dump.json
```

Each source row is stored as:

```json
{
  "id": "rec...",
  "fields": {}
}
```

The Airtable record ID is preserved as source provenance and should be used when reporting or manually reconciling import issues.

## Distinct Vocabularies

Agents are currently extracted with:

```sh
node extract-agents.js
```

This writes:

```txt
agents_distinct.csv
```

Materials are tracked in:

```txt
materials_distinct.csv
```

These CSVs are staging inputs for the transform step. They are not canonical CMS data.

## Transform

Run:

```sh
npm run transform
```

This reads:

```txt
airtable_dump.json
agents_distinct.csv
materials_distinct.csv
biography-reconciliation-decisions.json
```

and writes intermediate JSON files to:

```txt
etl/intermediate/
```

Generated files:

```txt
agent-roles.json
agents.json
people.json
materials.json
galleries.json
works.json
curated-stories.json
curated-story-review.json
agent-biography-review.json
duplicates.json
report.json
manifest.json
```

`manifest.json` records the generated file list, load order, source counts, and transform counts.
It also records the import batch ID and source checksum algorithm. `report.json`
compares source checksums with the previous generated `works.json` so reruns list
added, changed, unchanged, and removed Airtable rows. See
`../docs/import-provenance.md`.

## Agent Biography Reconciliation

`agent-biography-review.json` contains every Airtable row with an English or
Arabic artist biography, its Work title and IAB codes, the exact bilingual
biography pair, a proposed Agent when the biography has a usable heading, the
matching basis/confidence, and the current review decision.

Proposals are review aids only. To confirm a match, add an entry to
`biography-reconciliation-decisions.json`:

```json
[
  {
    "source_record_id": "rec...",
    "decision": "confirmed",
    "agent_name_en": "Artist Name",
    "agent_name_ar": "Artist Name AR",
    "notes": "Confirmed by cataloging staff."
  }
]
```

Use `"rejected"` for a reviewed non-match. Missing entries remain `"pending"`.
Only confirmed rows can create an Artist Agent or populate `Agent.biographyEn`
and `Agent.biographyAr`. Repeated identical bilingual pairs produce one Agent.
Conflicting pairs for the same confirmed Agent are written to `report.json` and
none of the conflicting biography text is imported.

## Intermediate Record Shape

Each loadable intermediate record has this shape:

```json
{
  "content_type": "work",
  "endpoint": "works",
  "key": "25-md-17-0950--recYgyGx1RDs5yBgd",
  "match": {
    "iab_code": "25-MD-17-0950"
  },
  "request": {
    "method": "POST",
    "url": "http://localhost:1337/api/works",
    "body": {
      "data": {}
    }
  },
  "relations": {}
}
```

The `request.body.data` shape follows Strapi 5 REST conventions. Strapi 5 create requests must wrap fields in a `data` object, and responses use `documentId` as the stable API identifier.

Relations are intentionally symbolic in the intermediate JSON. For example, a work may reference agents like this:

```json
{
  "agents": [
    {
      "content_type": "agent",
      "key": "sarah-al-abdali--writer"
    }
  ]
}
```

The loader should create or find the referenced records first, store their Strapi `documentId`s, then replace these symbolic references with Strapi relation payloads.

## Load Order

Use the load order in `manifest.json`:

```txt
agent-roles
agents
people
materials
galleries
works
curated-stories
```

`works` should be loaded after `agents`, because works reference agents.
`curated-stories` loads after Works because each shared story owns its Work
relations and embeds ordered Agent Credit references for its writers.

`people`, `materials`, and `galleries` are generated as normalized vocabularies.
Sub-gallery source values are emitted as child Gallery records and related to their
parent Gallery.

## Works

Airtable object rows are currently transformed into Strapi `work` records.

Important mappings:

```txt
IAB Code              -> identifiers[] + iabCode
Title of Object       -> titleEn
Title of Object AR    -> titleAr
Description           -> descriptionEn
Description AR        -> descriptionAr
Footnote reference    -> footnoteEn
Footnote reference AR -> footnoteAr
Inscriptions          -> inscriptions[] source text
Dimension             -> dimensionEn
Dimension AR          -> dimensionAr
Material / Material AR-> materialDisplayEn / materialDisplayAr
Origin / Origin AR    -> originEn / originAr
Credit Line fields    -> creditLineEn / creditLineAr
Date / Date AR        -> dateDisplayGregorianEn / dateDisplayGregorianAr
Gallery               -> gallery relation
Sub-gallery           -> child gallery relation (preferred over Gallery when populated)
Writer(s), Curator(s) -> agentCredits relation references
```

The reviewed Airtable export has no Institution field. The transform therefore
does not emit `work.institution`; existing CMS assignments are preserved by the
schema migration, and new assignments remain a staff cataloging task until a
reliable source field or reconciliation file is provided.

The mapping config tracks planned destinations that are not emitted yet.
Image/folio-level metadata remains planned. Agent biographies are implemented
through the explicit reconciliation workflow above. Airtable workflow fields
such as `For Wen to Check` are explicitly ignored.

Long text fields are converted to HTML paragraphs for the CKEditor custom fields.
`Inscriptions` is the exception: each populated source value is preserved as one
plain-text `inscriptions[]` component so staff can later split text, translation,
position, author, and type without losing the original wording.

## Curated Stories

Every byte-distinct populated `Curated Story Essay` value becomes one shared
Curated Story record. Its related source rows become symbolic Work relations, and
their Galleries are added as optional Gallery relations. `Writer(s)` values become
ordered Agent Credit references using the existing Agent and Writer-role records.

English/Arabic essays and footnotes stay associated with the exact English source
essay. When one exact essay group contains conflicting translations or footnotes,
the transform leaves that destination field unset and writes every candidate value
to `intermediate/curated-story-review.json`.

Writer sets can differ between Works sharing an essay. The transform retains the
union as Agent Credits so no named writer is discarded, and reports every differing
source writer set for staff review because this may over-attribute story authorship.

The same report lists near-duplicate essays after whitespace and Unicode
normalization. Near-duplicates remain separate records for staff review and are
never merged automatically.

The date fields currently preserve the complete source display strings in the
Gregorian display attributes. Splitting mixed Hijri/Gregorian strings and deriving
`earliestDate`/`latestDate` remain separate parsing work.

## Multiple IAB Codes

Some Airtable rows contain multiple comma-separated IAB codes.

The transform creates one intermediate Work for each source row and preserves every
comma-separated code in `identifiers`. The first code is marked `preferred: true`
and copied to `iabCode` for list search and display. All identifiers use type `IAB`
and source `Airtable IAB Code`.

The full source row is also written to:

```txt
intermediate/duplicates.json
```

Each duplicate report item includes:

```txt
source_record_id
title_en
raw_iab_code
primary_iab_code
additional_iab_codes
iab_codes
```

These rows remain in the reconciliation report so staff can review whether the
source grouped codes correctly. The transform does not merge Works or discard
duplicate codes.

## Reports

`report.json` contains data quality reports produced by the transform:

```txt
skipped
duplicate_iab_codes
duplicate_source_rows
missing_material_lookup
curated_stories
source_field_coverage
```

`skipped` currently includes rows that cannot become works because required source fields are missing.

`duplicate_iab_codes` reports repeated preferred IAB codes across Works. Duplicate
codes remain valid migration inputs but require manual reconciliation.

`missing_material_lookup` reports source material display values that could not be matched to `materials_distinct.csv`.

`source_field_coverage` lists every observed Airtable field, its status, and its
configured destination or ignore reason. Its `unmapped` list should remain empty;
a newly added Airtable column will appear there on the next audit or transform run.

## Loading Notes

The loader should:

- Use the Strapi REST API, not direct PostgreSQL writes.
- Send `Authorization: Bearer $STRAPI_API_TOKEN`.
- POST request bodies as `{ "data": { ... } }`.
- Use Strapi 5 `documentId` values when resolving existing records and relations.
- Avoid destructive overwrites.
- Preserve import reports for manual review.

The current transform does not publish entries explicitly. Publication behavior should be decided in the load step.
