import fs from "node:fs";
import path from "node:path";
import { collectIgnorePatterns } from "../collect-ignore-patterns.js";
import { readIgnoreFile } from "../read-ignore-file.js";
import { isRecord } from "../utils/is-record.js";

interface KnipWorkspaceConfig {
  readonly entry?: unknown;
  readonly ignore?: unknown;
}

interface KnipConfig {
  readonly entry?: unknown;
  readonly ignore?: unknown;
  readonly workspaces?: unknown;
}

const KNIP_JSON_FILENAME = "knip.json";

const readJsonFileSafe = (filePath: string): unknown | null => {
  let rawContents: string;
  try {
    rawContents = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(rawContents);
  } catch {
    return null;
  }
};

const readKnipConfig = (rootDirectory: string): KnipConfig | null => {
  const knipJson = readJsonFileSafe(path.join(rootDirectory, KNIP_JSON_FILENAME));
  if (isRecord(knipJson)) return knipJson;

  const packageJson = readJsonFileSafe(path.join(rootDirectory, "package.json"));
  const packageKnipConfig = isRecord(packageJson) ? packageJson.knip : null;
  return isRecord(packageKnipConfig) ? packageKnipConfig : null;
};

const normalizePatternList = (value: unknown): string[] => {
  if (typeof value === "string" && value.length > 0) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
};

const prefixWorkspacePatterns = (
  workspacePattern: string,
  patterns: ReadonlyArray<string>,
): string[] => {
  const normalizedWorkspacePattern = workspacePattern.replace(/\/+$/, "");
  return patterns.map((pattern) =>
    pattern.startsWith("!")
      ? `!${normalizedWorkspacePattern}/${pattern.slice(1)}`
      : `${normalizedWorkspacePattern}/${pattern}`,
  );
};

const collectKnipWorkspacePatterns = (
  workspaces: unknown,
  settingName: keyof KnipWorkspaceConfig,
): string[] => {
  if (!isRecord(workspaces)) return [];
  const patterns: string[] = [];
  for (const [workspacePattern, workspaceConfig] of Object.entries(workspaces)) {
    if (!isRecord(workspaceConfig)) continue;
    patterns.push(
      ...prefixWorkspacePatterns(
        workspacePattern,
        normalizePatternList(workspaceConfig[settingName]),
      ),
    );
  }
  return patterns;
};

const collectKnipPatterns = (
  rootDirectory: string,
  settingName: keyof Pick<KnipConfig, "entry" | "ignore">,
): string[] => {
  const config = readKnipConfig(rootDirectory);
  if (!config) return [];
  return [
    ...normalizePatternList(config[settingName]),
    ...collectKnipWorkspacePatterns(config.workspaces, settingName),
  ];
};

// `ignore.files` is intentionally excluded: it suppresses *reporting* (via the
// diagnostic pipeline), so those files must stay in deslop's graph or a file
// imported only by an ignored file is falsely flagged unused (react-doctor#830).
export const collectDeadCodeIgnorePatterns = (rootDirectory: string): string[] => {
  const seen = new Set<string>();
  const sources = [
    readIgnoreFile(path.join(rootDirectory, ".gitignore")),
    collectIgnorePatterns(rootDirectory),
    collectKnipPatterns(rootDirectory, "ignore"),
  ];
  for (const source of sources) {
    for (const pattern of source) seen.add(pattern);
  }
  return [...seen].filter((pattern) => pattern.length > 0);
};

export const collectDeadCodeEntryPatterns = (rootDirectory: string): string[] =>
  [...new Set(collectKnipPatterns(rootDirectory, "entry"))].filter((pattern) => pattern.length > 0);
