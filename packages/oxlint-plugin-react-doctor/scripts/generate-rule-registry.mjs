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
  preact: "preact",
  "react-native": "react-native",
  "tanstack-query": "tanstack-query",
  "tanstack-start": "tanstack-start",
};

// Bucket directory → behavioral tags merged onto every rule in that
// bucket at registry-build time. Lets cross-cutting controls
// (`severity.tags`, `surfaces.*.excludeTags`,
// `config.ignore.tags`) target whole rule families without each rule
// needing to repeat the tag in its `defineRule({...})` call. Rule-
// authored tags layer on top (deduped at runtime), so a rule can both
// inherit a bucket tag and carry its own.
const BUCKET_TO_AUTO_TAGS = {
  "react-native": ["react-native"],
  server: ["server-action"],
};

// Buckets containing rules ported from external upstream linters
// (OXC's `react/*` plugin and `jsx-a11y/*` plugin). Even though these
// rules now ship inside `react-doctor`, semantically they ARE the
// previously-external rules — users opting into `customRulesOnly`
// (which skips third-party rule sets to keep diagnostics narrow to
// react-doctor's distinctive checks) should still not receive them.
// `originallyExternal: true` flows through the registry into the
// oxlint-config builder so `customRulesOnly` can filter them out.
const BUCKETS_PORTED_FROM_EXTERNAL = new Set(["react-builtins", "a11y"]);
const EFFECT_RULES_PORTED_FROM_EXTERNAL = new Set([
  "no-derived-state",
  "no-chain-state-updates",
  "no-event-handler",
  "no-adjust-state-on-prop-change",
  "no-reset-all-state-on-prop-change",
  "no-pass-live-state-to-parent",
  "no-pass-data-to-parent",
  "no-initialize-state",
]);
// Rules that LIVE in an externally-ported bucket (e.g. `a11y/`) but were
// authored in-house — they're semantically distinct from the upstream
// jsx-a11y / react/* rule sets and should NOT be filtered out by
// `customRulesOnly`. Without this list every new in-house rule we drop
// into `a11y/` would silently disappear for users who narrow scope.
const RULES_NOT_PORTED_FROM_EXTERNAL = new Set(["prefer-html-dialog"]);

// Rule ids whose source files are kept on disk but intentionally NOT
// registered. Use sparingly — the canonical way to retire a rule is to
// delete its file (and its tests, fixture references, etc.). This
// skiplist exists for rules we want to stop shipping right away while
// preserving their implementation, tests, and regression fixtures so
// re-enabling is a one-line change. Add a brief justification next to
// every entry.
const RULE_IDS_TO_SKIP_REGISTRATION = new Set([
  // The React-Compiler memoization premise didn't hold: the three
  // canonical hooks it targeted (`useRouter`, `useSearchParams`,
  // `useNavigation`) all return stable references, so destructuring
  // their methods produces no measurable compiler win — and on Pages
  // Router (`next/router`) destructuring `push` captures a stale
  // reference. Implementation + regression suite + fixture lines kept
  // in place; remove this entry to re-enable.
  "react-compiler-destructure-method",
]);

// Bucket directory → default category. A rule MAY override its category
// with an explicit `category: "..."` field in its `defineRule({...})` call
// (e.g. some `tanstack-start/` and `nextjs/` rules override to "Security").
const BUCKET_TO_DEFAULT_CATEGORY = {
  a11y: "Accessibility",
  architecture: "Architecture",
  "bundle-size": "Bundle Size",
  client: "Performance",
  correctness: "Correctness",
  design: "Architecture",
  "js-performance": "Performance",
  jotai: "State & Effects",
  nextjs: "Next.js",
  performance: "Performance",
  preact: "Preact",
  "react-builtins": "Correctness",
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
    const severityMatch = source.match(/^\s*severity:\s*"(error|warn)",?\s*$/m);
    if (!severityMatch) {
      console.error(
        `Rule file missing \`severity: "error" | "warn"\` field: ${path.relative(PACKAGE_ROOT, filePath)}`,
      );
      process.exit(1);
    }
    const ruleId = idMatch[1];
    if (RULE_IDS_TO_SKIP_REGISTRATION.has(ruleId)) continue;
    const category = categoryMatch ? categoryMatch[1] : defaultCategory;
    const severity = severityMatch[1];
    // Force POSIX separators — `path.relative()` returns backslashes on
    // Windows, which TypeScript module resolution rejects.
    const relativeImport =
      "./" +
      path
        .relative(path.dirname(REGISTRY_OUTPUT), filePath)
        .replaceAll(path.sep, "/")
        .replace(/\.ts$/, ".js");
    const autoTags = BUCKET_TO_AUTO_TAGS[bucket.name] ?? [];
    const originallyExternal =
      !RULES_NOT_PORTED_FROM_EXTERNAL.has(ruleId) &&
      (BUCKETS_PORTED_FROM_EXTERNAL.has(bucket.name) ||
        EFFECT_RULES_PORTED_FROM_EXTERNAL.has(ruleId));
    ruleEntries.push({
      ruleId,
      identifier,
      relativeImport,
      framework,
      category,
      severity,
      autoTags,
      originallyExternal,
    });
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
const formatAutoTagsLine = (entry) => {
  if (entry.autoTags.length === 0) return "";
  // Merge bucket-derived auto-tags with rule-authored tags at runtime,
  // deduped so a rule that explicitly repeats the bucket tag doesn't
  // end up with `["react-native", "react-native"]`. The `[...new Set(...)]`
  // form keeps every emitted line under prettier's 100-char limit (the
  // longest rule identifier in the project still fits comfortably) so
  // we don't have to mirror prettier's wrap decision at codegen time
  // — `gen:check` stays idempotent.
  const autoTagLiteral = entry.autoTags.map((tag) => `"${tag}"`).join(", ");
  return `      tags: [...new Set([${autoTagLiteral}, ...(${entry.identifier}.tags ?? [])])],\n`;
};

// Per-entry shape:
//   { key, id, source, originallyExternal, rule: { ...sourceRule, framework, category, tags? } }
//
// `framework` / `category` / `severity` live on the inner `rule` object
// (set by the spread + codegen merge) — consumers that need them read
// `entry.rule.framework` / `.category` / `.severity` so we don't ship
// the same value twice per entry. Saves ~3 lines × N rules on the
// generated file and on the published bundle.
const ruleLines = ruleEntries
  .map(
    (entry) =>
      `  {\n` +
      `    key: "react-doctor/${entry.ruleId}",\n` +
      `    id: "${entry.ruleId}",\n` +
      `    source: "react-doctor",\n` +
      `    originallyExternal: ${entry.originallyExternal},\n` +
      `    rule: {\n` +
      `      ...${entry.identifier},\n` +
      `      framework: "${entry.framework}",\n` +
      `      category: "${entry.category}",\n` +
      formatAutoTagsLine(entry) +
      `    },\n` +
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

export const reactDoctorRules = [
${ruleLines}
] as const;

export const ruleRegistry: Record<string, Rule> = Object.fromEntries(
  reactDoctorRules.map((rule) => [rule.id, rule.rule]),
);
`;

fs.writeFileSync(REGISTRY_OUTPUT, generatedSource);
console.log(`Wrote ${path.relative(PACKAGE_ROOT, REGISTRY_OUTPUT)} (${ruleEntries.length} rules)`);
