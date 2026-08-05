import { createJiti } from "jiti";
import path from "node:path";
import { collectIgnorePatterns } from "../collect-ignore-patterns.js";
import { isFile } from "../project-info/index.js";
import { readIgnoreFile } from "../read-ignore-file.js";
import { importDefaultExport } from "../utils/import-default-export.js";
import { isRecord } from "../utils/is-record.js";
import { readJson5File } from "../utils/read-json5-file.js";
import { KNIP_CONFIG_FILENAMES, KNIP_DATA_CONFIG_FILENAMES } from "./knip-config-filenames.js";

interface KnipWorkspaceConfig {
  readonly entry?: unknown;
  readonly ignore?: unknown;
}

interface KnipConfig {
  readonly entry?: unknown;
  readonly ignore?: unknown;
  readonly workspaces?: unknown;
}

interface DeadCodePatterns {
  readonly entryPatterns: ReadonlyArray<string>;
  readonly ignorePatterns: ReadonlyArray<string>;
}

const jiti = createJiti(import.meta.url, { moduleCache: false });

const resolveKnipConfigExport = async (configExport: unknown): Promise<KnipConfig | null> => {
  const config = typeof configExport === "function" ? await configExport() : await configExport;
  return isRecord(config) ? config : null;
};

const loadKnipConfigFile = async (
  configFilename: string,
  filePath: string,
): Promise<KnipConfig | null> => {
  try {
    const configExport = KNIP_DATA_CONFIG_FILENAMES.has(configFilename)
      ? readJson5File(filePath)
      : await importDefaultExport(jiti, filePath);
    return await resolveKnipConfigExport(configExport);
  } catch {
    return null;
  }
};

const loadKnipConfig = async (rootDirectory: string): Promise<KnipConfig | null> => {
  for (const configFilename of KNIP_CONFIG_FILENAMES) {
    const filePath = path.join(rootDirectory, configFilename);
    if (!isFile(filePath)) continue;
    const config = await loadKnipConfigFile(configFilename, filePath);
    if (config) return config;
  }

  try {
    const packageJson = readJson5File(path.join(rootDirectory, "package.json"));
    const packageKnipConfig = isRecord(packageJson) ? packageJson.knip : null;
    return isRecord(packageKnipConfig) ? packageKnipConfig : null;
  } catch {
    return null;
  }
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
  config: KnipConfig | null,
  settingName: keyof Pick<KnipConfig, "entry" | "ignore">,
): string[] => {
  if (!config) return [];
  return [
    ...normalizePatternList(config[settingName]),
    ...collectKnipWorkspacePatterns(config.workspaces, settingName),
  ];
};

// `ignore.files` is intentionally excluded: it suppresses reporting through
// the diagnostic pipeline, so ignored importers must stay in the graph and
// keep their imported files reachable (react-doctor#830).
const collectDeadCodeIgnorePatterns = (
  rootDirectory: string,
  config: KnipConfig | null,
): string[] => {
  const seen = new Set<string>();
  const sources = [
    readIgnoreFile(path.join(rootDirectory, ".gitignore")),
    collectIgnorePatterns(rootDirectory),
    collectKnipPatterns(config, "ignore"),
  ];
  for (const source of sources) {
    for (const pattern of source) seen.add(pattern);
  }
  return [...seen].filter((pattern) => pattern.length > 0);
};

const collectDeadCodeEntryPatterns = (config: KnipConfig | null): string[] =>
  [...new Set(collectKnipPatterns(config, "entry"))].filter((pattern) => pattern.length > 0);

export const collectDeadCodePatterns = async (rootDirectory: string): Promise<DeadCodePatterns> => {
  const config = await loadKnipConfig(rootDirectory);
  return {
    entryPatterns: collectDeadCodeEntryPatterns(config),
    ignorePatterns: collectDeadCodeIgnorePatterns(rootDirectory, config),
  };
};
