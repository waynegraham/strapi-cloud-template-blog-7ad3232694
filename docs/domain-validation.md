# Domain Validation

Strapi Document Service middleware registered in `src/index.js` validates
collection writes before they reach the database.

The rules cover:

- Work date ranges, preferred identifiers, inscriptions, and complete Agent
  Credits.
- Gallery parent requirements, edition consistency, hierarchy cycles, and
  parent/edition-scoped duplicate names.
- IIIF Image asset assignment and sequence uniqueness within an asset.
- Preferred names and exact/normalized duplicate candidates for Agents,
  Institutions, Materials, and Agent Roles.

Authority duplicate comparison is case-insensitive and ignores punctuation,
spacing, and Unicode diacritics. Agents with the same normalized name remain
valid only when both records have different `externalIdentifier` values.

The migration
`database/migrations/2026.06.08T09.00.00.audit-domain-validation-readiness.js`
does not merge or delete legacy data. It emits a structured review report for
invalid Work date ranges, missing authority names, and duplicate authority
candidates so cataloging staff can reconcile existing records explicitly.
