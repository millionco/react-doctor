import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectOverrideMappingsFromRecord } from "./collect-override-mappings-from-record.js";

interface OverrideMapping {
  fromPackage: string;
  toPackage: string;
}

const PNPM_WORKSPACE_FILENAMES = ["pnpm-workspace.yaml", "pnpm-workspace.yml"] as const;

interface ParsedYamlMapping {
  entries: Record<string, unknown>;
  endLineIndex: number;
}

const parseIndentedYamlMapping = (
  lines: string[],
  startLineIndex: number,
  sectionIndent: number,
): ParsedYamlMapping => {
  const entries: Record<string, unknown> = {};
  let lineIndex = startLineIndex;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      lineIndex++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent <= sectionIndent) break;

    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) {
      lineIndex++;
      continue;
    }

    const key = trimmedLine
      .slice(0, colonIndex)
      .trim()
      .replace(/^["']|["']$/g, "");
    const rawValue = trimmedLine.slice(colonIndex + 1).trim();

    if (!key) {
      lineIndex++;
      continue;
    }

    if (rawValue.length === 0) {
      const nestedMapping = parseIndentedYamlMapping(lines, lineIndex + 1, indent);
      entries[key] = nestedMapping.entries;
      lineIndex = nestedMapping.endLineIndex;
      continue;
    }

    entries[key] = rawValue.replace(/^["']|["']$/g, "");
    lineIndex++;
  }

  return { entries, endLineIndex: lineIndex };
};

const parsePnpmWorkspaceOverrideRecords = (yamlContent: string): Record<string, unknown>[] => {
  const lines = yamlContent.split("\n");
  const overrideRecords: Record<string, unknown>[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const trimmedLine = lines[lineIndex].trim();
    if (trimmedLine !== "overrides:") continue;

    const sectionIndent = lines[lineIndex].length - lines[lineIndex].trimStart().length;
    const parsedMapping = parseIndentedYamlMapping(lines, lineIndex + 1, sectionIndent);
    if (Object.keys(parsedMapping.entries).length > 0) {
      overrideRecords.push(parsedMapping.entries);
    }
  }

  return overrideRecords;
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
