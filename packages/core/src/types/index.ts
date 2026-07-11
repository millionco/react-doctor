export type {
  BlockingLevel,
  DiagnosticSurface,
  ReactDoctorConfig,
  ReactDoctorIgnoreOverride,
  RuleSeverityControls,
  RuleSeverityOverride,
  ScopeValue,
  SurfaceControls,
} from "./config.js";
export type {
  DiagnoseOptions,
  DiagnoseProjectsInput,
  DiagnoseProjectsResult,
  DiagnoseResult,
  ProjectDefinition,
  ProjectResult,
  ProjectResultError,
  ProjectResultOk,
} from "./diagnose.js";
export type {
  CleanedDiagnostic,
  Diagnostic,
  DiagnosticFileContext,
  DiagnosticRelatedLocation,
  OxlintOutput,
  SourceFileEntry,
  SuppressedRuleCount,
} from "./diagnostic.js";
export type { HandleErrorOptions } from "./handle-error.js";
export type {
  ChangedFileLineRanges,
  DiffInfo,
  InspectOptions,
  InspectResult,
  JsonReport,
  JsonReportDiagnosticV3,
  JsonReportDiffInfo,
  JsonReportError,
  JsonReportMode,
  JsonReportProjectEntry,
  JsonReportProjectEntryV3,
  JsonReportSummary,
  JsonReportV1,
  JsonReportV2,
  JsonReportV3,
} from "./inspect.js";
export type {
  DependencyInfo,
  Framework,
  PackageJson,
  ProjectInfo,
  WorkspacePackage,
} from "./project-info.js";
export type { PromptMultiselectChoiceState, PromptMultiselectContext } from "./prompts.js";
// `isReactNativeDependencyName` / `REACT_NATIVE_DEPENDENCY_NAMES`
// are intentionally NOT re-exported here — re-exporting from
// `oxlint-plugin-react-doctor` would force every consumer of the
// types barrel (including `discoverProject`) to load the entire
// 286-rule plugin at module-init time. The project-discovery side
// owns a tiny standalone copy in
// `core/src/project-info/rn-metadata.ts`;
// rule-side consumers import from the plugin package directly.
// See that file for the duplication rationale.
export type { ScoreResult, RulePriority, RuleTier } from "./score.js";
