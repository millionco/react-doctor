import reactDoctorPlugin from "./plugin/react-doctor-plugin.js";

export default reactDoctorPlugin;

export {
  ALL_REACT_DOCTOR_RULE_KEYS,
  ALL_REACT_DOCTOR_RULES,
  EXTERNAL_RULES,
  FRAMEWORK_SPECIFIC_RULE_KEYS,
  NEXTJS_RULES,
  PREACT_RULES,
  REACT_COMPILER_RULES,
  REACT_DOCTOR_RULES,
  REACT_NATIVE_RULES,
  RECOMMENDED_RULES,
  RULES,
  TANSTACK_QUERY_RULES,
  TANSTACK_START_RULES,
} from "./rules.js";

export { MOTION_LIBRARY_PACKAGES } from "./plugin/constants/style.js";

export {
  REACT_NATIVE_DEPENDENCY_NAMES,
  REACT_NATIVE_DEPENDENCY_PREFIXES,
  isReactNativeDependencyName,
} from "./react-native-dependency-names.js";

export type { OxlintRuleSeverity } from "./types.js";
export type { EsTreeNode } from "./plugin/utils/es-tree-node.js";
export type { Rule, RuleFramework, RuleSeverity } from "./plugin/utils/rule.js";
export type { RulePlugin } from "./plugin/utils/rule-plugin.js";
export type { RuleVisitors } from "./plugin/utils/rule-visitors.js";
