const fs = require("fs");
const path = require("path");

const INPUT_FILE = process.env.ETL_INPUT_FILE || path.join(__dirname, "airtable_dump.json");
const FIELD_MAPPING_FILE =
  process.env.ETL_FIELD_MAPPING_FILE || path.join(__dirname, "field-mapping.json");
const OUTPUT_FILE =
  process.env.ETL_FIELD_AUDIT_FILE ||
  path.join(__dirname, "intermediate", "field-coverage.json");

const VALID_STATUSES = new Set(["mapped", "planned", "ignored"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function main() {
  const records = readJson(INPUT_FILE);
  const mapping = readJson(FIELD_MAPPING_FILE);
  const configuredFields = mapping.fields || {};
  const observedFields = Array.from(
    new Set(records.flatMap((record) => Object.keys(record.fields || {}))),
  ).sort();

  const invalid = Object.entries(configuredFields)
    .filter(([, config]) => !VALID_STATUSES.has(config.status))
    .map(([field, config]) => ({ field, status: config.status }));
  const unmapped = observedFields.filter((field) => !configuredFields[field]);
  const configuredButUnobserved = Object.keys(configuredFields)
    .filter((field) => !observedFields.includes(field))
    .sort();
  const fields = observedFields
    .filter((field) => configuredFields[field])
    .map((field) => ({
      sourceField: field,
      populatedRecords: records.filter((record) => hasValue((record.fields || {})[field])).length,
      ...configuredFields[field],
    }));
  const counts = fields.reduce(
    (memo, field) => {
      memo[field.status] += 1;
      return memo;
    },
    { mapped: 0, planned: 0, ignored: 0 },
  );

  const report = {
    generatedAt: new Date().toISOString(),
    sourceRecordCount: records.length,
    observedFieldCount: observedFields.length,
    counts,
    unmapped,
    invalid,
    configuredButUnobserved,
    fields,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Wrote field mapping audit to ${OUTPUT_FILE}`);
  console.log(JSON.stringify({ ...counts, unmapped: unmapped.length, invalid: invalid.length }, null, 2));

  if (unmapped.length > 0 || invalid.length > 0) process.exitCode = 1;
}

main();
