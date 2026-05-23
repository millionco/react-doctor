export { diagnose } from "./diagnose.js";

export type {
  DiagnoseOptions,
  DiagnoseResult,
  Diagnostic,
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
