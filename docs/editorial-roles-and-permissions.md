# Editorial Roles and Permissions

Permission policy is versioned in `config/editorial-permissions.js`. It is not
applied by application bootstrap. Synchronize an environment explicitly:

```sh
npm run permissions
npm run permissions:apply
```

The first command is a dry run. The apply command creates or updates the three
application-owned administrator roles and replaces the Users & Permissions Public
role grants with the selected profile. Existing administrator user assignments
are preserved because roles are updated in place by stable role code.

## Staff Roles

| Role | Scope |
| --- | --- |
| Editor/Cataloger | Correct Works and narrative fields; select existing authorities; no identifier, authority-label, hierarchy, delete, publish, or IIIF processing permission |
| Catalog Administrator | Manage Works, identifiers, authorities, controlled vocabularies, Gallery hierarchy, and narrative records; IIIF records are read-only |
| Digital Asset Administrator | Manage IIIF Assets, IIIF Images, Rights Statements, image order, captions, and processing fields; catalog records are read-only |

Strapi field-level update permissions protect authority names, Work identifiers,
Gallery hierarchy, and IIIF processing fields. Content Manager layouts improve the
forms but are not treated as a security boundary. Editors and catalog
administrators can read and upload media; only digital asset administrators can
update or delete Media Library assets.

## Public API Profiles

`PUBLIC_API_PROFILE` may be `none` or `public-read`.

| Environment | Default profile | Deployment action |
| --- | --- | --- |
| development | `public-read` | Run `npm run permissions:apply` after database creation or policy changes |
| test | `none` | Tests should not expose the Content API unless a test explicitly applies another profile |
| staging | `public-read` | Set `PUBLIC_API_PROFILE` explicitly in deployment configuration, then run the apply command |
| production | `public-read` | Set `PUBLIC_API_PROFILE` explicitly in deployment configuration, then run the apply command |
| any other name | `none` | Choose a profile explicitly before applying |

The `public-read` profile grants only `find` and `findOne` actions for public
domain content and uploaded media. It removes registration, authentication, and
all write actions from the Public role. Private schema fields remain excluded by
Strapi response sanitization.

## Verification

After applying, assign staff users to the application roles in
Settings > Administration Panel > Roles. Verify representative corrections with
a non-super-admin account. Re-run the dry run during deployment review whenever
the policy changes.

The migration
`2026.06.08T12.00.00.audit-editorial-permission-migration.js` reports existing
role-name/code collisions and Public-role drift. It deliberately does not mutate
permissions; the explicit apply command performs that operation after Strapi has
registered its permission actions.
