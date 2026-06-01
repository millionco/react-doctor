import { writeFileSync } from "node:fs";
import path from "node:path";
import { generateCode, loadFile, writeFile } from "magicast";
import { getConfigFromVariableDeclaration, getDefaultExportOptions } from "magicast/helpers";
import {
  CONFIG_SCHEMA_URL,
  clearConfigCache,
  isPlainObject,
  loadConfigWithSource,
} from "@react-doctor/core";
import type { ReactDoctorConfig, ReactDoctorConfigFormat } from "@react-doctor/core";
import { readObjectFile } from "./read-object-file.js";

const NEW_CONFIG_FILENAME = "doctor.config.json";
const PACKAGE_JSON_CONFIG_KEY = "reactDoctor";
const JSON_INDENT_SPACES = 2;
// The only config sections the `rules` commands manage. When editing a
// module config (.ts/.js) we sync exactly these keys onto the file so the
// user's other config and formatting survive.
const MANAGED_KEYS = ["rules", "categories", "ignore"] as const satisfies ReadonlyArray<
  keyof ReactDoctorConfig
>;

export interface RuleConfigTarget {
  readonly format: ReactDoctorConfigFormat;
  /** Absolute path of the file to edit (or create). */
  readonly filePath: string;
  readonly directory: string;
  /** Whether the config already exists. */
  readonly exists: boolean;
  /** Current config object — empty when nothing exists yet. */
  readonly config: ReactDoctorConfig;
}

export interface WriteRuleConfigResult {
  /** `false` when a dynamic module config couldn't be edited automatically. */
  readonly written: boolean;
}

/**
 * Decides where a rule-config mutation should be written. Discovery
 * reuses `loadConfigWithSource` (the loader the scan uses) so edits land
 * in the file the scan reads — `doctor.config.{ts,js,…}` is preferred,
 * then `package.json#reactDoctor`. When nothing exists, a fresh
 * `doctor.config.json` is targeted at `projectRoot`. Data configs are
 * re-read raw so unrelated fields round-trip untouched.
 */
export const resolveRuleConfigTarget = async (projectRoot: string): Promise<RuleConfigTarget> => {
  // HACK: the loader memoizes by directory, so a second in-process call
  // (tests, multi-command flows) would read a stale config written by an
  // earlier call. A fresh CLI process has an empty cache, so this clear is
  // a no-op in production and only matters for repeated in-process reads.
  clearConfigCache();
  const loaded = await loadConfigWithSource(projectRoot);

  if (loaded) {
    if (loaded.format === "package-json") {
      const packageJson = readObjectFile(loaded.configFilePath) ?? {};
      const embedded = packageJson[PACKAGE_JSON_CONFIG_KEY];
      return {
        format: "package-json",
        filePath: loaded.configFilePath,
        directory: loaded.sourceDirectory,
        exists: true,
        config: isPlainObject(embedded) ? embedded : {},
      };
    }
    if (loaded.format === "json") {
      return {
        format: "json",
        filePath: loaded.configFilePath,
        directory: loaded.sourceDirectory,
        exists: true,
        config: readObjectFile(loaded.configFilePath) ?? {},
      };
    }
    // Module config (.ts/.js/…): magicast edits the file in place, so the
    // validated loaded config is enough as the mutation base.
    return {
      format: "module",
      filePath: loaded.configFilePath,
      directory: loaded.sourceDirectory,
      exists: true,
      config: loaded.config,
    };
  }

  return {
    format: "json",
    filePath: path.join(projectRoot, NEW_CONFIG_FILENAME),
    directory: projectRoot,
    exists: false,
    config: {},
  };
};

const writeJsonConfig = (filePath: string, nextConfig: ReactDoctorConfig): void => {
  // Re-key so `$schema` serializes first, defaulting it to the canonical
  // schema URL so editors light up autocomplete on freshly-created files.
  const { $schema, ...rest } = nextConfig;
  const serialized = JSON.stringify(
    { $schema: $schema ?? CONFIG_SCHEMA_URL, ...rest },
    null,
    JSON_INDENT_SPACES,
  );
  writeFileSync(filePath, `${serialized}\n`);
};

