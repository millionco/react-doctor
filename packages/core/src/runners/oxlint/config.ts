import * as fs from "node:fs";
import reactDoctorPlugin, {
  CROSS_FILE_RULE_IDS,
  REACT_COMPILER_RULES,
  REACT_DOCTOR_RULES,
} from "oxlint-plugin-react-doctor";
import type { OxlintRuleSeverity } from "oxlint-plugin-react-doctor";
import type { ProjectInfo, RuleSeverityControls } from "../../types/index.js";
import { resolveRuleSeverityOverride } from "../../resolve-rule-severity-override.js";
import { COMPILER_CLEANUP_BUCKET, COMPILER_CLEANUP_RULE_KEYS } from "../../constants.js";
import { getCapabilities, shouldEnableRule } from "../../project-info/capabilities.js";
import { filterRulesToAvailable, resolveReactHooksJsPlugin } from "./plugin-resolution.js";
import type { JsPluginEntry, ResolvedUserPlugin } from "./plugin-resolution.js";

export interface OxlintConfigOptions {
  pluginPath: string;
  project: ProjectInfo;
  customRulesOnly?: boolean;
  extendsPaths?: string[];
  ignoredTags?: ReadonlySet<string>;
  serverAuthFunctionNames?: ReadonlyArray<string>;
  severityControls?: RuleSeverityControls;
  /**
   * User-declared plugins from `react-doctor.config.json`'s
   * `plugins: [...]`, already resolved + introspected via
   * `resolveUserPlugins`. Each plugin's rules are opt-in: they don't
   * run unless `severityControls.rules["<plugin-name>/<rule>"]` is
   * set to `"warn"` or `"error"`.
   */
  userPlugins?: ReadonlyArray<ResolvedUserPlugin>;
  /**
   * Skip the optional `react-hooks-js` (eslint-plugin-react-hooks) JS
   * plugin and its React Compiler rules. The `runOxlint` fallback sets
   * this and retries after the plugin fails to import in the user's
   * environment, so the curated react-doctor rules still run instead of
   * the whole lint pass failing (issue #833). See `run-oxlint.ts`.
   */
  disableReactHooksJsPlugin?: boolean;
  /**
   * Partitions the rule set for the per-file lint cache (`run-oxlint.ts`).
   * Omitted (the default) builds the full config — every caller outside the
   * cache path is unaffected.
   *
   *   - `"cacheable"` — every enabled rule EXCEPT the cross-file set
   *     (`CROSS_FILE_RULE_IDS`). These rules' verdicts depend only on the
   *     linted file's own content, so their output is content-addressable.
   *   - `"sidecar"` — ONLY the cross-file react-doctor rules; the React
   *     Compiler frontend and user plugins are dropped (none are cross-file).
   */
  ruleSelection?: "cacheable" | "sidecar";
  /**
   * Narrows a `"sidecar"` selection to a subset of the cross-file rules.
   * The sidecar cache path uses it to split fingerprint-BOUNDED rules
   * (replayable via the dependency-probe store) from UNBOUNDED ones (no
   * dependency collector — they re-lint every file, every scan). Ignored
   * for other selections.
   */
  sidecarRuleIdFilter?: ReadonlySet<string>;
}

const resolveSettingsRootDirectory = (rootDirectory: string): string => {
  if (!fs.existsSync(rootDirectory)) return rootDirectory;
  return fs.realpathSync(rootDirectory);
};

// The `compiler-cleanup` bucket override applies to its rule family only when
// the user hasn't pinned that exact rule individually (a per-rule override
// always wins). Returns `undefined` when the rule isn't in the family or no
// bucket override is configured.
const resolveCompilerCleanupBucketSeverity = (
  ruleKey: string,
  severityControls: RuleSeverityControls | undefined,
): "error" | "warn" | "off" | undefined => {
  if (!COMPILER_CLEANUP_RULE_KEYS.has(ruleKey)) return undefined;
  return severityControls?.buckets?.[COMPILER_CLEANUP_BUCKET];
};

