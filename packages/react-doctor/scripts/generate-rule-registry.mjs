#!/usr/bin/env node
// Generates `src/plugin/rule-registry.ts` by scanning every per-rule file
// under `src/plugin/rules/<bucket>/<rule>.ts` for its
//   export const <identifier> = defineRule<Rule>({ id: "<rule-id>", ... })
// declaration. Each rule registers itself via its own `id` field, so this
// script never has to know about naming conventions or filename mapping.
//
// Output is committed to git so consumers don't need to run codegen, but
// `pnpm gen` re-runs whenever a rule is added / removed / renamed. The
// generated file is the only thing `react-doctor-plugin.ts` imports.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const PLUGIN_RULES_ROOT = path.join(PACKAGE_ROOT, "src/plugin/rules");
const REGISTRY_OUTPUT = path.join(PACKAGE_ROOT, "src/plugin/rule-registry.ts");

const collectPerRuleFiles = (rootDirectory) => {
  const found = [];
  for (const bucket of fs.readdirSync(rootDirectory, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const bucketDir = path.join(rootDirectory, bucket.name);
    for (const entry of fs.readdirSync(bucketDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        found.push(path.join(bucketDir, entry.name));
      }
    }
  }
  return found;
};

const ruleEntries = [];
for (const filePath of collectPerRuleFiles(PLUGIN_RULES_ROOT)) {
  const source = fs.readFileSync(filePath, "utf8");
  const exportMatch = source.match(
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*defineRule\s*<[^>]+>\s*\(\s*\{/,
  );
  if (!exportMatch) continue;
  const identifier = exportMatch[1];
  // Match `id: "<rule-id>"` anywhere in the file body — it must be the
  // first non-whitespace property inside the defineRule call per
  // codegen contract, but the file may contain unrelated `id:` matches
  // (e.g. JSX `id="..."` examples) so we anchor to the line that
  // starts with whitespace + id:.
  const idMatch = source.match(/^\s*id:\s*"([^"]+)",?\s*$/m);
  if (!idMatch) {
    console.error(
      `Rule file missing \`id: "..."\` field: ${path.relative(PACKAGE_ROOT, filePath)}`,
    );
    process.exit(1);
  }
  const ruleId = idMatch[1];
  // Force POSIX separators — `path.relative()` returns backslashes on
  // Windows, which TypeScript module resolution rejects.
  const relativeImport =
    "./" +
    path
      .relative(path.dirname(REGISTRY_OUTPUT), filePath)
      .replaceAll(path.sep, "/")
      .replace(/\.ts$/, ".js");
  ruleEntries.push({ ruleId, identifier, relativeImport });
}

ruleEntries.sort((entryA, entryB) => entryA.ruleId.localeCompare(entryB.ruleId));

const seenRuleIds = new Set();
for (const entry of ruleEntries) {
  if (seenRuleIds.has(entry.ruleId)) {
    console.error(`Duplicate rule id: "${entry.ruleId}" — every rule must register a unique id`);
    process.exit(1);
  }
  seenRuleIds.add(entry.ruleId);
}

const importLines = ruleEntries
  .map((entry) => `import { ${entry.identifier} } from "${entry.relativeImport}";`)
  .join("\n");
const registryLines = ruleEntries
  .map((entry) => `  "${entry.ruleId}": ${entry.identifier},`)
  .join("\n");

const generatedSource = `// GENERATED FILE — do not edit by hand. Run \`pnpm gen\` to regenerate.
// Source of truth: every \`export const <name> = defineRule({ id: "...", ... })\`
// under \`src/plugin/rules/<bucket>/<name>.ts\`. Adding a rule is a single-file
// operation: create the rule file, set its \`id\`, re-run codegen.

import type { Rule } from "./utils/rule.js";

${importLines}

export const ruleRegistry: Record<string, Rule> = {
${registryLines}
};
`;

fs.writeFileSync(REGISTRY_OUTPUT, generatedSource);
console.log(`Wrote ${path.relative(PACKAGE_ROOT, REGISTRY_OUTPUT)} (${ruleEntries.length} rules)`);
