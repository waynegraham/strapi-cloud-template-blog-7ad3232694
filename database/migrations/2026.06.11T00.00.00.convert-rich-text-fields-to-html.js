'use strict';

const AGENT_TABLE = 'agents';
const INSCRIPTION_TABLE = 'components_shared_inscriptions';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTextNode(node = {}) {
  let html = escapeHtml(node.text || '').replace(/\n/g, '<br>');
  if (node.code) html = `<code>${html}</code>`;
  if (node.bold) html = `<strong>${html}</strong>`;
  if (node.italic) html = `<em>${html}</em>`;
  if (node.underline) html = `<u>${html}</u>`;
  if (node.strikethrough) html = `<s>${html}</s>`;
  return html;
}

function renderChildren(children = []) {
  return children
    .map((child) => {
      if (child.type === 'link') {
        const href = escapeHtml(child.url || '');
        return `<a href="${href}">${renderChildren(child.children)}</a>`;
      }
      return renderTextNode(child);
    })
    .join('');
}

function blockToHtml(block = {}) {
  const children = renderChildren(block.children);
  if (block.type === 'heading') {
    const level = Math.min(Math.max(Number(block.level) || 2, 1), 6);
    return `<h${level}>${children}</h${level}>`;
  }
  if (block.type === 'quote') return `<blockquote>${children}</blockquote>`;
  if (block.type === 'code') return `<pre><code>${children}</code></pre>`;
  if (block.type === 'list') {
    const tag = block.format === 'ordered' ? 'ol' : 'ul';
    const items = (block.children || [])
      .map((item) => `<li>${renderChildren(item.children)}</li>`)
      .join('');
    return `<${tag}>${items}</${tag}>`;
  }
  return `<p>${children}</p>`;
}

function blocksToHtml(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && value.trim().startsWith('<')) return value;

  let blocks = value;
  if (typeof blocks === 'string') {
    try {
      blocks = JSON.parse(blocks);
    } catch {
      return `<p>${escapeHtml(blocks)}</p>`;
    }
  }

  if (!Array.isArray(blocks)) {
    throw new Error('Cannot convert Agent biography to HTML: expected Blocks JSON.');
  }
  return blocks.map(blockToHtml).join('\n');
}

async function convertAgentColumn(knex, columnName) {
  const columns = await knex(AGENT_TABLE).columnInfo();
  if (!columns[columnName]) return;

  const rows = await knex(AGENT_TABLE).select('id', columnName);
  if (columns[columnName].type === 'text') {
    for (const row of rows) {
      const converted = blocksToHtml(row[columnName]);
      if (converted === row[columnName]) continue;
      await knex(AGENT_TABLE)
        .where({ id: row.id })
        .update({ [columnName]: converted });
    }
    return;
  }

  const temporaryColumn = `${columnName}_html`;
  if (!columns[temporaryColumn]) {
    await knex.schema.alterTable(AGENT_TABLE, (table) => {
      table.text(temporaryColumn);
    });
  }

  for (const row of rows) {
    await knex(AGENT_TABLE)
      .where({ id: row.id })
      .update({ [temporaryColumn]: blocksToHtml(row[columnName]) });
  }

  await knex.schema.alterTable(AGENT_TABLE, (table) => {
    table.dropColumn(columnName);
  });
  await knex.schema.alterTable(AGENT_TABLE, (table) => {
    table.renameColumn(temporaryColumn, columnName);
  });
}

module.exports = {
  blocksToHtml,
  async up(knex) {
    if (await knex.schema.hasTable(AGENT_TABLE)) {
      await convertAgentColumn(knex, 'biography_en');
      await convertAgentColumn(knex, 'biography_ar');
    }

    if (await knex.schema.hasTable(INSCRIPTION_TABLE)) {
      const columns = await knex(INSCRIPTION_TABLE).columnInfo();
      for (const columnName of ['text', 'translation']) {
        if (!columns[columnName] || columns[columnName].type === 'text') continue;
        await knex.schema.alterTable(INSCRIPTION_TABLE, (table) => {
          table.text(columnName).alter();
        });
      }
    }
  },
};
