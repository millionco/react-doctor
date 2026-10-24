import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { hasStandardReactJsxConfiguration } from "../../../utils/resolve-tsconfig-alias.js";

export const hasCurrentContextRecordEnvironment = (filename: string): boolean =>
  hasStandardReactJsxConfiguration(filename) &&
  !resolveModulePath(filename, "react") &&
  !resolveModulePath(filename, "react/jsx-runtime") &&
  !resolveModulePath(filename, "react/jsx-dev-runtime");
