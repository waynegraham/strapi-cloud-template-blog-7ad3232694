# ETL Pipeline

This directory contains the Airtable-to-Strapi ETL work for the CMS.

The current pipeline is intentionally split into stages:

1. Extract Airtable source rows.
2. Normalize distinct vocabularies such as agents and materials.
3. Transform source rows into intermediate Strapi API representations.
4. Load the intermediate records into Strapi through the Content API.

The transform stage does not write to Strapi directly. It produces reviewable JSON files under `etl/intermediate/` so data quality issues can be inspected before loading.

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
sub-galleries.json
works.json
duplicates.json
report.json
manifest.json
```

`manifest.json` records the generated file list, load order, source counts, and transform counts.

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
sub-galleries
works
```

`works` should be loaded after `agents`, because works reference agents.

`people`, `materials`, `galleries`, and `sub-galleries` are currently generated as normalized vocabularies for review and future CMS use. The current `work` schema does not relate to all of them.

## Works

Airtable object rows are currently transformed into Strapi `work` records.

Important mappings:

```txt
IAB Code              -> iab_code
Title of Object       -> title_en
Title of Object AR    -> text_ar
Description           -> description_en
Description AR        -> description_ar
Footnote reference    -> footnotes_en
Footnote reference AR -> footnotes_ar
Dimension             -> dimension_en
Dimension AR          -> dimension_ar
Origin                -> origin_en
Origin AR             -> origin_ar
Credit Line           -> credit_line_en
Credit Line AR        -> credit_line_ar
Date / Date AR        -> date_info.display_date_en / display_date_ar
Writer(s), Curator(s) -> agents relation references
```

Long text fields are converted to Strapi blocks rich text by splitting paragraphs on blank lines.

## Multiple IAB Codes

Some Airtable rows contain multiple comma-separated IAB codes.

The transform only creates one intermediate work for these rows, using the first IAB code as the primary value. The full row is also written to:

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

These rows require manual review before deciding whether the additional IAB codes should become separate works, aliases, related records, or be ignored.

## Reports

`report.json` contains data quality reports produced by the transform:

```txt
skipped
duplicate_iab_codes
duplicate_source_rows
missing_material_lookup
```

`skipped` currently includes rows that cannot become works because required source fields are missing.

`duplicate_iab_codes` reports repeated primary IAB codes after the multiple-code rows have been reduced to their first code.

`missing_material_lookup` reports source material display values that could not be matched to `materials_distinct.csv`.

## Loading Notes

The loader should:

- Use the Strapi REST API, not direct PostgreSQL writes.
- Send `Authorization: Bearer $STRAPI_API_TOKEN`.
- POST request bodies as `{ "data": { ... } }`.
- Use Strapi 5 `documentId` values when resolving existing records and relations.
- Avoid destructive overwrites.
- Preserve import reports for manual review.

The current transform does not publish entries explicitly. Publication behavior should be decided in the load step.

