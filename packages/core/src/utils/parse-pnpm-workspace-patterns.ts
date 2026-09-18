import { parseYAML } from "confbox";
import { isRecord } from "./is-record.js";

export const parsePnpmWorkspacePatternsFromContent = (yamlContent: string): string[] => {
  const workspaceConfig = parseYAML<unknown>(yamlContent);
  if (!isRecord(workspaceConfig) || !Array.isArray(workspaceConfig.packages)) return [];

  return workspaceConfig.packages.filter(
    (packagePattern): packagePattern is string =>
      typeof packagePattern === "string" && !packagePattern.startsWith("!"),
  );
};
