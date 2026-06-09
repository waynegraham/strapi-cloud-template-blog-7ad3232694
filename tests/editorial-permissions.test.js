'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createKnex = require('knex');

const policy = require('../config/editorial-permissions');
const {
  disableAllPublicActions,
  enablePublicAction,
  synchronizePermissions,
} = require('../src/permissions');
const migration = require('../database/migrations/2026.06.08T12.00.00.audit-editorial-permission-migration');

function role(name) {
  return policy.adminRoles.find((candidate) => candidate.name === name);
}

function permissionFor(definition, action, subject) {
  return definition.permissions.find(
    (permission) =>
      permission.action === action && permission.subject === subject,
  );
}

test('Editor/Cataloger can correct routine content without structural authority changes', () => {
  const editor = role('Editor/Cataloger');
  const workUpdate = permissionFor(
    editor,
    policy.actions.update,
    policy.subjects.work,
  );
  const agentUpdate = permissionFor(
    editor,
    policy.actions.update,
    policy.subjects.agent,
  );

  assert.ok(workUpdate.properties.fields.includes('gallery'));
  assert.ok(workUpdate.properties.fields.includes('materials'));
  assert.ok(workUpdate.properties.fields.includes('descriptionEn'));
  assert.ok(!workUpdate.properties.fields.includes('identifiers'));
  assert.deepEqual(agentUpdate.properties.fields, [
    'biographyEn',
    'biographyAr',
    'url',
    'image',
  ]);

  for (const subject of [
    policy.subjects.material,
    policy.subjects.agentRole,
    policy.subjects.gallery,
  ]) {
    assert.equal(
      permissionFor(editor, policy.actions.update, subject),
      undefined,
    );
    assert.equal(
      permissionFor(editor, policy.actions.delete, subject),
      undefined,
    );
  }
});

test('only the Digital Asset Administrator can update IIIF processing fields', () => {
  for (const name of ['Editor/Cataloger', 'Catalog Administrator']) {
    const definition = role(name);
    assert.equal(
      permissionFor(
        definition,
        policy.actions.update,
        policy.subjects.iiifAsset,
      ),
      undefined,
    );
    assert.equal(
      permissionFor(
        definition,
        policy.actions.update,
        policy.subjects.iiifImage,
      ),
      undefined,
    );
  }

  const digital = role('Digital Asset Administrator');
  const assetUpdate = permissionFor(
    digital,
    policy.actions.update,
    policy.subjects.iiifAsset,
  );
  const imageUpdate = permissionFor(
    digital,
    policy.actions.update,
    policy.subjects.iiifImage,
  );
  assert.ok(assetUpdate.properties.fields.includes('processingState'));
  assert.ok(assetUpdate.properties.fields.includes('processingErrors'));
  assert.ok(imageUpdate.properties.fields.includes('sequence'));
  assert.ok(imageUpdate.properties.fields.includes('cantaloupeIdentifier'));
  assert.ok(
    digital.permissions.some(
      (permission) => permission.action === policy.uploadActions.update,
    ),
  );
  assert.equal(
    role('Editor/Cataloger').permissions.some(
      (permission) => permission.action === policy.uploadActions.update,
    ),
    false,
  );
});

test('public API profiles are explicit and read-only', () => {
  assert.equal(policy.publicProfileForEnvironment('test'), 'none');
  assert.equal(
    policy.publicProfileForEnvironment('production'),
    'public-read',
  );
  assert.throws(
    () => policy.publicProfileForEnvironment('production', 'unknown'),
    /Unknown PUBLIC_API_PROFILE/,
  );

  for (const action of policy.publicProfiles['public-read']) {
    assert.match(action, /\.(find|findOne)$/);
  }
});

test('public action helpers replace existing grants', () => {
  const permissions = {
    api: {
      controllers: {
        work: {
          find: { enabled: true, policy: 'old' },
          create: { enabled: true, policy: 'old' },
        },
      },
    },
  };

  disableAllPublicActions(permissions);
  enablePublicAction(permissions, 'api.work.find');

  assert.deepEqual(permissions.api.controllers.work.find, {
    enabled: true,
    policy: '',
  });
  assert.deepEqual(permissions.api.controllers.work.create, {
    enabled: false,
    policy: '',
  });
  assert.throws(
    () => enablePublicAction(permissions, 'api.work.missing'),
    /not registered/,
  );
});

