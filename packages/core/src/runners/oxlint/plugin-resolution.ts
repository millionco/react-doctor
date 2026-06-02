import { createRequire } from "node:module";
import path from "node:path";
import type { OxlintRuleSeverity } from "oxlint-plugin-react-doctor";
import { warnConfigIssue } from "../../utils/warn-config-issue.js";

export interface JsPluginEntry {
  name: string;
  specifier: string;
}

/**
 * Shape an oxlint plugin module is expected to export. Marked
 * structurally permissive (`Record<string, unknown>` for rules,
 * `unknown` for `meta.name`) because the module crosses our trust
 * boundary — the introspection helper validates before we use the
 * shape downstream.
 */
interface MaybePluginModule {
  meta?: { name?: unknown };
  rules?: Record<string, unknown>;
  default?: MaybePluginModule;
}

interface PluginShape {
  /** Plugin's declared `meta.name` (the namespace for rule keys), or `null`. */
  readonly name: string | null;
  /** Rule names exported by the plugin (e.g. `"void-use-memo"`). */
  readonly ruleNames: ReadonlySet<string>;
}

/**
 * Loads a plugin module via the local require resolver and extracts
 * `(name, ruleNames)` from either `module.exports.meta + rules` or
 * the `module.exports.default.meta + rules` ESM shape. Returns a
 * shape with empty `ruleNames` when the module can't be loaded or
 * doesn't expose a `rules` field — callers check `ruleNames.size`
 * to decide whether the plugin is usable.
 */
const readPluginShape = (
  pluginSpecifier: string,
  loadModule: (specifier: string) => unknown,
): PluginShape => {
  let pluginModule: MaybePluginModule;
  try {
    pluginModule = loadModule(pluginSpecifier) as MaybePluginModule;
  } catch {
    return { name: null, ruleNames: new Set() };
  }
  const moduleNamespace = pluginModule.default ?? pluginModule;
  const rules = moduleNamespace.rules ?? {};
  const rawName = moduleNamespace.meta?.name;
  const name = typeof rawName === "string" && rawName.length > 0 ? rawName : null;
  return { name, ruleNames: new Set(Object.keys(rules)) };
};

interface ResolvedReactHooksJsPlugin {
  entry: JsPluginEntry;
  /** Rule names exported by the loaded plugin (e.g. "void-use-memo"). */
  availableRuleNames: ReadonlySet<string>;
}

const bundledRequire = createRequire(import.meta.url);

/**
 * Resolves the React-Compiler-backed `react-hooks-js/*` rules plugin: the native
 * `@react-doctor/compiler-native` plugin, an in-house Rust + oxc reimplementation
 * of `babel-plugin-react-compiler`'s analyzer (no `eslint-plugin-react-hooks` /
 * `babel-plugin-react-compiler` runtime dependency). Returns `null` when the
 * native addon can't be loaded — e.g. a platform without a prebuilt `.node` — in
 * which case the React Compiler rules are simply not registered (a graceful no-op,
 * the same path as when the plugin was historically absent), never a crash.
 */
export const resolveReactHooksJsPlugin = (
  hasReactCompiler: boolean,
  customRulesOnly: boolean,
): ResolvedReactHooksJsPlugin | null => {
  if (!hasReactCompiler || customRulesOnly) return null;
  let pluginSpecifier: string;
  try {
    pluginSpecifier = bundledRequire.resolve("@react-doctor/compiler-native/plugin.js");
  } catch {
    return null;
  }
  const { ruleNames } = readPluginShape(pluginSpecifier, (spec) => bundledRequire(spec));
  if (ruleNames.size === 0) return null;
  return {
    entry: { name: "react-hooks-js", specifier: pluginSpecifier },
    availableRuleNames: ruleNames,
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

/**
 * A user-declared oxlint plugin (via `config.plugins: [...]`),
 * resolved to an absolute file path with introspected metadata.
 */
export interface ResolvedUserPlugin {
  readonly entry: JsPluginEntry;
  readonly availableRuleNames: ReadonlySet<string>;
  /** The original spec from `config.plugins`, for diagnostics. */
  readonly originalSpec: string;
}

/**
 * Resolves a user plugin spec from `react-doctor.config.json`'s
 * `plugins: [...]` to an absolute file path. Two accepted spec
 * shapes:
 *
 * - **Relative path** (`./`, `../`, or absolute): resolved relative
 *   to `configSourceDirectory` (the dir of the config file that
 *   declared it). Mirrors how `rootDir` is resolved.
 * - **npm package name**: resolved via Node module resolution from
 *   the config source directory's `node_modules`.
 *
 * Returns `null` (with a warning) when the spec can't be resolved,
 * the module doesn't expose any rules, or `meta.name` is missing.
 * `meta.name` is required — there's no slug fallback — so rule
 * keys in `config.rules` can't silently change when a file gets
 * renamed.
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
    warnConfigIssue(
      `config.plugins entry "${spec}" could not be resolved from ${configSourceDirectory}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  const { name, ruleNames } = readPluginShape(resolvedSpecifier, (target) =>
    candidateRequire(target),
  );
  if (ruleNames.size === 0) {
    warnConfigIssue(
      `config.plugins entry "${spec}" (resolved to ${resolvedSpecifier}) exports no rules (expected \`{ meta: { name }, rules: {...} }\` shape) — skipping.`,
    );
    return null;
  }
  if (name === null) {
    warnConfigIssue(
      `config.plugins entry "${spec}" is missing \`meta.name\` — add \`module.exports = { meta: { name: "..." }, rules: {...} }\` so rule keys in \`config.rules\` resolve. Skipping.`,
    );
    return null;
  }
  return {
    entry: { name, specifier: resolvedSpecifier },
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
      warnConfigIssue(
        `config.plugins entry "${spec}" declares duplicate plugin name "${plugin.entry.name}" — skipping. Rename via \`meta.name\` to load multiple variants.`,
      );
      continue;
    }
    seenNames.add(plugin.entry.name);
    resolved.push(plugin);
  }
  return resolved;
};
