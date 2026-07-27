export { diagnose } from "./diagnose.js";
export { defineConfig, hasReactRuntime } from "./core-api.js";

export type {
  DiagnoseOptions,
  DiagnoseProjectsInput,
  DiagnoseProjectsResult,
  DiagnoseResult,
  Diagnostic,
  ProjectDefinition,
  ProjectInfo,
  ProjectResult,
  ProjectResultError,
  ProjectResultOk,
  ReactDoctorConfig,
  ScoreResult,
} from "./core-api.js";
export {
  ReactDoctorError,
  ProjectNotFoundError,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  NotADirectoryError,
  AmbiguousProjectError,
  isReactDoctorError,
} from "./core-api.js";
