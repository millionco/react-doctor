import {
  BUILD_CONFIG_FILE_PATTERN,
  SERVER_CONTEXT_PATTERN,
} from "../../../constants/security-scan.js";
import { isProductionSourcePath } from "./is-production-source-path.js";

export const isClientSourcePath = (relativePath: string): boolean => {
  if (!isProductionSourcePath(relativePath)) return false;
  if (SERVER_CONTEXT_PATTERN.test(relativePath)) return false;
  if (BUILD_CONFIG_FILE_PATTERN.test(relativePath)) return false;
  return true;
};
