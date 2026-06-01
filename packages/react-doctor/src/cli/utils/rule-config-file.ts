import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_SCHEMA_URL, clearConfigCache, loadConfigWithSource } from "@react-doctor/core";
import type { ReactDoctorConfig } from "@react-doctor/core";

const CONFIG_FILENAME = "react-doctor.config.json";
const PACKAGE_JSON_FILENAME = "package.json";
const PACKAGE_JSON_CONFIG_KEY = "reactDoctor";
const JSON_INDENT_SPACES = 2;

export type RuleConfigTargetKind = "config-file" | "package-json";

export interface RuleConfigTarget {
  readonly kind: RuleConfigTargetKind;
  /** Absolute path of the file that holds (or will hold) the config. */
  readonly filePath: string;
  /** Directory containing `filePath`. */
  readonly directory: string;
  /** Whether the config (standalone file or `package.json` key) already exists. */
  readonly exists: boolean;
  /** Current config object — empty when nothing exists yet. */
  readonly config: ReactDoctorConfig;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonObject = (filePath: string): Record<string, unknown> | null => {
  if (!existsSync(filePath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Decides where a rule-config mutation should be written. Discovery
 * mirrors the scanner: it reuses `loadConfigWithSource` (which walks up
 * to the project boundary, preferring `react-doctor.config.json` over a
 * `package.json#reactDoctor` block) so edits land in the same file the
 * scan reads. When nothing exists yet, a fresh `react-doctor.config.json`
 * is targeted at `projectRoot`. The raw on-disk object is returned (not
 * the validated config) so unrelated fields round-trip untouched.
 */
export const resolveRuleConfigTarget = (projectRoot: string): RuleConfigTarget => {
  // HACK: the loader memoizes by directory, so a second in-process call
  // (tests, multi-command flows) would read a stale config written by an
  // earlier call. A fresh CLI process has an empty cache, so this clear is
  // a no-op in production and only matters for repeated in-process reads.
  clearConfigCache();
  const loaded = loadConfigWithSource(projectRoot);

  if (loaded) {
    const directory = loaded.sourceDirectory;
    const configFilePath = path.join(directory, CONFIG_FILENAME);
    if (existsSync(configFilePath)) {
      return {
        kind: "config-file",
        filePath: configFilePath,
        directory,
        exists: true,
        config: readJsonObject(configFilePath) ?? {},
      };
    }
    const packageJsonPath = path.join(directory, PACKAGE_JSON_FILENAME);
    const packageJson = readJsonObject(packageJsonPath) ?? {};
    const embeddedConfig = packageJson[PACKAGE_JSON_CONFIG_KEY];
    return {
      kind: "package-json",
      filePath: packageJsonPath,
      directory,
      exists: true,
      config: isPlainObject(embeddedConfig) ? embeddedConfig : {},
    };
  }

  return {
    kind: "config-file",
    filePath: path.join(projectRoot, CONFIG_FILENAME),
    directory: projectRoot,
    exists: false,
    config: {},
  };
};

export const writeRuleConfig = (target: RuleConfigTarget, nextConfig: ReactDoctorConfig): void => {
  if (target.kind === "config-file") {
    // Re-key so `$schema` serializes first, defaulting it to the canonical
    // schema URL so editors light up autocomplete on freshly-created files.
    const { $schema, ...rest } = nextConfig;
    const serialized = JSON.stringify(
      { $schema: $schema ?? CONFIG_SCHEMA_URL, ...rest },
      null,
      JSON_INDENT_SPACES,
    );
    writeFileSync(target.filePath, `${serialized}\n`);
  } else {
    const packageJson = readJsonObject(target.filePath) ?? {};
    const serialized = JSON.stringify(
      { ...packageJson, [PACKAGE_JSON_CONFIG_KEY]: nextConfig },
      null,
      JSON_INDENT_SPACES,
    );
    writeFileSync(target.filePath, `${serialized}\n`);
  }
  // Drop the now-stale cached config so a follow-up scan in the same
  // process picks up the new severities.
  clearConfigCache();
};
