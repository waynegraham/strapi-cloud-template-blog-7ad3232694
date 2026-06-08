# Data-Quality Reports and Review Queues

Issue #13 adds a **Data Quality** page to the authenticated Strapi admin. The
page is provided by the local `data-quality` plugin and does not register a
public Content API route.

## Queues

The page provides named queues for:

- Missing Arabic title or description.
- Missing Gallery or Institution.
- Missing Agent Credits.
- Unresolved Material terms.
- Missing or failed IIIF Assets.
- Pending Agent biography reconciliation.
- Pending IIIF Image or folio reconciliation.
- Duplicate preferred IAB identifiers.
- Works requiring catalog review.

Live completeness queues are calculated from current Strapi records. Migration
and reconciliation queues read the generated ETL reports in `etl/intermediate`.
Every matched item links directly to its Work or IIIF Asset in Content Manager.
Rows that cannot yet be matched to a loaded Strapi Work remain visible as source
records without a link. An IAB code must identify exactly one loaded Work before
the plugin creates a link; duplicate codes are never resolved by choosing the
first match.

The page displays the ETL generation time from `etl/intermediate/manifest.json`.
Missing report files produce visible warnings and empty reconciliation queues;
they do not prevent Strapi from starting.

## Review Metadata

Work records include generic internal fields:

- `reviewStatus`: `not-reviewed`, `needs-review`, `approved`, or `blocked`.
- `reviewNotes`: private cataloging notes.
- `reviewedAt`: timestamp of the latest review.

These attributes are marked `private` in the schema, carry
`Schema.Attribute.Private` in generated types, and are removed from public
Content API responses by Strapi's sanitizer. They are intentionally generic and
do not preserve person-specific Airtable workflow field names. Strapi's
documentation plugin may still describe private schema attributes; that schema
description does not expose record values.

## Operations

Regenerate ETL-backed queues after changing source data or reconciliation
decisions:

```sh
cd etl
npm run transform
```

The review queues are operational aids, not automated merge instructions.
Duplicate identifiers, Agent matches, Material matches, and image matches still
require staff review.
