import path from "node:path";
import { buildRulePromptUrl, highlighter } from "@react-doctor/core";
import type { ReactDoctorConfig, RuleSeverityOverride } from "@react-doctor/core";
import { cliLogger as logger } from "../utils/cli-logger.js";
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

const applyConfigChange = (
  options: RulesCwdOptions,
  change: (config: ReactDoctorConfig) => ReactDoctorConfig,
): RuleConfigTarget => {
  const projectRoot = resolveProjectRoot(options);
  const target = resolveRuleConfigTarget(projectRoot);
  writeRuleConfig(target, change(target.config));
  return target;
};

export const rulesListAction = (options: RulesListOptions): void => {
  const catalog = buildRuleCatalog();
  const projectRoot = resolveProjectRoot(options);
  const config = resolveRuleConfigTarget(projectRoot).config;

  const categoryFilter = options.category?.toLowerCase();
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

export const rulesExplainAction = (ruleQuery: string, options: RulesExplainOptions): void => {
  const catalog = buildRuleCatalog();
  const entry = findRuleInCatalog(catalog, ruleQuery);
  if (!entry) {
    reportRuleNotFound(ruleQuery);
    return;
  }

  const config = resolveRuleConfigTarget(resolveProjectRoot(options)).config;
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
          learnMoreUrl: buildRulePromptUrl("react-doctor", entry.id),
        },
        null,
        2,
      ),
    );
    return;
  }

  logger.log(renderRuleExplanation({ entry, effective }));
};

const setRuleSeverityAndReport = (
  entry: RuleCatalogEntry,
  severity: RuleSeverityOverride,
  options: RulesCwdOptions,
): void => {
  const target = applyConfigChange(options, (config) =>
    setRuleSeverity(config, entry.key, severity),
  );
  logger.success(`Set ${entry.key} → ${severity}`);
  logger.dim(`  Updated ${describeTargetPath(target)}`);
};

export const rulesSetAction = (
  ruleQuery: string,
  severityValue: string,
  options: RulesCwdOptions,
): void => {
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
  setRuleSeverityAndReport(entry, severity, options);
};

export const rulesEnableAction = (ruleQuery: string, options: RulesEnableOptions): void => {
  const entry = findRuleInCatalog(buildRuleCatalog(), ruleQuery);
  if (!entry) {
    reportRuleNotFound(ruleQuery);
    return;
  }
  if (options.severity === undefined) {
    setRuleSeverityAndReport(entry, entry.defaultSeverity, options);
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
  setRuleSeverityAndReport(entry, severity, options);
};

export const rulesDisableAction = (ruleQuery: string, options: RulesCwdOptions): void => {
  const entry = findRuleInCatalog(buildRuleCatalog(), ruleQuery);
  if (!entry) {
    reportRuleNotFound(ruleQuery);
    return;
  }
  setRuleSeverityAndReport(entry, "off", options);
};

export const rulesCategoryAction = (
  categoryQuery: string,
  severityValue: string,
  options: RulesCwdOptions,
): void => {
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
  const target = applyConfigChange(options, (config) =>
    setCategorySeverity(config, matchedCategory, severity),
  );
  logger.success(`Set category "${matchedCategory}" → ${severity}`);
  logger.dim(`  Updated ${describeTargetPath(target)}`);
};

export const rulesIgnoreTagAction = (tag: string, options: RulesCwdOptions): void => {
  const knownTags = listRuleTags(buildRuleCatalog());
  if (!knownTags.includes(tag)) {
    logger.error(`Unknown tag "${tag}".`);
    logger.dim(`  Known tags: ${knownTags.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const target = applyConfigChange(options, (config) => addIgnoredTag(config, tag));
  logger.success(`Ignoring tag "${tag}" (rules with this tag are skipped before linting)`);
  logger.dim(`  Updated ${describeTargetPath(target)}`);
};

export const rulesUnignoreTagAction = (tag: string, options: RulesCwdOptions): void => {
  const target = resolveRuleConfigTarget(resolveProjectRoot(options));
  // Don't write (or create) a config for a no-op — reporting success when
  // the tag was never ignored is misleading and leaves a stray config file.
  if (!(target.config.ignore?.tags ?? []).includes(tag)) {
    logger.dim(`Tag "${tag}" was not being ignored; nothing to change.`);
    return;
  }
  writeRuleConfig(target, removeIgnoredTag(target.config, tag));
  logger.success(`Tag "${tag}" is no longer ignored`);
  logger.dim(`  Updated ${describeTargetPath(target)}`);
};
