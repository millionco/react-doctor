import * as path from "node:path";
import { buildRuleDocsUrl, highlighter, validateConfigTypes } from "@react-doctor/core";
import type { ReactDoctorConfig, RuleSeverityOverride } from "@react-doctor/core";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { METRIC } from "../utils/constants.js";
import { recordCount } from "../utils/record-metric.js";
import { findNearestPackageDirectory } from "../utils/install-doctor-script.js";
import {
  buildRuleCatalog,
  findRuleInCatalog,
  listRuleCategories,
  listRuleTags,
} from "../utils/rule-catalog.js";
import type { RuleCatalogEntry } from "../utils/rule-catalog.js";
import { renderRuleCatalog, renderRuleExplanation } from "../utils/render-rule-catalog.js";
import { resolveRuleConfigTarget, writeRuleConfig } from "../utils/rule-config-file.js";
import type { RuleConfigTarget } from "../utils/rule-config-file.js";
import { resolveEffectiveRuleSeverity } from "../utils/resolve-effective-rule-severity.js";
import {
  addIgnoredTag,
  removeIgnoredTag,
  setCategorySeverity,
  setRuleSeverity,
} from "../utils/update-rule-config.js";

const SEVERITY_VALUES: ReadonlyArray<RuleSeverityOverride> = ["off", "warn", "error"];

// Every `rules` subcommand records one invocation (the per-subcommand detail
// comes from `rules.queried` for reads and `rules.changed` for writes).
const recordRulesInvocation = (): void => recordCount(METRIC.cliInvoked, 1, { command: "rules" });

interface RulesCwdOptions {
  readonly cwd?: string;
}

interface RulesListOptions extends RulesCwdOptions {
  readonly category?: string;
  readonly tag?: string;
  readonly framework?: string;
  readonly configured?: boolean;
  readonly json?: boolean;
}

interface RulesExplainOptions extends RulesCwdOptions {
  readonly json?: boolean;
}

interface RulesEnableOptions extends RulesCwdOptions {
  readonly severity?: string;
}

const resolveProjectRoot = (options: RulesCwdOptions): string => {
  const requestedDirectory = path.resolve(options.cwd ?? process.cwd());
  return findNearestPackageDirectory(requestedDirectory) ?? requestedDirectory;
};

const parseSeverity = (value: string): RuleSeverityOverride | null =>
  (SEVERITY_VALUES as ReadonlyArray<string>).includes(value)
    ? (value as RuleSeverityOverride)
    : null;

const reportInvalidSeverity = (value: string): void => {
  logger.error(`Invalid severity "${value}". Expected one of: ${SEVERITY_VALUES.join(", ")}.`);
  process.exitCode = 1;
};

const reportRuleNotFound = (ruleQuery: string): void => {
  logger.error(`Unknown rule "${ruleQuery}".`);
  logger.dim("  Run `react-doctor rules list` to see every available rule.");
  process.exitCode = 1;
};

const describeTargetPath = (target: RuleConfigTarget): string => {
  const relativePath = path.relative(process.cwd(), target.filePath);
  // Prefer a project-relative path, but fall back to the absolute path
  // when the target lives outside the CWD (e.g. `--cwd` points elsewhere)
  // so we don't print a wall of `../`.
  const displayPath =
    relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : target.filePath;
  return target.exists ? displayPath : `${displayPath} ${highlighter.dim("(created)")}`;
};

interface AppliedConfigChange {
  readonly target: RuleConfigTarget;
  readonly nextConfig: ReactDoctorConfig;
  readonly written: boolean;
}

const applyConfigChange = async (
  options: RulesCwdOptions,
  change: (config: ReactDoctorConfig) => ReactDoctorConfig,
): Promise<AppliedConfigChange> => {
  const projectRoot = resolveProjectRoot(options);
  const target = await resolveRuleConfigTarget(projectRoot);
  const nextConfig = change(target.config);
  const { written } = await writeRuleConfig(target, nextConfig);
  return { target, nextConfig, written };
};

// A dynamic module config (e.g. `export default () => ({...})`) can't be
// edited statically; print the change so the user can apply it by hand.
const reportManualEdit = (target: RuleConfigTarget, nextConfig: ReactDoctorConfig): void => {
  const managed: Record<string, unknown> = {};
  for (const key of ["rules", "categories", "ignore"] as const) {
    if (nextConfig[key] !== undefined) managed[key] = nextConfig[key];
  }
  logger.error(`Couldn't automatically edit ${describeTargetPath(target)} (dynamic config).`);
  logger.dim("  Apply this to your config's default export, then re-run:");
  for (const line of JSON.stringify(managed, null, 2).split("\n")) logger.dim(`  ${line}`);
  process.exitCode = 1;
};