test('permission synchronization is idempotent through Strapi services', async () => {
  const adminRoleRows = [];
  const assigned = new Map();
  const publicPermissions = {
    api: {
      controllers: {
        work: {
          find: { enabled: false, policy: '' },
          findOne: { enabled: false, policy: '' },
        },
      },
    },
  };
  const publicRoleService = {
    async findOne() {
      return { permissions: publicPermissions };
    },
    async updateRole(id, data) {
      assigned.set(`public-${id}`, data.permissions);
    },
  };
  const adminRoleService = {
    async findOne(where) {
      return adminRoleRows.find((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value),
      );
    },
    async create(data) {
      const row = { id: adminRoleRows.length + 10, ...data };
      adminRoleRows.push(row);
      return row;
    },
    async update({ id }, data) {
      const row = adminRoleRows.find((candidate) => candidate.id === id);
      Object.assign(row, data);
      return row;
    },
    async assignPermissions(id, permissions) {
      assigned.set(id, permissions);
    },
  };
  const strapi = {
    service(name) {
      assert.equal(name, 'admin::role');
      return adminRoleService;
    },
    plugin(name) {
      assert.equal(name, 'users-permissions');
      return {
        service(serviceName) {
          assert.equal(serviceName, 'role');
          return publicRoleService;
        },
      };
    },
    db: {
      query(uid) {
        assert.equal(uid, 'plugin::users-permissions.role');
        return {
          async findOne() {
            return { id: 2, name: 'Public', description: 'Public role' };
          },
        };
      },
    },
  };

  const limitedPolicy = policy.publicProfiles['public-read'];
  policy.publicProfiles['public-read'] = [
    'api.work.find',
    'api.work.findOne',
  ];
  try {
    const first = await synchronizePermissions(strapi, {
      environment: 'production',
    });
    const second = await synchronizePermissions(strapi, {
      environment: 'production',
    });

    assert.equal(first.roles.every((item) => item.status === 'created'), true);
    assert.equal(second.roles.every((item) => item.status === 'updated'), true);
    assert.equal(adminRoleRows.length, 3);
    assert.equal(assigned.get('public-2'), publicPermissions);
  } finally {
    policy.publicProfiles['public-read'] = limitedPolicy;
  }
});

test('migration reports public drift without changing permissions', async (context) => {
  const knex = createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  context.after(() => knex.destroy());

  await knex.schema.createTable('admin_roles', (table) => {
    table.increments('id');
    table.string('name');
    table.string('code');
  });
  await knex.schema.createTable('up_roles', (table) => {
    table.increments('id');
    table.string('type');
  });
  await knex.schema.createTable('up_permissions', (table) => {
    table.increments('id');
    table.string('action');
  });
  await knex.schema.createTable('up_permissions_role_lnk', (table) => {
    table.integer('role_id');
    table.integer('permission_id');
  });

  const [publicRoleId] = await knex('up_roles').insert({ type: 'public' });
  const [permissionId] = await knex('up_permissions').insert({
    action: 'api::work.work.create',
  });
  await knex('up_permissions_role_lnk').insert({
    role_id: publicRoleId,
    permission_id: permissionId,
  });

  const previousProfile = process.env.PUBLIC_API_PROFILE;
  process.env.PUBLIC_API_PROFILE = 'none';
  try {
    const report = await migration.up(knex);
    assert.equal(report.profile, 'none');
    assert.deepEqual(report.publicPermissions.extra, [
      'api::work.work.create',
    ]);
  } finally {
    if (previousProfile === undefined) delete process.env.PUBLIC_API_PROFILE;
    else process.env.PUBLIC_API_PROFILE = previousProfile;
  }

  assert.equal(
    await knex('up_permissions')
      .count({ count: '*' })
      .first()
      .then((row) => Number(row.count)),
    1,
  );
});
