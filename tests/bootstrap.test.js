'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const app = require('../src');

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) return javascriptFiles(filePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [filePath] : [];
  });
}

test('application bootstrap only synchronizes Content Manager configuration', async () => {
  const writes = [];
  const values = new Map();
  const strapi = {
    store(options) {
      assert.deepEqual(options, {
        type: 'plugin',
        name: 'content_manager',
      });
      return {
        async get({ key }) {
          return values.get(key);
        },
        async set({ key, value }) {
          values.set(key, value);
          writes.push(key);
        },
      };
    },
  };

  await app.bootstrap({ strapi });
  assert.ok(writes.length > 0);
  assert.ok(
    writes.every((key) => key.startsWith('configuration_')),
  );
});

test('runtime code does not reference obsolete blog APIs or permission seeding', () => {
  const runtimeFiles = [
    ...javascriptFiles(path.join(projectRoot, 'src')),
    ...javascriptFiles(path.join(projectRoot, 'scripts')),
  ];
  const forbiddenPatterns = [
    /api::(?:article|author|category)\./,
    /(?:articles|authors|categories)\s*[,}]/,
    /users-permissions\.permission/,
    /setPublicPermissions/,
    /seedExampleApp/,
    /initHasRun/,
  ];

  for (const filePath of runtimeFiles) {
    const source = fs.readFileSync(filePath, 'utf8');

    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.relative(projectRoot, filePath)} contains obsolete bootstrap code`,
      );
    }
  }
});

test('package scripts do not expose the obsolete example seeder', () => {
  const packageJson = require('../package.json');

  assert.equal(packageJson.scripts['seed:example'], undefined);
});