const applyRuleSeverityControls = (
  rules: Record<string, OxlintRuleSeverity>,
  severityControls: RuleSeverityControls | undefined,
): Record<string, OxlintRuleSeverity> => {
  const enabledRules: Record<string, OxlintRuleSeverity> = {};
  for (const [ruleKey, defaultSeverity] of Object.entries(rules)) {
    const severity =
      resolveRuleSeverityOverride({ ruleKey }, severityControls) ??
      resolveCompilerCleanupBucketSeverity(ruleKey, severityControls) ??
      defaultSeverity;
    if (severity === "off") continue;
    enabledRules[ruleKey] = severity;
  }
  return enabledRules;
};

/**
 * Builds the `rules` entries for one user-declared plugin. Rules are
 * opt-in: a rule never registers unless `severityControls.rules`
 * explicitly sets it to `"warn"` or `"error"`. This mirrors the
 * built-in plugin's `defaultEnabled: false` behavior so installing
 * a third-party plugin doesn't surprise the user with a flood of
 * new diagnostics on the first scan.
 */
const buildUserPluginRules = (
  userPlugin: ResolvedUserPlugin,
  severityControls: RuleSeverityControls | undefined,
): Record<string, OxlintRuleSeverity> => {
  const enabled: Record<string, OxlintRuleSeverity> = {};
  for (const ruleName of userPlugin.availableRuleNames) {
    const ruleKey = `${userPlugin.entry.name}/${ruleName}`;
    const explicitSeverity = resolveRuleSeverityOverride({ ruleKey }, severityControls);
    if (explicitSeverity === undefined || explicitSeverity === "off") continue;
    enabled[ruleKey] = explicitSeverity;
  }
  return enabled;
};

