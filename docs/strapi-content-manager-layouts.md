# Staff Content Manager Layouts

Issue #11 is implemented as versioned configuration in
`config/content-manager-layouts.js`.

The database migration
`database/migrations/2026.06.08T08.00.00.configure-staff-content-manager-layouts.js`
applies the configuration to Strapi's `strapi_core_store_settings` table. It
inserts missing layout records and updates existing records while preserving
metadata that is not managed by this configuration.

Configured content types:

- Work
- Gallery
- Agent
- Institution
- Material
- Curated Story
- IIIF Asset
- IIIF Image
- Rights Statement

The shared Agent Credit, Work Identifier, Inscription, and Work Description
component layouts are also configured because they are part of the Work and
Curated Story editing workflows.

## Conventions

- English and Arabic companion fields are adjacent when their Strapi field sizes
  allow a shared row.
- Relation selectors use staff-facing fields such as Gallery `displayTitle` and
  Work `displayTitle`.
- Work `displayTitle` is derived as `IAB code - English title`; it is populated by
  ETL, synchronized on Work writes, and backfilled by the migration.
- Inverse relations are read-only in the edit layout. Staff edit the owning side.
- Derived Work dates and slugs are read-only.
- Technical IIIF identifiers, URLs, dimensions, processing errors, and storage
  keys are hidden from the standard edit form. Useful processing and rights
  status remains available in list views.
- Search, filters, bulk actions, list columns, page size, and default sorting are
  set explicitly for each configured content type.

Update the version constant and add a migration when changing these layouts so
the same configuration is applied in every environment.
