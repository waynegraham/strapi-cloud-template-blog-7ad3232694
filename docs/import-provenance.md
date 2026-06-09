# Import Provenance

Imported Works carry a private, non-repeatable `importProvenance` component. It
stores only source traceability metadata:

- Source system.
- Airtable record ID.
- Import batch ID.
- Last import timestamp.
- SHA-256 checksum of the canonicalized Airtable `fields` object.
- Reconciliation status.

The complete Airtable row is not stored in Strapi. The component is private in
the Work schema and hidden in the Content Manager layout, so general staff cannot
edit it and the public Content API does not return it.

## Transform Runs

Set an optional stable deployment batch identifier:

```sh
ETL_IMPORT_BATCH_ID=airtable-2026-06-09 npm --prefix etl run transform
```

Without the variable, the transform generates a unique Airtable batch ID. The
same ID and timestamp are applied to every Work produced by that run.
`ETL_IMPORTED_AT` may also be set to an ISO timestamp for reproducible fixtures
and controlled migration runs.

Before replacing `etl/intermediate/works.json`, the transform compares its stored
checksums with the new source. `report.json` records source IDs under `added`,
`changed`, `unchanged`, and `removed`. Both `report.json` and `manifest.json`
include the import batch ID; the manifest also records `sha256` as the checksum
algorithm.

## Existing Data

Migration `2026.06.08T13.00.00.create-work-import-provenance.js` creates component
storage and reports existing Works that lack provenance. It does not infer an
Airtable ID from IAB codes because duplicate codes exist in the source. Reimport
from the Airtable dump, or reconcile legacy Works to source record IDs explicitly,
before relying on provenance for those rows.
