import { CORE_REACT_DOCTOR_RULES, CORE_RULE_REGISTRY } from "./plugin/core-rule-registry.js";

export { EXTERNAL_RULES, REACT_COMPILER_RULES } from "./external-rules.js";

export const REACT_DOCTOR_RULES = CORE_REACT_DOCTOR_RULES;
export const REACT_DOCTOR_PROJECT_RULES = CORE_REACT_DOCTOR_RULES.filter(
  (entry) => entry.rule.isProjectRule === true,
);
export const REACT_DOCTOR_OPT_IN_PROJECT_RULE_IDS: ReadonlySet<string> = new Set(
  REACT_DOCTOR_PROJECT_RULES.filter((entry) => entry.rule.defaultEnabled === false).map(
    (entry) => entry.id,
  ),
);
export const REACT_DOCTOR_RULE_REGISTRY = CORE_RULE_REGISTRY;
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set(
  CORE_REACT_DOCTOR_RULES.map((entry) => entry.key),
);
export const FRAMEWORK_SPECIFIC_RULE_KEYS: ReadonlySet<string> = new Set(
  CORE_REACT_DOCTOR_RULES.filter((entry) => entry.rule.framework !== "global").map(
    (entry) => entry.key,
  ),
);

export { MOTION_LIBRARY_PACKAGES } from "./plugin/constants/style.js";
export { CROSS_FILE_RULE_IDS } from "./plugin/constants/cross-file-rule-ids.js";
export {
  CROSS_FILE_DEPENDENCY_COLLECTORS,
  UNBOUNDED_CROSS_FILE_RULE_IDS,
  collectCrossFileDependencyProbes,
} from "./plugin/cross-file-dependencies.js";
export type { CrossFileProbeTrace } from "./plugin/utils/cross-file-probe-recorder.js";
export { reactDoctorScanRules as REACT_DOCTOR_SCAN_RULES } from "./plugin/security-scan-rule-registry.js";
export { resetFilesystemCaches as resetManifestCaches } from "./plugin/utils/reset-filesystem-caches.js";

export {
  classifySecurityScanFile,
  shouldReadSecurityScanContent,
} from "./plugin/rules/security-scan/utils/classify-security-scan-file.js";

export {
  REACT_NATIVE_DEPENDENCY_NAMES,
  REACT_NATIVE_DEPENDENCY_PREFIXES,
  isReactNativeDependencyName,
} from "./react-native-dependency-names.js";

export { FRAMEWORK_TOKENS } from "./plugin/utils/capability.js";
export type { Capability, CapabilityQuery, FrameworkToken } from "./plugin/utils/capability.js";
export type { CoreRuleMetadata } from "./plugin/utils/core-rule-metadata.js";
export type { EsTreeNode } from "./plugin/utils/es-tree-node.js";
export type { FileScan, ScanFinding, ScannedFile } from "./plugin/utils/file-scan.js";
export type { Rule, RuleExecution, RuleFramework, RuleSeverity } from "./plugin/utils/rule.js";
export type { OxlintRuleSeverity } from "./types.js";
