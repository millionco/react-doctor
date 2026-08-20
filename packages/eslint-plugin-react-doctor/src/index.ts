import oxlintPlugin, {
  ALL_REACT_DOCTOR_RULES,
  NEXTJS_RULES,
  PREACT_RULES,
  REACT_NATIVE_RULES,
  RECOMMENDED_RULES,
  TANSTACK_QUERY_RULES,
  TANSTACK_START_RULES,
} from "oxlint-plugin-react-doctor";
import type {
  Capability,
  EsTreeNode,
  OxlintRuleSeverity,
  Rule,
  RuleVisitors,
} from "oxlint-plugin-react-doctor";

interface EslintRuleContext {
  report: (descriptor: { node: EsTreeNode; message: string }) => void;
  // https://eslint.org/blog/2023/09/preparing-custom-rules-eslint-v9/#context-methods-becoming-properties
  readonly filename?: string;
  /** @deprecated Use `filename`. Kept only for host compatibility. */
  getFilename?: () => string | undefined;
  settings?: {
    "react-doctor"?: {
      capabilities?: ReadonlyArray<string>;
    };
  };
}

interface EslintAdapterRule {
  title?: string;
  severity: "error" | "warn";
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
  settings: {
    "react-doctor": {
      portedRuleMode: "curated";
    };
  };
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
    preact: EslintFlatConfig;
    all: EslintFlatConfig;
  };
}

const PLUGIN_NAMESPACE = "react-doctor";
const RULE_DOCS_BASE_URL = "https://react.doctor/docs/rules";

const recommendedRuleKeys = new Set(Object.keys(RECOMMENDED_RULES));

const EMPTY_VISITORS: RuleVisitors = {};

const hasCapability = (
  settings: EslintRuleContext["settings"],
  capability: Capability,
): boolean => {
  const capabilities = settings?.["react-doctor"]?.capabilities;
  if (!Array.isArray(capabilities)) return false;
  return capabilities.includes(capability);
};

const shouldCreateRuleVisitors = (
  settings: EslintRuleContext["settings"],
  disabledWhen: ReadonlyArray<Capability> | undefined,
): boolean => !disabledWhen?.some((capability) => hasCapability(settings, capability));

const wrapAsEslintRule = (
  ruleName: string,
  ruleImpl: EslintAdapterRule & Pick<Rule, "disabledWhen">,
): EslintRule => ({
  meta: {
    type: ruleImpl.severity === "warn" ? "suggestion" : "problem",
    docs: {
      description:
        ruleImpl.title ??
        ruleName
          .replaceAll("-", " ")
          .replace(/\b\w/g, (innerCharacter) => innerCharacter.toUpperCase()),
      url: `${RULE_DOCS_BASE_URL}/${PLUGIN_NAMESPACE}/${ruleName}`,
      recommended: recommendedRuleKeys.has(`${PLUGIN_NAMESPACE}/${ruleName}`),
    },
    schema: [],
  },
  create: (context: EslintRuleContext) =>
    shouldCreateRuleVisitors(context.settings, ruleImpl.disabledWhen)
      ? ruleImpl.create(context)
      : EMPTY_VISITORS,
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
  settings: { "react-doctor": { portedRuleMode: "curated" } },
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
    preact: buildFlatConfig("preact", PREACT_RULES),
    all: buildFlatConfig("all", ALL_REACT_DOCTOR_RULES),
  },
};

for (const flatConfig of Object.values(eslintPlugin.configs)) {
  flatConfig.plugins[PLUGIN_NAMESPACE] = eslintPlugin;
}

export default eslintPlugin;
