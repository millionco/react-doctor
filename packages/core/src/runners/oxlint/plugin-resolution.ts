import { createRequire } from "node:module";
import path from "node:path";
import type { OxlintRuleSeverity } from "oxlint-plugin-react-doctor";

const esmRequire = createRequire(import.meta.url);

export interface JsPluginEntry {
  name: string;
  specifier: string;
}

/**
 * A user-declared oxlint plugin (via `config.plugins: [...]`),
 * resolved to an absolute file path with introspected metadata.
 * `name` is the namespace rule keys are prefixed with — sourced from
 * the plugin's `meta.name` field, falling back to a slugified
 * specifier when the plugin doesn't declare one.
 */
export interface ResolvedUserPlugin {
  readonly entry: JsPluginEntry;
  /** Rule names exported by the plugin (e.g. `"no-bare-fetch"`). */
  readonly availableRuleNames: ReadonlySet<string>;
  /** The original spec from `config.plugins`, for diagnostics. */
  readonly originalSpec: string;
}

type ReactHooksJsPluginEntry = JsPluginEntry;

interface ResolvedReactHooksJsPlugin {
  entry: ReactHooksJsPluginEntry;
  /** Rule names exported by the loaded plugin (e.g. "void-use-memo"). */
  availableRuleNames: ReadonlySet<string>;
}

interface MaybePluginModule {
  meta?: { name?: unknown };
  rules?: Record<string, unknown>;
  default?: { meta?: { name?: unknown }; rules?: Record<string, unknown> };
}

const readPluginModule = (pluginSpecifier: string): MaybePluginModule | null => {
  try {
    return esmRequire(pluginSpecifier) as MaybePluginModule;
  } catch {
    return null;
  }
};

const readPluginShape = (
  pluginModule: MaybePluginModule | null,
): { name: string | null; ruleNames: ReadonlySet<string> } => {
  if (pluginModule === null) return { name: null, ruleNames: new Set() };
  const moduleNamespace = pluginModule.default ?? pluginModule;
  const rules = moduleNamespace.rules ?? {};
  const rawName = moduleNamespace.meta?.name;
  const name = typeof rawName === "string" && rawName.length > 0 ? rawName : null;
  return { name, ruleNames: new Set(Object.keys(rules)) };
};

const slugifyUserPluginSpec = (spec: string): string => {
  const base = spec
    .split(/[/\\]/)
    .pop()!
    .replace(/\.(js|cjs|mjs|ts|cts|mts)$/i, "");
  const slug = base.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "user-plugin";
};

/**
 * Resolves a user plugin spec from `react-doctor.config.json`'s
 * `plugins: [...]` to an absolute file path. Two accepted spec
 * shapes:
 *
 * - **Relative path** (`./`, `../`, or any path with `/` not starting
 *   with a letter that npm would parse as a package): resolved
 *   relative to `configSourceDirectory` (the dir of the config file
 *   that declared it). Mirrors how `rootDir` is resolved.
 * - **npm package name**: resolved via Node module resolution from
 *   the config source directory's `node_modules`.
 *
 * Returns `null` when the spec can't be resolved or the resolved
 * module doesn't look like an oxlint plugin (no `rules` field).
 * A warning is logged in either case; the scan continues without
 * the user plugin so config typos don't block the rest of the run.
 */
export const resolveUserPlugin = (
  spec: string,
  configSourceDirectory: string,
): ResolvedUserPlugin | null => {
  const isRelative = spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec);
  const candidateRequire = createRequire(path.join(configSourceDirectory, "noop.js"));
  let resolvedSpecifier: string;
  try {
    resolvedSpecifier = isRelative
      ? path.resolve(configSourceDirectory, spec)
      : candidateRequire.resolve(spec);
  } catch (error) {
    process.stderr.write(
      `[react-doctor] config.plugins entry "${spec}" could not be resolved from ${configSourceDirectory}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return null;
  }
  const pluginModule = readPluginModule(resolvedSpecifier);
  if (pluginModule === null) {
    process.stderr.write(
      `[react-doctor] config.plugins entry "${spec}" (resolved to ${resolvedSpecifier}) failed to load — skipping.\n`,
    );
    return null;
  }
  const { name, ruleNames } = readPluginShape(pluginModule);
  if (ruleNames.size === 0) {
    process.stderr.write(
      `[react-doctor] config.plugins entry "${spec}" exports no rules (expected \`{ meta: { name }, rules: {...} }\` shape) — skipping.\n`,
    );
    return null;
  }
  const resolvedName = name ?? slugifyUserPluginSpec(spec);
  return {
    entry: { name: resolvedName, specifier: resolvedSpecifier },
    availableRuleNames: ruleNames,
    originalSpec: spec,
  };
};

