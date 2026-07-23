#!/usr/bin/env node
// Generates `src/plugin/rule-registry.ts` by scanning every per-rule file
// under `src/plugin/rules/<bucket>/<rule>.ts` for its single
//   export const <identifier> = defineRule({ id: "<rule-id>", ... })
//   export const <identifier> = defineRetiredRule({ id: "<rule-id>", ... })
// declaration (one rule file = one rule). The bucket directory determines
// the rule's `framework` and its default `category`; the rule file may
// override the category with an explicit field. `framework` is never on
// the rule itself.
//
// Output is committed to git so consumers don't need to run codegen.
// `pnpm gen` re-runs whenever a rule is added / removed / renamed.

import * as fs from "node:fs";
import * as path from "node:path";
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

// Bucket directories whose rules fundamentally need a React (or Preact)
// runtime — hooks, JSX, accessibility on JSX, render performance, React
// state. Every rule in these buckets gets a synthesized `"react"`
// capability requirement (merged with any rule-authored `requires`) so
// it stays off on a plain TypeScript / JavaScript project. Without this,
// hook/component-name heuristics (e.g. `rules-of-hooks` matching a local
// function named `useThing`) would false-fire on non-React code. Buckets
// left out here (security, architecture, correctness, bundle-size,
// js-performance, design, zod) are framework-agnostic and keep running
// without React. Framework-specific buckets (nextjs, react-native, …)
// are already gated by their own capability via `BUCKET_TO_FRAMEWORK`.
const BUCKETS_REQUIRING_REACT = new Set([
  "a11y",
  "client",
  "jotai",
  "performance",
  "react-builtins",
  "react-ui",
  "r3f",
  "state-and-effects",
  "valtio",
  "view-transitions",
]);

const BUCKET_TO_REQUIRED_CAPABILITIES = {
  r3f: ["react", "r3f"],
};

const THREE_RULE_IDS_REQUIRING_REACT = new Set([
  "three-no-object-construction-in-render",
  "three-no-state-in-animation-loop",
  "three-no-state-in-pointer-move",
  "three-require-animation-mixer-cleanup",
  "three-require-controls-cleanup",
  "three-require-owned-geometry-cleanup",
  "three-require-owned-material-cleanup",
  "three-require-owned-texture-cleanup",
  "three-require-postprocessing-cleanup",
  "three-require-render-target-cleanup",
  "three-require-renderer-cleanup",
]);

const getRequiredCapabilities = (bucketName, ruleId) => {
  if (bucketName === "r3f" && ruleId.startsWith("three-")) {
    return THREE_RULE_IDS_REQUIRING_REACT.has(ruleId) ? ["react", "three"] : ["three"];
  }
  return (
    BUCKET_TO_REQUIRED_CAPABILITIES[bucketName] ??
    (BUCKETS_REQUIRING_REACT.has(bucketName) ? ["react"] : [])
  );
};

// Bucket directory → behavioral tags merged onto every rule in that
// bucket at registry-build time. Lets cross-cutting controls
// (`severity.tags`, `surfaces.*.excludeTags`,
// `config.ignore.tags`) target whole rule families without each rule
// needing to repeat the tag in its `defineRule({...})` call. Rule-
// authored tags layer on top (deduped at runtime), so a rule can both
// inherit a bucket tag and carry its own.
const BUCKET_TO_AUTO_TAGS = {
  design: ["design"],
  ink: ["ink"],
  "react-native": ["react-native"],
  r3f: ["r3f", "webgl"],
  webgl: ["webgl"],
  "security-scan": ["security-scan"],
  server: ["server-action"],
};

const BUCKETS_OPT_IN_BY_DEFAULT = new Set(["design"]);

