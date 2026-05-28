export { diagnose, diagnoseProjects } from "./diagnose.js";

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
} from "@react-doctor/core";
export {
  ReactDoctorError,
  ProjectNotFoundError,
  NoReactDependencyError,
  PackageJsonNotFoundError,
  NotADirectoryError,
  AmbiguousProjectError,
  isReactDoctorError,
} from "@react-doctor/core";
