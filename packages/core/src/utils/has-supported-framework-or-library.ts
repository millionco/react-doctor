import type { Capability } from "oxlint-plugin-react-doctor/core";
import { buildCapabilities } from "../project-info/capabilities.js";
import type { ProjectInfo } from "../types/index.js";

const AMBIENT_PROJECT_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "unknown",
  "typescript",
  "pre-es2023",
]);

export const hasSupportedFrameworkOrLibrary = (project: ProjectInfo): boolean => {
  for (const capability of buildCapabilities(project)) {
    if (!AMBIENT_PROJECT_CAPABILITIES.has(capability)) return true;
  }
  return false;
};
