import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYAML } from "confbox";
import {
  collectOverrideMappingsFromRecord,
  type OverrideMapping,
} from "./collect-override-mappings-from-record.js";

const PNPM_WORKSPACE_FILENAMES = ["pnpm-workspace.yaml", "pnpm-workspace.yml"] as const;

const parsePnpmWorkspaceOverrideRecords = (yamlContent: string): Record<string, unknown>[] => {
  const workspaceConfig = parseYAML<unknown>(yamlContent);
  if (
    !workspaceConfig ||
    typeof workspaceConfig !== "object" ||
    Array.isArray(workspaceConfig) ||
    !("overrides" in workspaceConfig) ||
    !workspaceConfig.overrides ||
    typeof workspaceConfig.overrides !== "object" ||
    Array.isArray(workspaceConfig.overrides)
  ) {
    return [];
  }

  return [Object.fromEntries(Object.entries(workspaceConfig.overrides))];
};

export const collectPnpmWorkspaceOverrideMappings = (rootDir: string): OverrideMapping[] => {
  const mappings: OverrideMapping[] = [];

  for (const workspaceFilename of PNPM_WORKSPACE_FILENAMES) {
    const workspacePath = join(rootDir, workspaceFilename);
    if (!existsSync(workspacePath)) continue;

    try {
      const yamlContent = readFileSync(workspacePath, "utf-8");
      const overrideRecords = parsePnpmWorkspaceOverrideRecords(yamlContent);
      for (const overrideRecord of overrideRecords) {
        mappings.push(...collectOverrideMappingsFromRecord(overrideRecord));
      }
    } catch {
      continue;
    }
  }

  return mappings;
};
