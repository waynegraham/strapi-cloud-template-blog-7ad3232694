require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs = require("fs");
const path = require("path");

const PRODUCTION_STRAPI_API_URL = process.env.PRODUCTION_STRAPI_API_URL;
const PRODUCTION_STRAPI_API_TOKEN = process.env.PRODUCTION_STRAPI_API_TOKEN;
const INPUT_DIR = process.env.ETL_OUTPUT_DIR || path.join(__dirname, "intermediate");

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

const CONTENT_TYPES = {
  "agent-role": { endpoint: "agent-roles", matchField: "label_en" },
  agent: { endpoint: "agents", matchField: "nameEn" },
  gallery: { endpoint: "galleries", matchField: "nameEn" },
  material: { endpoint: "materials", matchField: "nameEn" },
};

function usage() {
  console.log(`Usage:
  node load-production-reference-data.js          # dry run
  node load-production-reference-data.js --apply  # write to production

Required env:
  PRODUCTION_STRAPI_API_URL
  PRODUCTION_STRAPI_API_TOKEN`);
}

function requireEnv() {
  if (!PRODUCTION_STRAPI_API_URL || !PRODUCTION_STRAPI_API_TOKEN) {
    usage();
    throw new Error("Missing PRODUCTION_STRAPI_API_URL or PRODUCTION_STRAPI_API_TOKEN");
  }
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(INPUT_DIR, `${name}.json`), "utf8"));
}

function baseUrl() {
  return PRODUCTION_STRAPI_API_URL.replace(/\/$/, "");
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== ""),
  );
}

function appendFilter(searchParams, field, operator, value) {
  searchParams.set(`filters[${field}][${operator}]`, value);
}

async function strapiRequest(method, endpoint, { documentId, data, query } = {}) {
  const url = new URL(`${baseUrl()}/api/${endpoint}${documentId ? `/${documentId}` : ""}`);
  url.searchParams.set("status", "published");

  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PRODUCTION_STRAPI_API_TOKEN}`,
    },
    body: data ? JSON.stringify({ data }) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${method} ${url.pathname} failed: ${response.status} ${errorBody}`);
  }

  return response.json();
}

