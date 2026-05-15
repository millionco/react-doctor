import oxlintPlugin, {
  GLOBAL_REACT_DOCTOR_RULES,
  NEXTJS_RULES,
  REACT_NATIVE_RULES,
  TANSTACK_QUERY_RULES,
  TANSTACK_START_RULES,
} from "oxlint-plugin-react-doctor";
import type {
  EsTreeNode,
  OxlintRuleSeverity,
  Rule as PluginRule,
  RuleVisitors,
} from "oxlint-plugin-react-doctor";

interface EslintRuleContext {
  report: (descriptor: { node: EsTreeNode; message: string }) => void;
  getFilename?: () => string;
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

const recommendedRuleKeys = new Set(Object.keys(GLOBAL_REACT_DOCTOR_RULES));

const wrapAsEslintRule = (ruleName: string, ruleImpl: PluginRule): EslintRule => ({
  meta: {
    type: "problem",
    docs: {
      description: ruleName
        .replaceAll("-", " ")
        .replace(/\b\w/g, (innerChar) => innerChar.toUpperCase()),
      url: `${RULE_DOCS_BASE_URL}/${ruleName}`,
      recommended: recommendedRuleKeys.has(`${PLUGIN_NAMESPACE}/${ruleName}`),
    },
    schema: [],
  },
  create: (context: EslintRuleContext) => ruleImpl.create(context),
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

const ALL_RULES_AT_RECOMMENDED_SEVERITY: Record<string, OxlintRuleSeverity> = {
  ...GLOBAL_REACT_DOCTOR_RULES,
  ...NEXTJS_RULES,
  ...REACT_NATIVE_RULES,
  ...TANSTACK_START_RULES,
  ...TANSTACK_QUERY_RULES,
};

const eslintPlugin: EslintPlugin = {
  meta: {
    name: PLUGIN_NAMESPACE,
    version: process.env.VERSION ?? "0.0.0",
  },
  rules: eslintShapedRules,
  configs: {
    recommended: buildFlatConfig("recommended", GLOBAL_REACT_DOCTOR_RULES),
    next: buildFlatConfig("next", NEXTJS_RULES),
    "react-native": buildFlatConfig("react-native", REACT_NATIVE_RULES),
    "tanstack-start": buildFlatConfig("tanstack-start", TANSTACK_START_RULES),
    "tanstack-query": buildFlatConfig("tanstack-query", TANSTACK_QUERY_RULES),
    all: buildFlatConfig("all", ALL_RULES_AT_RECOMMENDED_SEVERITY),
  },
};

for (const flatConfig of Object.values(eslintPlugin.configs)) {
  flatConfig.plugins[PLUGIN_NAMESPACE] = eslintPlugin;
}

export default eslintPlugin;