export const rulesListAction = async (options: RulesListOptions): Promise<void> => {
  recordRulesInvocation();
  recordCount(METRIC.rulesQueried, 1, {
    subcommand: "list",
    hadFilter: Boolean(options.category || options.tag || options.framework || options.configured),
  });
  const catalog = buildRuleCatalog();
  const target = await resolveRuleConfigTarget(resolveProjectRoot(options));
  // Validate the on-disk config the same way the loader does so effective
  // severity reflects what a scan applies (invalid `rules`/`categories`
  // values are dropped, not shown as active).
  const config = validateConfigTypes(target.config);

  const categoryFilter =
    typeof options.category === "string" ? options.category.toLowerCase() : undefined;
  const frameworkFilter = options.framework?.toLowerCase();

  const rows = catalog
    .filter((entry) => {
      if (categoryFilter && entry.category.toLowerCase() !== categoryFilter) return false;
      if (frameworkFilter && entry.framework.toLowerCase() !== frameworkFilter) return false;
      if (options.tag && !entry.tags.includes(options.tag)) return false;
      return true;
    })
    .map((entry) => ({ entry, effective: resolveEffectiveRuleSeverity(config, entry) }))
    .filter((row) => (options.configured ? row.effective.source !== "default" : true));

  if (options.json) {
    const payload = rows.map((row) => ({
      key: row.entry.key,
      id: row.entry.id,
      category: row.entry.category,
      framework: row.entry.framework,
      tags: row.entry.tags,
      defaultSeverity: row.entry.defaultSeverity,
      defaultEnabled: row.entry.defaultEnabled,
      severity: row.effective.value,
      source: row.effective.source,
    }));
    logger.log(JSON.stringify(payload, null, 2));
    return;
  }

  logger.log(renderRuleCatalog(rows));
};

export const rulesExplainAction = async (
  ruleQuery: string,
  options: RulesExplainOptions,
): Promise<void> => {
  recordRulesInvocation();
  recordCount(METRIC.rulesQueried, 1, { subcommand: "explain" });
  const catalog = buildRuleCatalog();
  const entry = findRuleInCatalog(catalog, ruleQuery);
  if (!entry) {
    reportRuleNotFound(ruleQuery);
    return;
  }

  // Validate like the loader so explain reflects the severity a scan applies.
  const target = await resolveRuleConfigTarget(resolveProjectRoot(options));
  const config = validateConfigTypes(target.config);
  const effective = resolveEffectiveRuleSeverity(config, entry);

  if (options.json) {
    logger.log(
      JSON.stringify(
        {
          key: entry.key,
          id: entry.id,
          category: entry.category,
          framework: entry.framework,
          tags: entry.tags,
          defaultSeverity: entry.defaultSeverity,
          defaultEnabled: entry.defaultEnabled,
          severity: effective.value,
          source: effective.source,
          recommendation: entry.recommendation ?? null,
          learnMoreUrl: buildRuleDocsUrl("react-doctor", entry.id),
        },
        null,
        2,
      ),
    );
    return;
  }

  logger.log(renderRuleExplanation({ entry, effective }));
};

const setRuleSeverityAndReport = async (
  entry: RuleCatalogEntry,
  severity: RuleSeverityOverride,
  options: RulesCwdOptions,
  action: string,
): Promise<void> => {
  const { target, nextConfig, written } = await applyConfigChange(options, (config) =>
    setRuleSeverity(config, entry.key, severity),
  );
  if (!written) {
    reportManualEdit(target, nextConfig);
    return;
  }
  logger.success(`Set ${entry.key} → ${severity}`);
  logger.dim(`  Updated ${describeTargetPath(target)}`);
  recordCount(METRIC.rulesChanged, 1, { action, severity, target: entry.key });
};

export const rulesSetAction = async (
  ruleQuery: string,
  severityValue: string,
  options: RulesCwdOptions,
): Promise<void> => {
  recordRulesInvocation();
  const severity = parseSeverity(severityValue);
  if (!severity) {
    reportInvalidSeverity(severityValue);
    return;
  }
  const entry = findRuleInCatalog(buildRuleCatalog(), ruleQuery);
  if (!entry) {
    reportRuleNotFound(ruleQuery);
    return;
  }
  await setRuleSeverityAndReport(entry, severity, options, "set");
};