async function findByField(endpoint, field, value, { populate } = {}) {
  const url = new URL(`${baseUrl()}/api/${endpoint}`);
  url.searchParams.set("status", "draft");
  url.searchParams.set("pagination[pageSize]", "100");
  appendFilter(url.searchParams, field, "$eq", value);
  if (populate) url.searchParams.set("populate", populate);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${PRODUCTION_STRAPI_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GET ${url.pathname} failed: ${response.status} ${errorBody}`);
  }

  const json = await response.json();
  return json.data || [];
}

function documentIdOf(entry) {
  return entry && entry.documentId;
}

function relationDocumentId(entry, relationName) {
  const relation = entry && entry[relationName];
  if (!relation) return undefined;
  if (relation.documentId) return relation.documentId;
  if (relation.data && relation.data.documentId) return relation.data.documentId;
  return undefined;
}

async function upsertRecord(record, field, value, data, stats) {
  const typeConfig = CONTENT_TYPES[record.content_type];
  const endpoint = typeConfig.endpoint;

  const existing = await findByField(endpoint, field, value);
  const existingEntry = existing[0];

  if (DRY_RUN) {
    stats[existingEntry ? "update" : "create"] += 1;
    console.log(
      `[dry-run] ${existingEntry ? "update" : "create"} ${record.content_type} ${record.key} by ${field}="${value}"`,
    );
    return {
      key: record.key,
      content_type: record.content_type,
      endpoint,
      documentId: existingEntry ? documentIdOf(existingEntry) : `dry-run:${record.key}`,
      existing: Boolean(existingEntry),
    };
  }

  if (existingEntry) {
    const documentId = documentIdOf(existingEntry);
    const json = await strapiRequest("PUT", endpoint, { documentId, data });
    stats.update += 1;
    return { key: record.key, content_type: record.content_type, endpoint, documentId: documentIdOf(json.data) };
  }

  const json = await strapiRequest("POST", endpoint, { data });
  stats.create += 1;
  return { key: record.key, content_type: record.content_type, endpoint, documentId: documentIdOf(json.data) };
}

async function upsertAgentRole(record, agentIndex, roleIndex, stats) {
  const data = stripUndefined(record.request.body.data);
  const agentRef = record.relations && record.relations.agent;
  const agent = agentRef && agentIndex.get(agentRef.key);
  const roleLabel = data.label_en;

  let existingEntry;
  if (agent) {
    const candidates = await findByField("agent-roles", "label_en", roleLabel, { populate: "agent" });
    existingEntry = candidates.find((candidate) => relationDocumentId(candidate, "agent") === agent.documentId);
  }

  if (DRY_RUN) {
    stats[existingEntry ? "update" : "create"] += 1;
    console.log(
      `[dry-run] ${existingEntry ? "update" : "create"} agent-role ${record.key} by label_en="${roleLabel}" + agent="${agentRef && agentRef.key}"`,
    );
    const documentId = existingEntry ? documentIdOf(existingEntry) : `dry-run:${record.key}`;
    roleIndex.set(record.key, { ...record, documentId });
    return;
  }

  if (existingEntry) {
    const documentId = documentIdOf(existingEntry);
    const json = await strapiRequest("PUT", "agent-roles", { documentId, data });
    stats.update += 1;
    roleIndex.set(record.key, { ...record, documentId: documentIdOf(json.data) });
    return;
  }

  const json = await strapiRequest("POST", "agent-roles", { data });
  stats.create += 1;
  roleIndex.set(record.key, { ...record, documentId: documentIdOf(json.data) });
}

async function attachAgentRoles(roleRecords, agentIndex, roleIndex, stats) {
  for (const record of roleRecords) {
    const role = roleIndex.get(record.key);
    const agentRef = record.relations && record.relations.agent;
    const agent = agentRef && agentIndex.get(agentRef.key);

    if (!role || !agent) {
      stats.skip += 1;
      console.warn(`Skipping role attachment for ${record.key}; missing role or agent documentId`);
      continue;
    }

    if (DRY_RUN) {
      stats.relate += 1;
      console.log(`[dry-run] attach agent-role ${record.key} to agent ${agentRef.key}`);
      continue;
    }

    await strapiRequest("PUT", "agent-roles", {
      documentId: role.documentId,
      data: {
        agent: {
          connect: [agent.documentId],
        },
      },
    });
    stats.relate += 1;
  }
}

async function upsertSimpleRecords(records, stats) {
  const index = new Map();

  for (const record of records) {
    const config = CONTENT_TYPES[record.content_type];
    const data = stripUndefined(record.request.body.data);
    const value = data[config.matchField];

    if (!value) {
      stats.skip += 1;
      console.warn(`Skipping ${record.content_type} ${record.key}; missing ${config.matchField}`);
      continue;
    }

    const result = await upsertRecord(record, config.matchField, value, data, stats);
    index.set(record.key, result);
  }

  return index;
}

async function main() {
  requireEnv();

  const stats = {
    create: 0,
    update: 0,
    relate: 0,
    skip: 0,
  };

  const agentRoles = readJson("agent-roles");
  const agents = readJson("agents");
  const galleries = readJson("galleries");
  const materials = readJson("materials");

  console.log(`${DRY_RUN ? "Dry run" : "Applying"} production reference-data load to ${baseUrl()}`);
  console.log(
    `Input counts: ${agentRoles.length} agent roles, ${agents.length} agents, ${galleries.length} galleries, ${materials.length} materials`,
  );

  const existingAgentIndex = await upsertSimpleRecords([], stats);
  for (const agent of agents) {
    const name = compactWhitespace(agent.request.body.data.nameEn);
    const existing = await findByField("agents", "nameEn", name);
    if (existing[0]) {
      existingAgentIndex.set(agent.key, {
        key: agent.key,
        content_type: "agent",
        endpoint: "agents",
        documentId: documentIdOf(existing[0]),
        existing: true,
      });
    }
  }

  const roleIndex = new Map();
  for (const role of agentRoles) {
    await upsertAgentRole(role, existingAgentIndex, roleIndex, stats);
  }

  const agentIndex = await upsertSimpleRecords(agents, stats);
  await attachAgentRoles(agentRoles, agentIndex, roleIndex, stats);
  await upsertSimpleRecords(galleries, stats);
  await upsertSimpleRecords(materials, stats);

  console.log("Load summary:");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
