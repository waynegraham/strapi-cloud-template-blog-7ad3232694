'use strict';

const {
  adminRoles,
  publicProfileForEnvironment,
  publicProfiles,
} = require('../config/editorial-permissions');

async function synchronizeAdminRole(strapi, definition) {
  const roleService = strapi.service('admin::role');
  const existing =
    (await roleService.findOne({ code: definition.code })) ||
    (await roleService.findOne({ name: definition.name }));
  const role = existing
    ? await roleService.update(
        { id: existing.id },
        {
          name: definition.name,
          description: definition.description,
        },
      )
    : await roleService.create({
        code: definition.code,
        name: definition.name,
        description: definition.description,
      });

  await roleService.assignPermissions(role.id, definition.permissions);

  return {
    code: definition.code,
    name: definition.name,
    status: existing ? 'updated' : 'created',
    permissions: definition.permissions.length,
  };
}

function disableAllPublicActions(permissions) {
  for (const type of Object.values(permissions)) {
    for (const controller of Object.values(type.controllers || {})) {
      for (const action of Object.values(controller)) {
        action.enabled = false;
        action.policy = '';
      }
    }
  }
}

function enablePublicAction(permissions, actionId) {
  const [type, controller, action] = actionId.split('.');
  const actionConfiguration =
    permissions[type] &&
    permissions[type].controllers &&
    permissions[type].controllers[controller] &&
    permissions[type].controllers[controller][action];

  if (!actionConfiguration) {
    throw new Error(`Public API action is not registered: ${actionId}`);
  }

  actionConfiguration.enabled = true;
  actionConfiguration.policy = '';
}

async function synchronizePublicPermissions(strapi, profile) {
  const roleService = strapi.plugin('users-permissions').service('role');
  const publicRole = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) {
    throw new Error('The Users & Permissions Public role does not exist.');
  }

  const role = await roleService.findOne(publicRole.id);
  disableAllPublicActions(role.permissions);

  for (const action of publicProfiles[profile]) {
    enablePublicAction(role.permissions, action);
  }

  await roleService.updateRole(publicRole.id, {
    name: publicRole.name,
    description: publicRole.description,
    permissions: role.permissions,
  });

  return {
    profile,
    actions: publicProfiles[profile].length,
  };
}

async function synchronizePermissions(
  strapi,
  {
    environment = process.env.NODE_ENV || 'development',
    publicProfile = process.env.PUBLIC_API_PROFILE,
  } = {},
) {
  const profile = publicProfileForEnvironment(environment, publicProfile);
  const roles = [];

  for (const definition of adminRoles) {
    roles.push(await synchronizeAdminRole(strapi, definition));
  }

  return {
    environment,
    roles,
    public: await synchronizePublicPermissions(strapi, profile),
  };
}

module.exports = {
  disableAllPublicActions,
  enablePublicAction,
  synchronizeAdminRole,
  synchronizePermissions,
  synchronizePublicPermissions,
};
