#!/usr/bin/env node
// Generates `src/plugin/rule-registry.ts` by scanning every per-rule file
// under `src/plugin/rules/<bucket>/<rule>.ts` for its
//   export const <identifier> = defineRule<Rule>({ id: "<rule-id>", ... })
// declaration. The bucket directory determines the rule's `framework` and
// its default `category`; the rule file may override the category with an
// explicit field. `framework` is never on the rule itself.
//
// Output is committed to git so consumers don't need to run codegen.
// `pnpm gen` re-runs whenever a rule is added / removed / renamed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const PLUGIN_RULES_ROOT = path.join(PACKAGE_ROOT, "src/plugin/rules");
const REGISTRY_OUTPUT = path.join(PACKAGE_ROOT, "src/plugin/rule-registry.ts");

// Bucket directory → framework (each rule's `framework` field is derived,
// never authored). Buckets not listed here default to "global".
const BUCKET_TO_FRAMEWORK = {
  nextjs: "nextjs",
  "react-native": "react-native",
  "tanstack-start": "tanstack-start",
  "tanstack-query": "tanstack-query",
};

// Bucket directory → default category. A rule MAY override its category
// with an explicit `category: "..."` field in its `defineRule({...})` call
// (e.g. some `tanstack-start/` and `nextjs/` rules override to "Security").
const BUCKET_TO_DEFAULT_CATEGORY = {
  architecture: "Architecture",
  "bundle-size": "Bundle Size",
  client: "Performance",
  correctness: "Correctness",
  design: "Architecture",
  "js-performance": "Performance",
  nextjs: "Next.js",
  performance: "Performance",
  "react-native": "React Native",
  "react-ui": "Accessibility",
  security: "Security",
  server: "Server",
  "state-and-effects": "State & Effects",
  "tanstack-query": "TanStack Query",
  "tanstack-start": "TanStack Start",
  "view-transitions": "Correctness",
};

const ruleEntries = [];
for (const bucket of fs.readdirSync(PLUGIN_RULES_ROOT, { withFileTypes: true })) {
  if (!bucket.isDirectory()) continue;
  const bucketDir = path.join(PLUGIN_RULES_ROOT, bucket.name);
  const framework = BUCKET_TO_FRAMEWORK[bucket.name] ?? "global";
  const defaultCategory = BUCKET_TO_DEFAULT_CATEGORY[bucket.name];
  if (!defaultCategory) {
    console.error(
      `Unknown bucket "${bucket.name}" — add it to BUCKET_TO_DEFAULT_CATEGORY in scripts/generate-rule-registry.mjs`,
    );
    process.exit(1);
  }
  for (const entry of fs.readdirSync(bucketDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const filePath = path.join(bucketDir, entry.name);
    const source = fs.readFileSync(filePath, "utf8");
    const exportMatch = source.match(
      /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*defineRule\s*<[^>]+>\s*\(\s*\{/,
    );
    if (!exportMatch) continue;
    const identifier = exportMatch[1];
    const idMatch = source.match(/^\s*id:\s*"([^"]+)",?\s*$/m);
    if (!idMatch) {
      console.error(
        `Rule file missing \`id: "..."\` field: ${path.relative(PACKAGE_ROOT, filePath)}`,
      );
      process.exit(1);
    }
    const categoryMatch = source.match(/^\s*category:\s*"([^"]+)",?\s*$/m);
    const ruleId = idMatch[1];
    const category = categoryMatch ? categoryMatch[1] : defaultCategory;
    // Force POSIX separators — `path.relative()` returns backslashes on
    // Windows, which TypeScript module resolution rejects.
    const relativeImport =
      "./" +
      path
        .relative(path.dirname(REGISTRY_OUTPUT), filePath)
        .replaceAll(path.sep, "/")
        .replace(/\.ts$/, ".js");
    ruleEntries.push({ ruleId, identifier, relativeImport, framework, category });
  }
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
// Pre-format each entry across multiple lines so prettier's `format:check`
// has nothing to rewrite. Single-line entries would be reformatted when
// they exceed the 100-char default width, and the registry-overwrite-on-
// codegen contract would loop forever.
const registryLines = ruleEntries
  .map(
    (entry) =>
      `  "${entry.ruleId}": {\n` +
      `    ...${entry.identifier},\n` +
      `    framework: "${entry.framework}",\n` +
      `    category: "${entry.category}",\n` +
      `  },`,
  )
  .join("\n");

const generatedSource = `// GENERATED FILE — do not edit by hand. Run \`pnpm gen\` to regenerate.
// Source of truth: every \`export const <name> = defineRule({ id: "...", ... })\`
// under \`src/plugin/rules/<bucket>/<name>.ts\`. The rule's \`framework\` and
// default \`category\` come from the bucket directory (see
// \`scripts/generate-rule-registry.mjs\`) — rule files only override
// \`category\` when needed. Adding a rule is a single-file operation:
// create the rule file, set its \`id\`, re-run codegen.

import type { Rule } from "./utils/rule.js";

${importLines}

export const ruleRegistry: Record<string, Rule> = {
${registryLines}
};
`;

fs.writeFileSync(REGISTRY_OUTPUT, generatedSource);
console.log(`Wrote ${path.relative(PACKAGE_ROOT, REGISTRY_OUTPUT)} (${ruleEntries.length} rules)`);
