import reactDoctorPlugin from "../../../plugin/react-doctor-plugin.js";
import { buildCapabilities, shouldEnableRule } from "./capabilities.js";
import {
  filterRulesToAvailable,
  resolveReactHooksJsPlugin,
  resolveYouMightNotNeedEffectPlugin,
  YOU_MIGHT_NOT_NEED_EFFECT_NAMESPACE,
} from "./plugin-resolution.js";
import type { JsPluginEntry } from "./plugin-resolution.js";
import {
  BUILTIN_A11Y_RULES,
  BUILTIN_REACT_RULES,
  REACT_COMPILER_RULES,
  YOU_MIGHT_NOT_NEED_EFFECT_RULES,
} from "./external-plugin-rules.js";
import type { OxlintConfigOptions, RuleSeverity } from "./types.js";

export const createOxlintConfig = ({
  pluginPath,
  project,
  customRulesOnly = false,
  extendsPaths = [],
  ignoredTags = new Set<string>(),
}: OxlintConfigOptions) => {
  const reactHooksJsPlugin = resolveReactHooksJsPlugin(project.hasReactCompiler, customRulesOnly);
  const reactCompilerRules = reactHooksJsPlugin
    ? filterRulesToAvailable(
        REACT_COMPILER_RULES,
        "react-hooks-js",
        reactHooksJsPlugin.availableRuleNames,
      )
    : {};

  const youMightNotNeedEffectPlugin = resolveYouMightNotNeedEffectPlugin(customRulesOnly);
  const youMightNotNeedEffectRules = youMightNotNeedEffectPlugin
    ? filterRulesToAvailable(
        YOU_MIGHT_NOT_NEED_EFFECT_RULES,
        YOU_MIGHT_NOT_NEED_EFFECT_NAMESPACE,
        youMightNotNeedEffectPlugin.availableRuleNames,
      )
    : {};

  const jsPlugins: JsPluginEntry[] = [];
  if (reactHooksJsPlugin) jsPlugins.push(reactHooksJsPlugin.entry);
  if (youMightNotNeedEffectPlugin) jsPlugins.push(youMightNotNeedEffectPlugin.entry);

  const capabilities = buildCapabilities(project);

  const enabledReactDoctorRules: Record<string, RuleSeverity> = {};
  for (const [ruleId, rule] of Object.entries(reactDoctorPlugin.rules)) {
    const fullKey = `react-doctor/${ruleId}`;
    // Framework-specific rules MUST opt in via a `requires` capability
    // (e.g. `requires: ["nextjs"]`). Global rules ship without `requires`
    // and activate unconditionally once any tag filters pass.
    if (rule.framework !== "global" && !rule.requires) continue;
    if (!shouldEnableRule(rule.requires, rule.tags, capabilities, ignoredTags)) continue;
    enabledReactDoctorRules[fullKey] = rule.severity;
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
    plugins: customRulesOnly ? [] : ["react", "jsx-a11y"],
    jsPlugins: [...jsPlugins, pluginPath],
    rules: {
      ...(customRulesOnly ? {} : BUILTIN_REACT_RULES),
      ...(customRulesOnly ? {} : BUILTIN_A11Y_RULES),
      ...reactCompilerRules,
      ...youMightNotNeedEffectRules,
      ...enabledReactDoctorRules,
    },
  };
};
