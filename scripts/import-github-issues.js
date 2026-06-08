"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_SOURCE = path.join(
  process.cwd(),
  "docs",
  "github-issues-strapi-content-model.md",
);
const DEFAULT_REPOSITORY =
  "waynegraham/strapi-cloud-template-blog-7ad3232694";

const APPLY = process.argv.includes("--apply");
const SOURCE_FILE =
  valueAfter("--source") || process.env.GITHUB_ISSUES_SOURCE || DEFAULT_SOURCE;
const REPOSITORY =
  valueAfter("--repo") || process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function runGh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error && result.error.code === "ENOENT") {
    throw new Error(
      "GitHub CLI is not installed. Install it with `brew install gh`, then run `gh auth login`.",
    );
  }

  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `gh ${args.join(" ")} failed`);
  }

  return result;
}

function parseSections(markdown) {
  const headingPattern = /^# (Epic|Issue): (.+)$/gm;
  const matches = Array.from(markdown.matchAll(headingPattern));

  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1] ? matches[index + 1].index : markdown.length;

    return {
      type: match[1].toLowerCase(),
      title: match[2].trim(),
      body: markdown.slice(start, end).trim(),
    };
  });
}

function listExistingIssues() {
  const result = runGh([
    "issue",
    "list",
    "--repo",
    REPOSITORY,
    "--state",
    "all",
    "--limit",
    "500",
    "--json",
    "number,title,url",
  ]);

  return JSON.parse(result.stdout);
}

function createIssueWithBody(section) {
  const result = spawnSync(
    "gh",
    [
      "issue",
      "create",
      "--repo",
      REPOSITORY,
      "--title",
      section.title,
      "--body-file",
      "-",
    ],
    {
      encoding: "utf8",
      input: `${section.body}\n`,
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Failed to create "${section.title}"`);
  }

  return result.stdout.trim();
}

function linkEpicChildren(epic, childIssues) {
  const lines = epic.body.split("\n");

  return lines
    .map((line) => {
      const match = line.match(/^- \[ \] (.+)$/);
      if (!match) return line;

      const child = childIssues.find(
        (issue) => issue.title.toLowerCase() === match[1].toLowerCase(),
      );
      return child
        ? `- [ ] #${child.number} ${child.title}`
        : line;
    })
    .join("\n");
}

function issueNumberFromUrl(url) {
  const match = url.match(/\/issues\/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Issue source file not found: ${SOURCE_FILE}`);
  }

  const sections = parseSections(fs.readFileSync(SOURCE_FILE, "utf8"));
  const epic = sections.find((section) => section.type === "epic");
  const children = sections.filter((section) => section.type === "issue");

  if (!epic || children.length === 0) {
    throw new Error("Expected one Epic and at least one Issue section.");
  }

  console.log(
    `${APPLY ? "Creating" : "Dry run for"} ${children.length} child issues and 1 epic in ${REPOSITORY}`,
  );

  if (!APPLY) {
    for (const child of children) console.log(`[dry-run] ${child.title}`);
    console.log(`[dry-run, created last] ${epic.title}`);
    console.log("\nRun with `npm run github:issues:apply` to create them.");
    return;
  }

  runGh(["auth", "status"]);
  const existingByTitle = new Map(
    listExistingIssues().map((issue) => [issue.title.toLowerCase(), issue]),
  );
  const createdOrExistingChildren = [];

  for (const child of children) {
    const existing = existingByTitle.get(child.title.toLowerCase());
    if (existing) {
      console.log(`[existing] #${existing.number} ${child.title}`);
      createdOrExistingChildren.push(existing);
      continue;
    }

    const url = createIssueWithBody(child);
    const issue = {
      number: issueNumberFromUrl(url),
      title: child.title,
      url,
    };
    console.log(`[created] #${issue.number} ${child.title}`);
    createdOrExistingChildren.push(issue);
  }

  const existingEpic = existingByTitle.get(epic.title.toLowerCase());
  if (existingEpic) {
    console.log(`[existing] #${existingEpic.number} ${epic.title}`);
    console.log("Epic body was not modified.");
    return;
  }

  const epicUrl = createIssueWithBody({
    ...epic,
    body: linkEpicChildren(epic, createdOrExistingChildren),
  });
  console.log(`[created] #${issueNumberFromUrl(epicUrl)} ${epic.title}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