const getAutoTags = (bucketName, ruleId) => {
  if (bucketName === "r3f" && ruleId.startsWith("three-")) return ["three", "webgl"];
  return BUCKET_TO_AUTO_TAGS[bucketName] ?? [];
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
const RULES_NOT_PORTED_FROM_EXTERNAL = new Set([
  "data-table-requires-accessible-name",
  "details-requires-summary",
  "fieldset-requires-legend",
  "form-control-requires-name",
  "prefer-html-dialog",
  "no-autoplay-without-muted",
  "no-assertive-status",
  "no-aria-invalid-without-description",
  "no-blocked-paste",
  "no-broken-image-source",
  "no-focusable-content-in-aria-hidden",
  "no-multiple-unlabeled-navigation-landmarks",
  "no-multiple-main-landmarks",
  "no-nonresizable-textarea",
  "no-placeholder-only-field",
  "no-reduced-motion-content-removal",
  "no-responsive-hidden-accessible-name",
  "no-skipped-heading-level",
  "no-static-motion-config-never",
  "no-ungated-tailwind-animation",
  "no-uninformative-aria-label",
  "dialog-has-accessible-name",
  "no-create-ref-in-function-component",
  "no-call-component-as-function",
  "no-string-false-on-boolean-attribute",
  "hook-import-rename-loses-use-prefix",
  "no-invalid-progress-range",
  "role-button-requires-complete-keyboard-activation",
]);

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

// Fine-grained category → the clear, user-facing bucket the scan output
// groups & labels by. Rules (and the buckets below) declare a detailed
// category for intent; the reporter only ever shows these five outcome
// buckets, so "is this a bug, a slowdown, a vulnerability, an a11y gap,
// or a maintainability smell?" is obvious at a glance. Collapsing happens
// here at codegen so every consumer (renderer, JSON, severity overrides,
// explain) reads the same bucket off `rule.category`.
const CATEGORY_BUCKET = {
  Security: "Security",
  Performance: "Performance",
  "Bundle Size": "Performance",
  Accessibility: "Accessibility",
  Correctness: "Bugs",
  "State & Effects": "Bugs",
  "React Compiler": "Performance",
  "Next.js": "Bugs",
  "React Native": "Bugs",
  Server: "Bugs",
  "TanStack Query": "Bugs",
  "TanStack Start": "Bugs",
  Preact: "Bugs",
  Architecture: "Maintainability",
  Design: "Maintainability",
  Other: "Bugs",
};
const toBucket = (category) => CATEGORY_BUCKET[category] ?? "Bugs";

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
  ink: "Correctness",
  "js-performance": "Performance",
  jotai: "State & Effects",
  mobx: "State & Effects",
  nextjs: "Next.js",
  performance: "Performance",
  preact: "Preact",
  "react-builtins": "Correctness",
  "react-native": "React Native",
  r3f: "Performance",
  "react-ui": "Accessibility",
  security: "Security",
  "security-scan": "Security",
  server: "Server",
  "state-and-effects": "State & Effects",
  "tanstack-query": "TanStack Query",
  "tanstack-start": "TanStack Start",
  valtio: "State & Effects",
  "view-transitions": "Correctness",
  webgl: "Performance",
  zod: "Architecture",
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
    // `[^(]*` tolerates an optional type argument with arbitrary nesting
    // (e.g. `defineRule<Foo<Bar>>(`) and the no-generic `defineRule({` form,
    // where the original `<[^>]+>` matcher silently failed and dropped the rule.
    // `defineRetiredRule` follows the same metadata shape but intentionally
    // emits a no-op rule for legacy config compatibility; Scan rules
    // (a `scan` field instead of `create`) also register through plain
    // `defineRule`.
    const exportMatch = source.match(
      /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:wrapReactRouterRule\s*\(\s*)?(?:defineRule|defineRetiredRule)\b[^(]*\(\s*\{/,
    );
    if (!exportMatch) {
      // Fail loudly if a file clearly declares a rule export but the scanner
      // can't parse it — a silent `continue` would ship a registry missing
      // the rule with no error.
      if (
        /export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(?:wrapReactRouterRule\s*\(\s*)?(?:defineRule|defineRetiredRule)\b/.test(
          source,
        )
      ) {
        console.error(
          `Rule export present but unparseable by the registry scanner: ${path.relative(PACKAGE_ROOT, filePath)}`,
        );
        process.exit(1);
      }
      continue;
    }
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
    const isDefaultDisabledInSource = /^\s*defaultEnabled:\s*false,?\s*$/m.test(source);
    if (!severityMatch) {
      console.error(
        `Rule file missing \`severity: "error" | "warn"\` field: ${path.relative(PACKAGE_ROOT, filePath)}`,
      );
      process.exit(1);
    }
    const ruleId = idMatch[1];
    if (RULE_IDS_TO_SKIP_REGISTRATION.has(ruleId)) continue;
    const category = toBucket(categoryMatch ? categoryMatch[1] : defaultCategory);
    const severity = severityMatch[1];
    // Force POSIX separators — `path.relative()` returns backslashes on
    // Windows, which TypeScript module resolution rejects.
    const relativeImport =
      "./" +
      path
        .relative(path.dirname(REGISTRY_OUTPUT), filePath)
        .replaceAll(path.sep, "/")
        .replace(/\.ts$/, ".js");
    const autoTags = getAutoTags(bucket.name, ruleId);
    const requiredCapabilities = getRequiredCapabilities(bucket.name, ruleId);
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
      requiredCapabilities,
      originallyExternal,
      shouldSynthesizeDefaultDisabled:
        BUCKETS_OPT_IN_BY_DEFAULT.has(bucket.name) && !isDefaultDisabledInSource,
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

// Merge bucket-synthesized capabilities with any rule-authored `requires`
// (deduped), mirroring the auto-tag merge. A
// rule that already pins a React version (e.g. `requires: ["react:19"]`)
// keeps that; the redundant `"react"` is harmless since the version gate
// already implies React is present.
const formatRequiresLine = (entry) => {
  if (entry.requiredCapabilities.length === 0) return "";
  const requiredCapabilities = entry.requiredCapabilities
    .map((capability) => `"${capability}"`)
    .join(", ");
  // Match prettier's 100-char print width so `gen:check` and `format:check`
  // agree: emit the single-line form when it fits, else the wrapped form
  // prettier would otherwise rewrite it into (a few rules have long enough
  // identifiers — e.g. `noNoninteractiveElementToInteractiveRole` — to spill
  // past the limit).
  const singleLine = `      requires: [...new Set<Capability>([${requiredCapabilities}, ...(${entry.identifier}.requires ?? [])])],`;
  if (singleLine.length <= 100) return `${singleLine}\n`;
  const wrappedSetLine = `        ...new Set<Capability>([${requiredCapabilities}, ...(${entry.identifier}.requires ?? [])]),`;
  if (wrappedSetLine.length <= 100) {
    return `      requires: [\n${wrappedSetLine}\n      ],\n`;
  }
  return (
    `      requires: [\n` +
    `        ...new Set<Capability>([\n` +
    entry.requiredCapabilities.map((capability) => `          "${capability}",\n`).join("") +
    `          ...(${entry.identifier}.requires ?? []),\n` +
    `        ]),\n` +
    `      ],\n`
  );
};

// Per-entry shape:
//   { key, id, source, originallyExternal, rule: { ...sourceRule, framework, category, defaultEnabled?, tags? } }
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
      (entry.shouldSynthesizeDefaultDisabled ? `      defaultEnabled: false,\n` : "") +
      formatAutoTagsLine(entry) +
      formatRequiresLine(entry) +
      `    },\n` +
      `  },`,
  )
  .join("\n");

const generatedSource = `// GENERATED FILE — do not edit by hand. Run \`pnpm gen\` to regenerate.
// Source of truth: every \`export const <name> = defineRule({ id: "...", ... })\`
// under \`src/plugin/rules/<bucket>/<name>.ts\`. The rule's \`framework\` and
// default \`category\`, tags, and activation status come from the bucket
// directory (see \`scripts/generate-rule-registry.mjs\`) — rule files only
// override \`category\` when needed. Adding a rule is a single-file operation:
// create the rule file, set its \`id\`, re-run codegen.

import type { Capability } from "./utils/capability.js";
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
