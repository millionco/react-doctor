export { diagnose, diagnoseModules } from "./diagnose.js";

export type {
  DiagnoseModulesOptions,
  DiagnoseModulesResult,
  DiagnoseOptions,
  DiagnoseResult,
  Diagnostic,
  ModuleDefinition,
  ModuleError,
  ModuleResult,
  ProjectInfo,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";
export {
  ReactDoctorError,
  ProjectNotFoundError,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  AmbiguousProjectError,
  isReactDoctorError,
} from "@react-doctor/core";