export const rulesEnableAction = async (
  ruleQuery: string,
  options: RulesEnableOptions,
): Promise<void> => {
  recordRulesInvocation();
  const entry = findRuleInCatalog(buildRuleCatalog(), ruleQuery);
  if (!entry) {
    reportRuleNotFound(ruleQuery);
    return;
  }
  if (options.severity === undefined) {
    await setRuleSeverityAndReport(entry, entry.defaultSeverity, options, "enable");
    return;
  }
  const severity = parseSeverity(options.severity);
  if (!severity) {
    reportInvalidSeverity(options.severity);
    return;
  }
  if (severity === "off") {
    logger.error("`enable` cannot set a rule to off. Use `react-doctor rules disable` instead.");
    process.exitCode = 1;
    return;
  }
  await setRuleSeverityAndReport(entry, severity, options, "enable");
};

export const rulesDisableAction = async (
  ruleQuery: string,
  options: RulesCwdOptions,
): Promise<void> => {
  recordRulesInvocation();
  const entry = findRuleInCatalog(buildRuleCatalog(), ruleQuery);
  if (!entry) {
    reportRuleNotFound(ruleQuery);
    return;
  }
  await setRuleSeverityAndReport(entry, "off", options, "disable");
};

export const rulesCategoryAction = async (
  categoryQuery: string,
  severityValue: string,
  options: RulesCwdOptions,
): Promise<void> => {
  recordRulesInvocation();
  const severity = parseSeverity(severityValue);
  if (!severity) {
    reportInvalidSeverity(severityValue);
    return;
  }
  const knownCategories = listRuleCategories(buildRuleCatalog());
  const matchedCategory = knownCategories.find(
    (category) => category.toLowerCase() === categoryQuery.toLowerCase(),
  );
  if (!matchedCategory) {
    logger.error(`Unknown category "${categoryQuery}".`);
    logger.dim(`  Known categories: ${knownCategories.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const { target, nextConfig, written } = await applyConfigChange(options, (config) =>
    setCategorySeverity(config, matchedCategory, severity),
  );
  if (!written) {
    reportManualEdit(target, nextConfig);
    return;
  }
  logger.success(`Set category "${matchedCategory}" → ${severity}`);
  logger.dim(`  Updated ${describeTargetPath(target)}`);
  recordCount(METRIC.rulesChanged, 1, { action: "category", severity, target: matchedCategory });
};

export const rulesIgnoreTagAction = async (
  tag: string,
  options: RulesCwdOptions,
): Promise<void> => {
  recordRulesInvocation();
  const knownTags = listRuleTags(buildRuleCatalog());
  if (!knownTags.includes(tag)) {
    logger.error(`Unknown tag "${tag}".`);
    logger.dim(`  Known tags: ${knownTags.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const { target, nextConfig, written } = await applyConfigChange(options, (config) =>
    addIgnoredTag(config, tag),
  );
  if (!written) {
    reportManualEdit(target, nextConfig);
    return;
  }
  logger.success(`Ignoring tag "${tag}" (rules with this tag are skipped before linting)`);
  logger.dim(`  Updated ${describeTargetPath(target)}`);
  recordCount(METRIC.rulesChanged, 1, { action: "ignoreTag", target: tag });
};

export const rulesUnignoreTagAction = async (
  tag: string,
  options: RulesCwdOptions,
): Promise<void> => {
  recordRulesInvocation();
  const target = await resolveRuleConfigTarget(resolveProjectRoot(options));
  // Don't write (or create) a config for a no-op — reporting success when
  // the tag was never ignored is misleading and leaves a stray config file.
  if (!(target.config.ignore?.tags ?? []).includes(tag)) {
    logger.dim(`Tag "${tag}" was not being ignored; nothing to change.`);
    return;
  }
  const nextConfig = removeIgnoredTag(target.config, tag);
  const { written } = await writeRuleConfig(target, nextConfig);
  if (!written) {
    reportManualEdit(target, nextConfig);
    return;
  }
  logger.success(`Tag "${tag}" is no longer ignored`);
  logger.dim(`  Updated ${describeTargetPath(target)}`);
  recordCount(METRIC.rulesChanged, 1, { action: "unignoreTag", target: tag });
};