export const createOxlintConfig = ({
  pluginPath,
  project,
  customRulesOnly = false,
  extendsPaths = [],
  ignoredTags = new Set<string>(),
  serverAuthFunctionNames,
  severityControls,
  userPlugins = [],
  disableReactHooksJsPlugin = false,
  ruleSelection,
  sidecarRuleIdFilter,
}: OxlintConfigOptions) => {
  // The sidecar carries only cross-file react-doctor rules — the React
  // Compiler frontend isn't cross-file, so it never belongs there.
  const reactHooksJsPlugin =
    disableReactHooksJsPlugin || ruleSelection === "sidecar"
      ? null
      : resolveReactHooksJsPlugin(project.hasReactCompiler, customRulesOnly);
  const reactCompilerRules = reactHooksJsPlugin
    ? applyRuleSeverityControls(
        filterRulesToAvailable(
          REACT_COMPILER_RULES,
          "react-hooks-js",
          reactHooksJsPlugin.availableRuleNames,
        ),
        severityControls,
      )
    : {};

  const jsPlugins: JsPluginEntry[] = [];
  if (reactHooksJsPlugin) jsPlugins.push(reactHooksJsPlugin.entry);

  const capabilities = getCapabilities(project);

  const enabledReactDoctorRules: Record<string, OxlintRuleSeverity> = {};
  for (const registryEntry of REACT_DOCTOR_RULES) {
    const rule = reactDoctorPlugin.rules[registryEntry.id];
    if (!rule) continue;
    // Per-file-cache partition: the cacheable config drops the cross-file
    // rules (they run always-fresh in the sidecar); the sidecar config keeps
    // only them. The default (undefined) keeps every rule.
    if (ruleSelection === "cacheable" && CROSS_FILE_RULE_IDS.has(registryEntry.id)) continue;
    if (ruleSelection === "sidecar" && !CROSS_FILE_RULE_IDS.has(registryEntry.id)) continue;
    if (
      ruleSelection === "sidecar" &&
      sidecarRuleIdFilter !== undefined &&
      !sidecarRuleIdFilter.has(registryEntry.id)
    ) {
      continue;
    }
    // Scan rules run via core's check-security-scan environment
    // check, not oxlint — registering them would only add dead visitors.
    if (rule.scan !== undefined) continue;
    // `customRulesOnly` mirrors the historical behavior of the pre-port
    // builtin-react / builtin-a11y gate — skip everything ported 1:1
    // from upstream OXC plugins.
    if (customRulesOnly && registryEntry.originallyExternal) continue;
    if (rule.framework !== "global" && !rule.requires) continue;
    if (!shouldEnableRule(rule.requires, rule.tags, capabilities, ignoredTags, rule.disabledWhen))
      continue;
    // `defaultEnabled: false` opts a rule out of the default config —
    // it ships in the plugin but only activates when the user pins the
    // rule itself (or an alias) to `"warn"` / `"error"` in `rules`. A
    // broad `categories` bump re-stamps the severity of already-enabled
    // rules and is not a deliberate opt-in (same principle as the
    // app-only gate in build-diagnostic-pipeline).
    const explicitRuleOverride = resolveRuleSeverityOverride(
      { ruleKey: registryEntry.key },
      severityControls,
    );
    if (rule.defaultEnabled === false && explicitRuleOverride === undefined) continue;
    const explicitSeverity = resolveRuleSeverityOverride(
      { ruleKey: registryEntry.key, category: rule.category },
      severityControls,
    );
    const severity =
      explicitSeverity ??
      resolveCompilerCleanupBucketSeverity(registryEntry.key, severityControls) ??
      rule.severity;
    if (severity === "off") continue;
    enabledReactDoctorRules[registryEntry.key] = severity;
  }

  // Fold every user-declared plugin's enabled rules + add its
  // resolved specifier to `jsPlugins` so oxlint loads it alongside
  // the built-in react-doctor plugin. Order: react-hooks-js (when
  // present) → user plugins → react-doctor itself. The react-doctor
  // plugin stays last so its rules can reference earlier plugins'
  // settings if a future composition pattern needs that hook.
  // User plugins are opaque — we can't prove their rules are within-file, so
  // they never go in the cacheable sidecar split. They only run on the full
  // (uncached) config; the cache path bypasses entirely when any are present.
  const userPluginRules: Record<string, OxlintRuleSeverity> = {};
  if (ruleSelection !== "sidecar") {
    for (const userPlugin of userPlugins) {
      Object.assign(userPluginRules, buildUserPluginRules(userPlugin, severityControls));
      jsPlugins.push(userPlugin.entry);
    }
  }

  return {
    ...(extendsPaths.length > 0 ? { extends: extendsPaths } : {}),
    categories: {
      correctness: "off",
      suspicious: "off",
      pedantic: "off",
      perf: "off",
      restriction: "off",
      style: "off",
      nursery: "off",
    },
    // We don't load any OXC built-in plugins anymore — every `react/*`
    // and `jsx-a11y/*` rule has been ported into `react-doctor/*`. The
    // empty `plugins:` array is intentional; rules come exclusively
    // from our codegen-built registry plus configured npm-shipped
    // plugins (react-hooks-js for the React Compiler frontend etc.)
    // and any user-declared plugins from `config.plugins`.
    plugins: [],
    jsPlugins: [...jsPlugins, pluginPath],
    settings: {
      "react-doctor": {
        framework: project.framework,
        rootDirectory: resolveSettingsRootDirectory(project.rootDirectory),
        // The framework-capability vocabulary, available to any rule via
        // `hasCapability`. Sorted so equivalent projects hash identically
        // (this bag feeds the ruleset cache key).
        capabilities: [...capabilities].sort(),
        ...(project.shopifyFlashListMajorVersion !== null
          ? { shopifyFlashListMajorVersion: project.shopifyFlashListMajorVersion }
          : {}),
        ...(serverAuthFunctionNames && serverAuthFunctionNames.length > 0
          ? { serverAuthFunctionNames: [...serverAuthFunctionNames] }
          : {}),
      },
    },
    rules: {
      ...reactCompilerRules,
      ...enabledReactDoctorRules,
      ...userPluginRules,
    },
  };
};
