export type {
  DiagnosticSurface,
  FailOnLevel,
  ReactDoctorConfig,
  ReactDoctorIgnoreOverride,
  RuleSeverityControls,
  RuleSeverityOverride,
  SurfaceControls,
} from "./config.js";
export type { DiagnoseOptions, DiagnoseResult } from "./diagnose.js";
export type { CleanedDiagnostic, Diagnostic, OxlintOutput } from "./diagnostic.js";
export type { HandleErrorOptions } from "./handle-error.js";
export type {
  DiffInfo,
  InspectOptions,
  InspectResult,
  JsonReport,
  JsonReportDiffInfo,
  JsonReportError,
  JsonReportMode,
  JsonReportProjectEntry,
  JsonReportSummary,
} from "./inspect.js";
export type {
  DependencyInfo,
  Framework,
  PackageJson,
  ProjectInfo,
  WorkspacePackage,
} from "./project-info.js";
export type { PromptMultiselectChoiceState, PromptMultiselectContext } from "./prompts.js";
// `REACT_NATIVE_DEPENDENCY_NAMES` / `isReactNativeDependencyName`
// live in `oxlint-plugin-react-doctor` (the heaviest consumer — the
// per-file rule gate). Re-exported here so core consumers can import
// the constant without reaching into the plugin package directly,
// and so this index keeps its role as the one-stop shared-types
// barrel for the workspace.
export {
  REACT_NATIVE_DEPENDENCY_NAMES,
  REACT_NATIVE_DEPENDENCY_PREFIXES,
  isReactNativeDependencyName,
} from "oxlint-plugin-react-doctor";
export type { ScoreResult } from "./score.js";
