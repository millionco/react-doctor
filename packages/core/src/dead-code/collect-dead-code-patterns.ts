import path from "node:path";
import { collectIgnorePatterns } from "../collect-ignore-patterns.js";
import { readIgnoreFile } from "../read-ignore-file.js";
import { failOpenReadJson } from "../utils/fail-open-read-json.js";
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

const readKnipConfig = (rootDirectory: string): KnipConfig | null => {
  const knipJson = failOpenReadJson<unknown | null>(
    path.join(rootDirectory, KNIP_JSON_FILENAME),
    null,
  );
  if (isRecord(knipJson)) return knipJson;

  const packageJson = failOpenReadJson<unknown | null>(
    path.join(rootDirectory, "package.json"),
    null,
  );
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
