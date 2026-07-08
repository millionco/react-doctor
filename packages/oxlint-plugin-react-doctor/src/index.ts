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

export { CROSS_FILE_RULE_IDS } from "./plugin/constants/cross-file-rule-ids.js";

export {
  CROSS_FILE_DEPENDENCY_COLLECTORS,
  UNBOUNDED_CROSS_FILE_RULE_IDS,
  collectCrossFileDependencyProbes,
} from "./plugin/cross-file-dependencies.js";
export type { CrossFileProbeTrace } from "./plugin/utils/cross-file-probe-recorder.js";

// Per-scan invalidation for the nearest-package.json memos. The memos are
// sound while a scan's filesystem is frozen, but a long-lived host (the LSP
// server) must drop them between scans — core's `runOxlint` calls this at
// every scan start.
export { resetManifestCaches } from "./plugin/utils/read-nearest-package-manifest.js";

export {
  classifySecurityScanFile,
  shouldReadSecurityScanContent,
} from "./plugin/rules/security-scan/utils/classify-security-scan-file.js";

export {
  REACT_NATIVE_DEPENDENCY_NAMES,
  REACT_NATIVE_DEPENDENCY_PREFIXES,
  isReactNativeDependencyName,
} from "./react-native-dependency-names.js";

export type { OxlintRuleSeverity } from "./types.js";
export { FRAMEWORK_TOKENS } from "./plugin/utils/capability.js";
export type { Capability, CapabilityQuery, FrameworkToken } from "./plugin/utils/capability.js";
export type { EsTreeNode } from "./plugin/utils/es-tree-node.js";
export type { ScanFinding, FileScan, ScannedFile } from "./plugin/utils/file-scan.js";
export type { Rule, RuleFramework, RuleSeverity } from "./plugin/utils/rule.js";
export type { RulePlugin } from "./plugin/utils/rule-plugin.js";
export type { RuleVisitors } from "./plugin/utils/rule-visitors.js";