export const resolveUserPlugins = (
  specs: ReadonlyArray<string> | undefined,
  configSourceDirectory: string,
): ReadonlyArray<ResolvedUserPlugin> => {
  if (!specs || specs.length === 0) return [];
  const resolved: ResolvedUserPlugin[] = [];
  const seenNames = new Set<string>();
  for (const spec of specs) {
    const plugin = resolveUserPlugin(spec, configSourceDirectory);
    if (plugin === null) continue;
    if (seenNames.has(plugin.entry.name)) {
      process.stderr.write(
        `[react-doctor] config.plugins entry "${spec}" declares duplicate plugin name "${plugin.entry.name}" — skipping. Rename via the plugin's \`meta.name\` field to load multiple variants.\n`,
      );
      continue;
    }
    seenNames.add(plugin.entry.name);
    resolved.push(plugin);
  }
  return resolved;
};

const readPluginRuleNames = (pluginSpecifier: string): ReadonlySet<string> => {
  // HACK: oxlint resolves the plugin itself at scan time; we just need
  // a fast rule-name listing to filter our config so we don't
  // reference rules that don't exist in the user's installed version
  // (e.g. older eslint-plugin-react-hooks releases do not expose every
  // compiler rule). Failing to read the module is non-fatal - we fall
  // back to enabling every rule we have
  // configured for and let oxlint surface the mismatch (which preserves
  // pre-fix behavior for unknown plugin shapes).
  try {
    const pluginModule: MaybePluginModule = esmRequire(pluginSpecifier);
    const rules = pluginModule.rules ?? pluginModule.default?.rules;
    if (rules === undefined) return new Set();
    return new Set(Object.keys(rules));
  } catch {
    return new Set();
  }
};

export const resolveReactHooksJsPlugin = (
  hasReactCompiler: boolean,
  customRulesOnly: boolean,
): ResolvedReactHooksJsPlugin | null => {
  if (!hasReactCompiler || customRulesOnly) return null;
  let pluginSpecifier: string;
  try {
    pluginSpecifier = esmRequire.resolve("eslint-plugin-react-hooks");
  } catch {
    return null;
  }
  return {
    entry: { name: "react-hooks-js", specifier: pluginSpecifier },
    availableRuleNames: readPluginRuleNames(pluginSpecifier),
  };
};

export const filterRulesToAvailable = (
  rules: Record<string, OxlintRuleSeverity>,
  pluginNamespace: string,
  availableRuleNames: ReadonlySet<string>,
): Record<string, OxlintRuleSeverity> => {
  // Empty `availableRuleNames` means we couldn't introspect the plugin
  // (e.g. exotic export shape). Fall back to the unfiltered rule set so
  // we don't silently disable rules in supported configurations.
  if (availableRuleNames.size === 0) return rules;
  const ruleKeyPrefix = `${pluginNamespace}/`;
  const filtered: Record<string, OxlintRuleSeverity> = {};
  for (const [ruleKey, severity] of Object.entries(rules)) {
    if (!ruleKey.startsWith(ruleKeyPrefix)) {
      filtered[ruleKey] = severity;
      continue;
    }
    const ruleName = ruleKey.slice(ruleKeyPrefix.length);
    if (availableRuleNames.has(ruleName)) {
      filtered[ruleKey] = severity;
    }
  }
  return filtered;
};
