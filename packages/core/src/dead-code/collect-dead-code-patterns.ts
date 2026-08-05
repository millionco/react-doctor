import * as fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
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

const KNIP_CONFIG_BASENAME = "knip.config";
const KNIP_CONFIG_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs"] as const;
const KNIP_JSON_FILENAME = "knip.json";

const jiti = createJiti(import.meta.url);

const loadKnipModuleConfig = async (filePath: string): Promise<unknown> => {
  try {
    const imported = await jiti.import<{ default?: unknown }>(filePath);
    return imported?.default ?? imported;
  } catch {
    return null;
  }
};

const readKnipConfig = async (rootDirectory: string): Promise<KnipConfig | null> => {
  for (const extension of KNIP_CONFIG_EXTENSIONS) {
    const configPath = path.join(rootDirectory, `${KNIP_CONFIG_BASENAME}.${extension}`);
    if (fs.existsSync(configPath)) {
      const loaded = await loadKnipModuleConfig(configPath);
      if (isRecord(loaded)) return loaded;
    }
  }

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

const collectKnipPatterns = async (
  rootDirectory: string,
  settingName: keyof Pick<KnipConfig, "entry" | "ignore">,
): Promise<string[]> => {
  const config = await readKnipConfig(rootDirectory);
  if (!config) return [];
  return [
    ...normalizePatternList(config[settingName]),
    ...collectKnipWorkspacePatterns(config.workspaces, settingName),
  ];
};

// `ignore.files` is intentionally excluded: it suppresses *reporting* (via the
// diagnostic pipeline), so those files must stay in deslop's graph or a file
// imported only by an ignored file is falsely flagged unused (react-doctor#830).
export const collectDeadCodeIgnorePatterns = async (rootDirectory: string): Promise<string[]> => {
  const seen = new Set<string>();
  const sources = [
    readIgnoreFile(path.join(rootDirectory, ".gitignore")),
    collectIgnorePatterns(rootDirectory),
    await collectKnipPatterns(rootDirectory, "ignore"),
  ];
  for (const source of sources) {
    for (const pattern of source) seen.add(pattern);
  }
  return [...seen].filter((pattern) => pattern.length > 0);
};

export const collectDeadCodeEntryPatterns = async (
  rootDirectory: string,
): Promise<string[]> =>
  [...new Set(await collectKnipPatterns(rootDirectory, "entry"))].filter(
    (pattern) => pattern.length > 0,
  );
