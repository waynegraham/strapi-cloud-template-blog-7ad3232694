'use strict';

const {
  adminRoles,
  publicProfileForEnvironment,
  publicProfiles,
} = require('../../config/editorial-permissions');

async function existingRoleCollisions(knex) {
  if (!(await knex.schema.hasTable('admin_roles'))) return [];

  const names = adminRoles.map((role) => role.name);
  const codes = adminRoles.map((role) => role.code);
  const rows = await knex('admin_roles')
    .whereIn('name', names)
    .orWhereIn('code', codes)
    .select('id', 'name', 'code');

  return rows.filter((row) => {
    const definition = adminRoles.find(
      (role) => role.name === row.name || role.code === row.code,
    );
    return definition && (row.name !== definition.name || row.code !== definition.code);
  });
}

async function publicPermissionSnapshot(knex) {
  const requiredTables = [
    'up_roles',
    'up_permissions',
    'up_permissions_role_lnk',
  ];
  for (const table of requiredTables) {
    if (!(await knex.schema.hasTable(table))) return [];
  }

  return knex('up_permissions as permission')
    .join(
      'up_permissions_role_lnk as link',
      'link.permission_id',
      'permission.id',
    )
    .join('up_roles as role', 'role.id', 'link.role_id')
    .where('role.type', 'public')
    .orderBy('permission.action')
    .pluck('permission.action');
}

module.exports = {
  existingRoleCollisions,
  publicPermissionSnapshot,

  async up(knex) {
    const environment = process.env.NODE_ENV || 'development';
    const profile = publicProfileForEnvironment(
      environment,
      process.env.PUBLIC_API_PROFILE,
    );
    const currentPublicActions = await publicPermissionSnapshot(knex);
    const desiredPublicActions = publicProfiles[profile];

    return {
      environment,
      profile,
      roleCollisions: await existingRoleCollisions(knex),
      publicPermissions: {
        current: currentPublicActions.length,
        desired: desiredPublicActions.length,
        missing: desiredPublicActions.filter(
          (action) => !currentPublicActions.includes(action),
        ),
        extra: currentPublicActions.filter(
          (action) => !desiredPublicActions.includes(action),
        ),
      },
      applyCommand: 'npm run permissions:apply',
    };
  },
};
