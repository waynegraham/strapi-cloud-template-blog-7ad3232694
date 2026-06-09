'use strict';

const { compileStrapi, createStrapi } = require('@strapi/strapi');
const {
  adminRoles,
  publicProfileForEnvironment,
  publicProfiles,
} = require('../config/editorial-permissions');
const { synchronizePermissions } = require('../src/permissions');

const apply = process.argv.includes('--apply');
const environment = process.env.NODE_ENV || 'development';
const publicProfile = publicProfileForEnvironment(
  environment,
  process.env.PUBLIC_API_PROFILE,
);

async function main() {
  if (!apply) {
    console.log(`Environment: ${environment}`);
    console.log(`Public API profile: ${publicProfile}`);
    console.log(`Public actions: ${publicProfiles[publicProfile].length}`);
    for (const role of adminRoles) {
      console.log(`${role.name}: ${role.permissions.length} permissions`);
    }
    console.log('\nDry run only. Re-run with --apply to synchronize the database.');
    return;
  }

  const context = await compileStrapi();
  const app = await createStrapi(context).load();

  try {
    const report = await synchronizePermissions(app, {
      environment,
      publicProfile,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
