# Migration Dry Run and Staff Acceptance

## Scope

This is the production-readiness gate for GitHub issue #16. It does not resolve
pending biographies, image/folio matches, duplicate identifiers, material
vocabulary decisions, or Curated Story conflicts. Those values remain review
queues rather than being guessed.

No Strapi schema changed for this issue, so no database schema migration is
required. The implementation corrects the ETL payload contract and adds a
schema-aware migration loader.

## Automated Dry Run

Run:

```sh
npm run migration:dry-run
```

The command:

1. Audits all observed Airtable fields.
2. Regenerates intermediate payloads and reconciliation reports.
3. Validates content types, endpoints, fields, components, required values, and
   symbolic relations against the current schemas.
4. Resolves all loadable relations to deterministic placeholder `documentId`
   values without calling Strapi.
5. Verifies each transformed Work provenance checksum against its full Airtable
   source row.
6. Writes `etl/intermediate/migration-dry-run-report.json`.

The June 9, 2026 dry run validated 982 payloads:

| Content type | Payloads |
| --- | ---: |
| Agent | 31 |
| Agent Role | 35 |
| Material | 240 |
| Gallery | 16 |
| Work | 649 |
| Curated Story | 11 |

Results:

- Unknown source fields: 0
- Unknown schema destinations: 0
- Payload validation errors: 0
- Source checksum mismatches: 0
- Skipped source rows: 1 (`rec1moouz3q1ED25Z`, missing IAB code)

The dry run also removed the obsolete `people` load target and corrected Agent
Role payloads from non-schema `label_en`/`label_ar` fields to
`labelEn`/`labelAr`.

## Representative Records

Use these source-backed records:

| Requirement | IAB code / source record |
| --- | --- |
| Work with a Sub-gallery | `25-G1-01-5034` / `recojoTvbjSQYdjo4` |
| Work with multiple IAB codes | `25-G1-04-0126` / `recPGMnZjOAUr86rS` |
| Work with Curated Story content | `25-G1-01-5034` / `recojoTvbjSQYdjo4` |
| Work with inscriptions and extra descriptions | `25-G2-01-0198` / `rec1Am67FnmvtxL5c` |
| Work with unresolved Material | `25-G1-01-5034` / `recojoTvbjSQYdjo4` (`Fabrics`) |

Agent biography correction is blocked until staff confirm at least one row in
`etl/biography-reconciliation-decisions.json`. The suggested source record is
`recojoTvbjSQYdjo4`; its current status is pending and the ETL does not guess an
Agent.

The Airtable source has no confirmed IIIF Image identifiers. Test the multiple
image task against an existing CMS Work with at least two IIIF Images, or create a
clearly marked non-production staff fixture after the dry-run load.

## Staff Acceptance Script

Record tester, date, result, and notes for each task:

| Task | Expected result |
| --- | --- |
| Move a Work between Gallery sections | Select a Gallery by display title from Work; inverse lists update without editing JSON. |
| Rename and reorder a Gallery section | Edit `nameEn`/`nameAr` and `sortOrder`; Works retain the relation. |
| Correct an Agent biography once | Edit the reconciled Agent; related Works require no duplicate biography edit. |
| Correct a Curated Story once | Edit the shared story; all related Works retain it. |
| Add an inscription and translation | Add/reorder a Work Inscription component using labeled fields. |
| Change a material statement | Edit published wording without changing controlled Material relations. |
| Correct an IIIF Image label and caption | Edit visible image fields without using S3/Cantaloupe identifiers. |
| Add an alternate Work identifier | Add a component and retain exactly one preferred IAB identifier. |
| Find missing Arabic content | Use the Data Quality `Missing Arabic content` queue and open records through Content Manager links. |

Do not approve production load until every task has a recorded staff result and
the blockers below have an explicit disposition.

## Unresolved Migration Risks

The generated report currently records:

- 25 source rows with unresolved Material values. Display statements are
  preserved; controlled Material relations are omitted rather than guessed.
- 34 pending Agent biography reconciliations. No biography is imported yet.
- 9 unresolved image annotation/opening-folio rows. No IIIF Image is selected.
- 30 duplicate primary IAB codes and 16 multi-code source rows. All source codes
  are preserved; duplicates still require review.
- 1 Curated Story near-duplicate group and 4 author metadata conflicts.
- 1 source row cannot become a Work because it has no IAB code.

An authenticated `npm run migration:apply` against a disposable production-like
Strapi database and completed staff sign-off remain operational steps before the
production load.