const writePackageJsonConfig = (filePath: string, nextConfig: ReactDoctorConfig): void => {
  const packageJson = readObjectFile(filePath) ?? {};
  const serialized = JSON.stringify(
    { ...packageJson, [PACKAGE_JSON_CONFIG_KEY]: nextConfig },
    null,
    JSON_INDENT_SPACES,
  );
  writeFileSync(filePath, `${serialized}\n`);
};

type ConfigVariableDeclaration = ReturnType<typeof getConfigFromVariableDeclaration>;

// Syncs only the managed sections onto a magicast-proxied object so the user's
// other config and formatting survive.
const syncManagedKeys = (target: Record<string, unknown>, nextConfig: ReactDoctorConfig): void => {
  for (const key of MANAGED_KEYS) {
    const value = nextConfig[key];
    if (value === undefined) {
      if (target[key] !== undefined) delete target[key];
    } else {
      target[key] = value;
    }
  }
};

// magicast re-parses a source string assigned into an AST slot, but its
// `@babel/types` signatures model that slot as a node — so the generated
// object source is assigned through a single contained cast.
const assignNodeSource = <Owner, Key extends keyof Owner>(
  owner: Owner,
  key: Key,
  code: string,
): void => {
  owner[key] = code as Owner[Key];
};

// `const config = {...}; export default config;` — magicast can't edit the
// identifier default in place, so we edit a parsed copy of the const's
// initializer and splice it back onto the declaration, mirroring magicast's
// own variable-declaration helpers. Returns false for initializer shapes we
// don't recognize so the caller can fall back to manual edits.
const editVariableDeclarationConfig = (
  declaration: ConfigVariableDeclaration["declaration"],
  config: NonNullable<ConfigVariableDeclaration["config"]>,
  nextConfig: ReactDoctorConfig,
): boolean => {
  syncManagedKeys(config, nextConfig);
  const initializer = declaration.init;
  if (!initializer) return false;
  const generatedSource = generateCode(config).code;
  if (initializer.type === "ObjectExpression") {
    assignNodeSource(declaration, "init", generatedSource);
    return true;
  }
  if (
    initializer.type === "TSSatisfiesExpression" &&
    initializer.expression.type === "ObjectExpression"
  ) {
    assignNodeSource(initializer, "expression", generatedSource);
    return true;
  }
  return false;
};

// Edits a TS/JS config via magicast, syncing only the managed sections so the
// rest of the file (other options, comments, formatting) survives. Handles the
// object-literal / `satisfies` / wrapped default export plus the
// `export default <const>` indirection. Returns false when the default export
// isn't a statically-editable object (e.g. a dynamic function config) — the
// caller then prints the change for the user to apply by hand.
const writeModuleConfig = async (
  filePath: string,
  nextConfig: ReactDoctorConfig,
): Promise<boolean> => {
  try {
    const module = await loadFile(filePath);
    if (module.exports.default?.$type === "identifier") {
      const { declaration, config } = getConfigFromVariableDeclaration(module);
      if (!config || !editVariableDeclarationConfig(declaration, config, nextConfig)) return false;
    } else {
      syncManagedKeys(getDefaultExportOptions(module), nextConfig);
    }
    await writeFile(module, filePath);
    return true;
  } catch {
    return false;
  }
};

export const writeRuleConfig = async (
  target: RuleConfigTarget,
  nextConfig: ReactDoctorConfig,
): Promise<WriteRuleConfigResult> => {
  if (target.format === "module") {
    const written = await writeModuleConfig(target.filePath, nextConfig);
    if (written) clearConfigCache();
    return { written };
  }
  if (target.format === "package-json") {
    writePackageJsonConfig(target.filePath, nextConfig);
  } else {
    writeJsonConfig(target.filePath, nextConfig);
  }
  // Drop the now-stale cached config so a follow-up scan in the same
  // process picks up the new severities.
  clearConfigCache();
  return { written: true };
};
