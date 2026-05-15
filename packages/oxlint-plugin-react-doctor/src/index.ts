import reactDoctorPlugin from "./plugin/react-doctor-plugin.js";

export default reactDoctorPlugin;

export {
  ALL_REACT_DOCTOR_RULE_KEYS,
  FRAMEWORK_SPECIFIC_RULE_KEYS,
  GLOBAL_REACT_DOCTOR_RULES,
  NEXTJS_RULES,
  REACT_NATIVE_RULES,
  TANSTACK_QUERY_RULES,
  TANSTACK_START_RULES,
} from "./rules-by-framework.js";

export { MOTION_LIBRARY_PACKAGES } from "./plugin/constants/style.js";

export type { OxlintRuleSeverity } from "./types.js";
export type { EsTreeNode } from "./plugin/utils/es-tree-node.js";
export type { Rule, RuleFramework, RuleSeverity } from "./plugin/utils/rule.js";
export type { RulePlugin } from "./plugin/utils/rule-plugin.js";
export type { RuleVisitors } from "./plugin/utils/rule-visitors.js";
