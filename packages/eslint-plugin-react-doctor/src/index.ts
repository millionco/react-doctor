import oxlintPlugin, {
  ALL_REACT_DOCTOR_RULES,
  NEXTJS_RULES,
  REACT_NATIVE_RULES,
  RECOMMENDED_RULES,
  TANSTACK_QUERY_RULES,
  TANSTACK_START_RULES,
} from "oxlint-plugin-react-doctor";
import type { EsTreeNode, OxlintRuleSeverity, RuleVisitors } from "oxlint-plugin-react-doctor";

interface EslintRuleContext {
  report: (descriptor: { node: EsTreeNode; message: string }) => void;
  getFilename?: () => string;
  readonly options?: ReadonlyArray<unknown>;
  readonly settings?: Readonly<Record<string, unknown>>;
}

interface WrappedRule {
  create: (context: EslintRuleContext) => RuleVisitors;
}

interface EslintRuleMeta {
  type: "problem" | "suggestion" | "layout";
  docs: {
    description: string;
    url: string;
    recommended: boolean;
  };
  schema: unknown[];
}

interface EslintRule {
  meta: EslintRuleMeta;
  create: (context: EslintRuleContext) => RuleVisitors;
}

interface EslintFlatConfig {
  name: string;
  plugins: Record<string, EslintPlugin>;
  rules: Record<string, OxlintRuleSeverity>;
}

interface EslintPlugin {
  meta: { name: string; version: string };
  rules: Record<string, EslintRule>;
  configs: {
    recommended: EslintFlatConfig;
    next: EslintFlatConfig;
    "react-native": EslintFlatConfig;
    "tanstack-start": EslintFlatConfig;
    "tanstack-query": EslintFlatConfig;
    all: EslintFlatConfig;
  };
}

const PLUGIN_NAMESPACE = "react-doctor";
const RULE_DOCS_BASE_URL = "https://react.doctor/rules";

const recommendedRuleKeys = new Set(Object.keys(RECOMMENDED_RULES));

const toRuleSettingsKey = (ruleName: string): string =>
  ruleName.replace(/-([a-z])/g, (_match, innerChar: string) => innerChar.toUpperCase());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const buildEslintSettings = (
  context: EslintRuleContext,
  ruleName: string,
): Readonly<Record<string, unknown>> | undefined => {
  const optionSettings = context.options?.[0];
  if (!isRecord(optionSettings)) return context.settings;

  const existingReactDoctorSettings = context.settings?.["react-doctor"];
  const reactDoctorSettings = isRecord(existingReactDoctorSettings)
    ? existingReactDoctorSettings
    : {};

  return {
    ...context.settings,
    "react-doctor": {
      ...reactDoctorSettings,
      [toRuleSettingsKey(ruleName)]: optionSettings,
    },
  };
};

const wrapAsEslintRule = (ruleName: string, ruleImpl: WrappedRule): EslintRule => ({
  meta: {
    type: "problem",
    docs: {
      description: ruleName
        .replaceAll("-", " ")
        .replace(/\b\w/g, (innerChar) => innerChar.toUpperCase()),
      url: `${RULE_DOCS_BASE_URL}/${ruleName}`,
      recommended: recommendedRuleKeys.has(`${PLUGIN_NAMESPACE}/${ruleName}`),
    },
    schema: [{ type: "object", additionalProperties: true }],
  },
  create: (context: EslintRuleContext) =>
    ruleImpl.create({ ...context, settings: buildEslintSettings(context, ruleName) }),
});

const eslintShapedRules: Record<string, EslintRule> = Object.fromEntries(
  Object.entries(oxlintPlugin.rules).map(([ruleName, ruleImpl]) => [
    ruleName,
    wrapAsEslintRule(ruleName, ruleImpl),
  ]),
);

const buildFlatConfig = (
  configName: string,
  ruleSet: Record<string, OxlintRuleSeverity>,
): EslintFlatConfig => ({
  name: `react-doctor/${configName}`,
  plugins: {},
  rules: { ...ruleSet },
});

const eslintPlugin: EslintPlugin = {
  meta: {
    name: PLUGIN_NAMESPACE,
    version: process.env.VERSION ?? "0.0.0",
  },
  rules: eslintShapedRules,
  configs: {
    recommended: buildFlatConfig("recommended", RECOMMENDED_RULES),
    next: buildFlatConfig("next", NEXTJS_RULES),
    "react-native": buildFlatConfig("react-native", REACT_NATIVE_RULES),
    "tanstack-start": buildFlatConfig("tanstack-start", TANSTACK_START_RULES),
    "tanstack-query": buildFlatConfig("tanstack-query", TANSTACK_QUERY_RULES),
    all: buildFlatConfig("all", ALL_REACT_DOCTOR_RULES),
  },
};

for (const flatConfig of Object.values(eslintPlugin.configs)) {
  flatConfig.plugins[PLUGIN_NAMESPACE] = eslintPlugin;
}

export default eslintPlugin;
