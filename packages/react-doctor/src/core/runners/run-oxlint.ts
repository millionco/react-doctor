import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ERROR_PREVIEW_LENGTH_CHARS,
  PROXY_OUTPUT_MAX_BYTES,
  SOURCE_FILE_PATTERN,
} from "../../constants.js";
import { batchIncludePaths } from "./batch-include-paths.js";
import { canOxlintExtendConfig } from "./can-oxlint-extend-config.js";
import { collectIgnorePatterns } from "../config/collect-ignore-patterns.js";
import { detectUserLintConfigPaths } from "./detect-user-lint-config.js";
import {
  ALL_REACT_DOCTOR_RULE_KEYS,
  FRAMEWORK_SPECIFIC_RULE_KEYS,
  RULE_METADATA,
  createOxlintConfig,
} from "./oxlint-config.js";
import reactDoctorPlugin from "../../plugin/react-doctor-plugin.js";
import type { CleanedDiagnostic, Diagnostic, OxlintOutput, ProjectInfo } from "../../types.js";
import { neutralizeDisableDirectives } from "../diagnostics/neutralize-disable-directives.js";

// Reads the rule's recommendation off its `defineRule({...})` metadata
// (colocated in `plugin/rules/<bucket>/<rule>.ts`). Returns undefined when
// the rule isn't a react-doctor rule (oxlint surfaces diagnostics from
// builtin / community plugins too) or the rule simply doesn't ship a
// recommendation yet.
const getRuleRecommendation = (ruleName: string): string | undefined =>
  reactDoctorPlugin.rules[ruleName]?.recommendation;

const esmRequire = createRequire(import.meta.url);

const PLUGIN_CATEGORY_MAP: Record<string, string> = {
  react: "Correctness",
  "react-hooks": "Correctness",
  "react-hooks-js": "React Compiler",
  "react-doctor": "Other",
  "jsx-a11y": "Accessibility",
  knip: "Dead Code",
  effect: "State & Effects",
  // Plugins users commonly enable in their own oxlint / eslint config
  // and that react-doctor folds into the scan via `extends`. Sensible
  // defaults so adopted-rule diagnostics don't all collapse into the
  // generic "Other" bucket in the output grouping.
  eslint: "Correctness",
  oxc: "Correctness",
  typescript: "Correctness",
  unicorn: "Correctness",
  import: "Bundle Size",
  promise: "Correctness",
  n: "Correctness",
  node: "Correctness",
  vitest: "Correctness",
  jest: "Correctness",
  nextjs: "Next.js",
};

const RULE_CATEGORY_MAP: Record<string, string> = {
  "react-doctor/no-derived-state-effect": "State & Effects",
  "react-doctor/no-fetch-in-effect": "State & Effects",
  "react-doctor/no-mirror-prop-effect": "State & Effects",
  "react-doctor/no-mutable-in-deps": "State & Effects",
  "react-doctor/no-cascading-set-state": "State & Effects",
  "react-doctor/no-effect-chain": "State & Effects",
  "react-doctor/no-effect-event-handler": "State & Effects",
  "react-doctor/no-effect-event-in-deps": "State & Effects",
  "react-doctor/no-event-trigger-state": "State & Effects",
  "react-doctor/no-prop-callback-in-effect": "State & Effects",
  "react-doctor/no-derived-useState": "State & Effects",
  "react-doctor/no-direct-state-mutation": "State & Effects",
  "react-doctor/no-set-state-in-render": "State & Effects",
  "react-doctor/prefer-use-effect-event": "State & Effects",
  "react-doctor/prefer-useReducer": "State & Effects",
  "react-doctor/prefer-use-sync-external-store": "State & Effects",
  "react-doctor/rerender-lazy-state-init": "Performance",
  "react-doctor/rerender-functional-setstate": "Performance",
  "react-doctor/rerender-dependencies": "State & Effects",
  "react-doctor/rerender-state-only-in-handlers": "Performance",
  "react-doctor/rerender-defer-reads-hook": "Performance",
  "react-doctor/advanced-event-handler-refs": "Performance",
  "react-doctor/effect-needs-cleanup": "State & Effects",

  "react-doctor/no-generic-handler-names": "Architecture",
  "react-doctor/no-giant-component": "Architecture",
  "react-doctor/no-many-boolean-props": "Architecture",
  "react-doctor/no-react19-deprecated-apis": "Architecture",
  "react-doctor/no-render-prop-children": "Architecture",
  "react-doctor/no-render-in-render": "Architecture",
  "react-doctor/no-nested-component-definition": "Correctness",
  "react-doctor/react-compiler-destructure-method": "Architecture",
  "react-doctor/no-legacy-class-lifecycles": "Correctness",
  "react-doctor/no-legacy-context-api": "Correctness",
  "react-doctor/no-default-props": "Architecture",
  "react-doctor/no-react-dom-deprecated-apis": "Architecture",

  "react-doctor/no-usememo-simple-expression": "Performance",
  "react-doctor/no-layout-property-animation": "Performance",
  "react-doctor/rerender-memo-with-default-value": "Performance",
  "react-doctor/rerender-memo-before-early-return": "Performance",
  "react-doctor/rerender-transitions-scroll": "Performance",
  "react-doctor/rerender-derived-state-from-hook": "Performance",
  "react-doctor/async-defer-await": "Performance",
  "react-doctor/async-await-in-loop": "Performance",
  "react-doctor/rendering-animate-svg-wrapper": "Performance",
  "react-doctor/rendering-hoist-jsx": "Performance",
  "react-doctor/rendering-hydration-mismatch-time": "Correctness",
  "react-doctor/rendering-usetransition-loading": "Performance",
  "react-doctor/rendering-hydration-no-flicker": "Performance",
  "react-doctor/rendering-script-defer-async": "Performance",
  "react-doctor/no-inline-prop-on-memo-component": "Performance",

  "react-doctor/no-transition-all": "Performance",
  "react-doctor/no-global-css-variable-animation": "Performance",
  "react-doctor/no-large-animated-blur": "Performance",
  "react-doctor/no-scale-from-zero": "Performance",
  "react-doctor/no-permanent-will-change": "Performance",

  "react-doctor/no-secrets-in-client-code": "Security",

  "react-doctor/no-barrel-import": "Bundle Size",
  "react-doctor/no-dynamic-import-path": "Bundle Size",
  "react-doctor/no-full-lodash-import": "Bundle Size",
  "react-doctor/no-moment": "Bundle Size",
  "react-doctor/prefer-dynamic-import": "Bundle Size",
  "react-doctor/use-lazy-motion": "Bundle Size",
  "react-doctor/no-undeferred-third-party": "Bundle Size",

  "react-doctor/no-array-index-as-key": "Correctness",
  "react-doctor/no-polymorphic-children": "Architecture",
  "react-doctor/rendering-conditional-render": "Correctness",
  "react-doctor/rendering-svg-precision": "Performance",
  "react-doctor/no-prevent-default": "Correctness",
  "react-doctor/no-uncontrolled-input": "Correctness",
  "react-doctor/no-document-start-view-transition": "Correctness",
  "react-doctor/no-flush-sync": "Performance",
  "react-doctor/nextjs-no-img-element": "Next.js",
  "react-doctor/nextjs-async-client-component": "Next.js",
  "react-doctor/nextjs-no-a-element": "Next.js",
  "react-doctor/nextjs-no-use-search-params-without-suspense": "Next.js",
  "react-doctor/nextjs-no-client-fetch-for-server-data": "Next.js",
  "react-doctor/nextjs-missing-metadata": "Next.js",
  "react-doctor/nextjs-no-client-side-redirect": "Next.js",
  "react-doctor/nextjs-no-redirect-in-try-catch": "Next.js",
  "react-doctor/nextjs-image-missing-sizes": "Next.js",
  "react-doctor/nextjs-no-native-script": "Next.js",
  "react-doctor/nextjs-inline-script-missing-id": "Next.js",
  "react-doctor/nextjs-no-font-link": "Next.js",
  "react-doctor/nextjs-no-css-link": "Next.js",
  "react-doctor/nextjs-no-polyfill-script": "Next.js",
  "react-doctor/nextjs-no-head-import": "Next.js",
  "react-doctor/nextjs-no-side-effect-in-get-handler": "Security",

  "react-doctor/server-auth-actions": "Server",
  "react-doctor/server-after-nonblocking": "Server",
  "react-doctor/server-no-mutable-module-state": "Server",
  "react-doctor/server-cache-with-object-literal": "Server",
  "react-doctor/server-hoist-static-io": "Server",
  "react-doctor/server-dedup-props": "Server",
  "react-doctor/server-sequential-independent-await": "Server",
  "react-doctor/server-fetch-without-revalidate": "Server",

  "react-doctor/client-passive-event-listeners": "Performance",
  "react-doctor/client-localstorage-no-version": "Correctness",

  "react-doctor/query-stable-query-client": "TanStack Query",
  "react-doctor/query-no-rest-destructuring": "TanStack Query",
  "react-doctor/query-no-void-query-fn": "TanStack Query",
  "react-doctor/query-no-query-in-effect": "TanStack Query",
  "react-doctor/query-mutation-missing-invalidation": "TanStack Query",
  "react-doctor/query-no-usequery-for-mutation": "TanStack Query",

  "react-doctor/no-inline-bounce-easing": "Performance",
  "react-doctor/no-z-index-9999": "Architecture",
  "react-doctor/no-inline-exhaustive-style": "Architecture",
  "react-doctor/no-side-tab-border": "Architecture",
  "react-doctor/no-pure-black-background": "Architecture",
  "react-doctor/no-gradient-text": "Architecture",
  "react-doctor/no-dark-mode-glow": "Architecture",
  "react-doctor/no-justified-text": "Accessibility",
  "react-doctor/no-tiny-text": "Accessibility",
  "react-doctor/no-wide-letter-spacing": "Architecture",
  "react-doctor/no-gray-on-colored-background": "Accessibility",
  "react-doctor/no-layout-transition-inline": "Performance",
  "react-doctor/no-disabled-zoom": "Accessibility",
  "react-doctor/no-outline-none": "Accessibility",
  "react-doctor/no-long-transition-duration": "Performance",

  "react-doctor/design-no-bold-heading": "Architecture",
  "react-doctor/design-no-redundant-padding-axes": "Architecture",
  "react-doctor/design-no-redundant-size-axes": "Architecture",
  "react-doctor/design-no-space-on-flex-children": "Architecture",
  "react-doctor/design-no-three-period-ellipsis": "Architecture",
  "react-doctor/design-no-default-tailwind-palette": "Architecture",
  "react-doctor/design-no-vague-button-label": "Accessibility",

  "react-doctor/js-flatmap-filter": "Performance",
  "react-doctor/js-combine-iterations": "Performance",
  "react-doctor/js-tosorted-immutable": "Performance",
  "react-doctor/js-hoist-regexp": "Performance",
  "react-doctor/js-hoist-intl": "Performance",
  "react-doctor/js-cache-property-access": "Performance",
  "react-doctor/js-length-check-first": "Performance",
  "react-doctor/js-min-max-loop": "Performance",
  "react-doctor/js-set-map-lookups": "Performance",
  "react-doctor/js-batch-dom-css": "Performance",
  "react-doctor/js-index-maps": "Performance",
  "react-doctor/js-cache-storage": "Performance",
  "react-doctor/js-early-exit": "Performance",

  "react-doctor/no-eval": "Security",

  "react-doctor/async-parallel": "Performance",

  "react-doctor/rn-no-raw-text": "React Native",
  "react-doctor/rn-no-deprecated-modules": "React Native",
  "react-doctor/rn-no-legacy-expo-packages": "React Native",
  "react-doctor/rn-no-dimensions-get": "React Native",
  "react-doctor/rn-no-inline-flatlist-renderitem": "React Native",
  "react-doctor/rn-no-legacy-shadow-styles": "React Native",
  "react-doctor/rn-prefer-reanimated": "React Native",
  "react-doctor/rn-no-single-element-style-array": "React Native",
  "react-doctor/rn-prefer-pressable": "React Native",
  "react-doctor/rn-prefer-expo-image": "React Native",
  "react-doctor/rn-no-non-native-navigator": "React Native",
  "react-doctor/rn-no-scroll-state": "React Native",
  "react-doctor/rn-no-scrollview-mapped-list": "React Native",
  "react-doctor/rn-no-inline-object-in-list-item": "React Native",
  "react-doctor/rn-animate-layout-property": "React Native",
  "react-doctor/rn-prefer-content-inset-adjustment": "React Native",
  "react-doctor/rn-pressable-shared-value-mutation": "React Native",
  "react-doctor/rn-list-data-mapped": "React Native",
  "react-doctor/rn-list-callback-per-row": "React Native",
  "react-doctor/rn-list-recyclable-without-types": "React Native",
  "react-doctor/rn-animation-reaction-as-derived": "React Native",
  "react-doctor/rn-bottom-sheet-prefer-native": "React Native",
  "react-doctor/rn-scrollview-dynamic-padding": "React Native",
  "react-doctor/rn-style-prefer-boxshadow": "React Native",

  "react-doctor/tanstack-start-route-property-order": "TanStack Start",
  "react-doctor/tanstack-start-no-direct-fetch-in-loader": "TanStack Start",
  "react-doctor/tanstack-start-server-fn-validate-input": "TanStack Start",
  "react-doctor/tanstack-start-no-useeffect-fetch": "TanStack Start",
  "react-doctor/tanstack-start-missing-head-content": "TanStack Start",
  "react-doctor/tanstack-start-no-anchor-element": "TanStack Start",
  "react-doctor/tanstack-start-server-fn-method-order": "TanStack Start",
  "react-doctor/tanstack-start-no-navigate-in-render": "TanStack Start",
  "react-doctor/tanstack-start-no-dynamic-server-fn-import": "TanStack Start",
  "react-doctor/tanstack-start-no-use-server-in-handler": "TanStack Start",
  "react-doctor/tanstack-start-no-secrets-in-loader": "Security",
  "react-doctor/tanstack-start-get-mutation": "Security",
  "react-doctor/tanstack-start-redirect-in-try-catch": "TanStack Start",
  "react-doctor/tanstack-start-loader-parallel-fetch": "Performance",
};

const FILEPATH_WITH_LOCATION_PATTERN = /\S+\.\w+:\d+:\d+[\s\S]*$/;

const REACT_COMPILER_MESSAGE = "React Compiler can't optimize this code";

// HACK: `Object.hasOwn` guards against falling through to
// `Object.prototype` when oxlint emits a rule whose name happens to
// shadow a base Object property (`constructor`, `toString`, …). Without
// the guard the rule's help text would render as
// `function Object() { [native code] }`. Same defense applied to the
// plugin-/rule-category lookups below.
const lookupOwnString = (record: Record<string, string>, key: string): string | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const cleanDiagnosticMessage = (
  message: string,
  help: string,
  plugin: string,
  rule: string,
): CleanedDiagnostic => {
  if (plugin === "react-hooks-js") {
    const rawMessage = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
    return { message: REACT_COMPILER_MESSAGE, help: rawMessage || help };
  }
  const cleaned = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
  return { message: cleaned || message, help: help || getRuleRecommendation(rule) || "" };
};

const parseRuleCode = (code: string): { plugin: string; rule: string } => {
  const match = code.match(/^(.+)\((.+)\)$/);
  if (!match) return { plugin: "unknown", rule: code };
  return { plugin: match[1].replace(/^eslint-plugin-/, ""), rule: match[2] };
};

const resolveOxlintBinary = (): string => {
  const oxlintMainPath = esmRequire.resolve("oxlint");
  const oxlintPackageDirectory = path.resolve(path.dirname(oxlintMainPath), "..");
  return path.join(oxlintPackageDirectory, "bin", "oxlint");
};

const resolvePluginPath = (): string => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const pluginPath = path.join(currentDirectory, "react-doctor-plugin.js");
  if (fs.existsSync(pluginPath)) return pluginPath;

  // `src/core/runners/run-oxlint.ts` is 3 levels deep under the package root,
  // so the built plugin sits at `../../../dist/react-doctor-plugin.js`.
  const distPluginPath = path.resolve(currentDirectory, "../../../dist/react-doctor-plugin.js");
  if (fs.existsSync(distPluginPath)) return distPluginPath;

  return pluginPath;
};

const resolveDiagnosticCategory = (plugin: string, rule: string): string => {
  const ruleKey = `${plugin}/${rule}`;
  return (
    lookupOwnString(RULE_CATEGORY_MAP, ruleKey) ??
    lookupOwnString(PLUGIN_CATEGORY_MAP, plugin) ??
    "Other"
  );
};

// HACK: Sanitize child env so a developer's NODE_OPTIONS=--inspect (or
// --max-old-space-size=128, etc.) doesn't leak into oxlint and either spawn a
// debugger port or starve it of memory. We also drop npm_config_* lifecycle
// vars to keep oxlint from picking up package-manager state. PATH, HOME,
// NODE_ENV, NODE_PATH, etc. pass through unchanged.
const SANITIZED_ENV: NodeJS.ProcessEnv = (() => {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "NODE_OPTIONS" || name === "NODE_DEBUG") continue;
    if (name.startsWith("npm_config_")) continue;
    sanitized[name] = value;
  }
  return sanitized;
})();

const OXLINT_SPAWN_TIMEOUT_MS = 5 * 60_000;

const spawnOxlint = (
  args: string[],
  rootDirectory: string,
  nodeBinaryPath: string,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(nodeBinaryPath, args, {
      cwd: rootDirectory,
      env: SANITIZED_ENV,
    });

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `oxlint did not return within ${OXLINT_SPAWN_TIMEOUT_MS / 1000}s — please report`,
        ),
      );
    }, OXLINT_SPAWN_TIMEOUT_MS);
    timeoutHandle.unref?.();

    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];
    let stdoutByteCount = 0;
    let stderrByteCount = 0;
    let didKillForSize = false;

    const killIfTooLarge = (incomingBytes: number, isStdout: boolean): boolean => {
      if (isStdout) {
        stdoutByteCount += incomingBytes;
      } else {
        stderrByteCount += incomingBytes;
      }
      if (stdoutByteCount + stderrByteCount > PROXY_OUTPUT_MAX_BYTES && !didKillForSize) {
        didKillForSize = true;
        child.kill("SIGKILL");
        return true;
      }
      return false;
    };

    child.stdout.on("data", (buffer: Buffer) => {
      if (didKillForSize) return;
      stdoutBuffers.push(buffer);
      killIfTooLarge(buffer.length, true);
    });
    child.stderr.on("data", (buffer: Buffer) => {
      if (didKillForSize) return;
      stderrBuffers.push(buffer);
      killIfTooLarge(buffer.length, false);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to run oxlint: ${error.message}`));
    });
    child.on("close", (_code, signal) => {
      clearTimeout(timeoutHandle);
      if (didKillForSize) {
        reject(
          new Error(
            `oxlint output exceeded ${PROXY_OUTPUT_MAX_BYTES} bytes — scan a smaller subset with --diff or --staged`,
          ),
        );
        return;
      }
      if (signal) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        const hint =
          signal === "SIGABRT" ? " (out of memory — try scanning fewer files with --diff)" : "";
        const detail = stderrOutput ? `: ${stderrOutput}` : "";
        reject(new Error(`oxlint was killed by ${signal}${hint}${detail}`));
        return;
      }
      const output = Buffer.concat(stdoutBuffers).toString("utf-8").trim();
      if (!output) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        if (stderrOutput) {
          reject(new Error(`Failed to run oxlint: ${stderrOutput}`));
          return;
        }
      }
      resolve(output);
    });
  });

const isOxlintOutput = (value: unknown): value is OxlintOutput => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { diagnostics?: unknown };
  return Array.isArray(candidate.diagnostics);
};

const parseOxlintOutput = (stdout: string): Diagnostic[] => {
  if (!stdout) return [];

  // HACK: oxlint sometimes prepends a notice line to stdout (e.g. when
  // every input was ignored — "No files found to lint. Please check…").
  // Skip any leading non-JSON noise by jumping to the first `{` we see;
  // the remainder is the actual report. Locale- and wording-agnostic.
  const jsonStart = stdout.indexOf("{");
  const sanitizedStdout = jsonStart > 0 ? stdout.slice(jsonStart) : stdout;

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizedStdout);
  } catch {
    throw new Error(
      `Failed to parse oxlint output: ${stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)}`,
    );
  }

  if (!isOxlintOutput(parsed)) {
    throw new Error(
      `Unexpected oxlint output shape: ${stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)}`,
    );
  }
  const output = parsed;

  // HACK: oxlint reports diagnostics for every JS/TS extension it
  // scanned (`.ts`, `.tsx`, `.js`, `.jsx`). The previous filter only
  // kept `.tsx` / `.jsx` — fine when react-doctor's curated rules were
  // the only sources (they're React-specific anyway), but adopted
  // user rules like `eslint/no-debugger` or `unicorn/*` typically
  // fire on plain `.ts` / `.js` files; dropping those silently
  // erased their score impact. SOURCE_FILE_PATTERN matches the same
  // extensions we count as source files everywhere else.
  return output.diagnostics
    .filter((diagnostic) => diagnostic.code && SOURCE_FILE_PATTERN.test(diagnostic.filename))
    .map((diagnostic) => {
      const { plugin, rule } = parseRuleCode(diagnostic.code);
      const primaryLabel = diagnostic.labels[0];

      const cleaned = cleanDiagnosticMessage(diagnostic.message, diagnostic.help, plugin, rule);

      return {
        filePath: diagnostic.filename,
        plugin,
        rule,
        severity: diagnostic.severity,
        message: cleaned.message,
        help: cleaned.help,
        url: diagnostic.url,
        line: primaryLabel?.span.line ?? 0,
        column: primaryLabel?.span.column ?? 0,
        category: resolveDiagnosticCategory(plugin, rule),
      };
    });
};

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"];

const resolveTsConfigRelativePath = (rootDirectory: string): string | null => {
  for (const filename of TSCONFIG_FILENAMES) {
    if (fs.existsSync(path.join(rootDirectory, filename))) {
      return `./${filename}`;
    }
  }
  return null;
};

interface RunOxlintOptions {
  rootDirectory: string;
  project: ProjectInfo;
  includePaths?: string[];
  nodeBinaryPath?: string;
  customRulesOnly?: boolean;
  respectInlineDisables?: boolean;
  adoptExistingLintConfig?: boolean;
  ignoredTags?: ReadonlySet<string>;
}

let didValidateRuleRegistration = false;

const validateRuleRegistration = (): void => {
  if (didValidateRuleRegistration) return;
  didValidateRuleRegistration = true;
  const missingHelp: string[] = [];
  const missingCategory: string[] = [];
  const missingMetadata: string[] = [];
  for (const fullKey of ALL_REACT_DOCTOR_RULE_KEYS) {
    const ruleName = fullKey.replace(/^react-doctor\//, "");
    if (!Object.hasOwn(RULE_CATEGORY_MAP, fullKey)) {
      missingCategory.push(fullKey);
    }
    if (!getRuleRecommendation(ruleName)) {
      missingHelp.push(fullKey);
    }
    if (FRAMEWORK_SPECIFIC_RULE_KEYS.has(fullKey) && !RULE_METADATA.has(fullKey)) {
      missingMetadata.push(fullKey);
    }
  }
  if (missingCategory.length > 0 || missingHelp.length > 0 || missingMetadata.length > 0) {
    const detail = [
      missingCategory.length > 0
        ? `Missing RULE_CATEGORY_MAP entries: ${missingCategory.join(", ")}`
        : null,
      missingHelp.length > 0
        ? `Missing rule recommendations (add to defineRule call): ${missingHelp.join(", ")}`
        : null,
      missingMetadata.length > 0
        ? `Missing RULE_METADATA entries: ${missingMetadata.join(", ")}`
        : null,
    ]
      .filter((entry): entry is string => entry !== null)
      .join("; ");
    // HACK: warn rather than throw — never block the user's scan over a metadata gap.
    console.warn(`[react-doctor] rule-registration drift: ${detail}`);
  }
};

export const runOxlint = async (options: RunOxlintOptions): Promise<Diagnostic[]> => {
  const {
    rootDirectory,
    project,
    includePaths,
    nodeBinaryPath = process.execPath,
    customRulesOnly = false,
    respectInlineDisables = true,
    adoptExistingLintConfig = true,
    ignoredTags = new Set<string>(),
  } = options;

  validateRuleRegistration();

  if (includePaths !== undefined && includePaths.length === 0) {
    return [];
  }

  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxlintrc-"));
  const configPath = path.join(configDirectory, "oxlintrc.json");
  const pluginPath = resolvePluginPath();
  // HACK: pass user lint configs to oxlint as absolute paths. oxlint's
  // docs say `extends` is "resolved relative to the configuration file
  // that declares extends," but a literal `path.relative(configDir, ...)`
  // breaks when the OS resolves symlinked tmp dirs (e.g. macOS's
  // `/var/folders/.../T/...` actually lives under `/private/var/...`,
  // so a `../../../...` walk from the symlink view doesn't equal the
  // same walk from the canonical view and oxlint's NotFound errors
  // out). Absolute paths sidestep the whole symlink dance — oxlint
  // accepts them and they're stable across runtimes. We skip extends
  // entirely under `customRulesOnly` because that mode opts out of
  // every rule outside the react-doctor plugin.
  const detectedConfigPaths =
    adoptExistingLintConfig && !customRulesOnly ? detectUserLintConfigPaths(rootDirectory) : [];
  // HACK: filter out `.eslintrc.json` files whose `extends` lists only
  // bare-package refs (`"next"`, `"airbnb"`, `"plugin:foo/bar"`). oxlint's
  // resolver can't follow those — adopting them guarantees the parser
  // crash + misleading "could not adopt existing lint config" warning.
  // Drop them up front so the scan starts in the same state the fallback
  // would land in, with no stderr noise.
  const extendsPaths = detectedConfigPaths.filter(canOxlintExtendConfig);
  const config = createOxlintConfig({
    pluginPath,
    project,
    customRulesOnly,
    extendsPaths,
    ignoredTags,
  });
  // HACK: only neutralize disable comments in audit mode. Default
  // behavior respects the user's existing `// eslint-disable*` /
  // `// oxlint-disable*` directives — we let oxlint apply them.
  const restoreDisableDirectives = respectInlineDisables
    ? () => {}
    : neutralizeDisableDirectives(rootDirectory, includePaths);

  try {
    const oxlintBinary = resolveOxlintBinary();
    const baseArgs = [oxlintBinary, "-c", configPath, "--format", "json"];

    if (project.hasTypeScript) {
      const tsconfigRelativePath = resolveTsConfigRelativePath(rootDirectory);
      if (tsconfigRelativePath) {
        baseArgs.push("--tsconfig", tsconfigRelativePath);
      }
    }

    // HACK: pass every ignore source via a single combined `--ignore-path`
    // file (cheap on `baseArgs` length) rather than N `--ignore-pattern`
    // entries (which would inflate per-batch arg length and shrink the
    // file-count budget on large diffs). The combined file MUST include
    // `.eslintignore` patterns because `--ignore-path` overrides oxlint's
    // automatic `.eslintignore` lookup — that responsibility now lives
    // in `collectIgnorePatterns`.
    const combinedPatterns = collectIgnorePatterns(rootDirectory);
    if (combinedPatterns.length > 0) {
      const combinedIgnorePath = path.join(configDirectory, "combined.ignore");
      fs.writeFileSync(combinedIgnorePath, `${combinedPatterns.join("\n")}\n`);
      baseArgs.push("--ignore-path", combinedIgnorePath);
    }

    const fileBatches =
      includePaths !== undefined ? batchIncludePaths(baseArgs, includePaths) : [["."]];

    const writeOxlintConfig = (configToWrite: ReturnType<typeof createOxlintConfig>): void => {
      // HACK: fs.rm + open(wx) (instead of plain open(w)) so we keep
      // the original "fail if a stale file exists at this exact path"
      // safety net while still allowing the retry-without-extends
      // fallback below to overwrite our own config in place.
      fs.rmSync(configPath, { force: true });
      const fileHandle = fs.openSync(configPath, "wx", 0o600);
      try {
        fs.writeFileSync(fileHandle, JSON.stringify(configToWrite));
      } finally {
        fs.closeSync(fileHandle);
      }
    };

    const spawnLintBatches = async (): Promise<Diagnostic[]> => {
      const allDiagnostics: Diagnostic[] = [];
      for (const batch of fileBatches) {
        const batchArgs = [...baseArgs, ...batch];
        const stdout = await spawnOxlint(batchArgs, rootDirectory, nodeBinaryPath);
        allDiagnostics.push(...parseOxlintOutput(stdout));
      }
      return allDiagnostics;
    };

    writeOxlintConfig(config);
    try {
      return await spawnLintBatches();
    } catch (error) {
      // HACK: if the user's adopted lint config is the reason oxlint
      // crashed (broken JSON, missing plugin, unknown rule), failing
      // the entire lint pass would leave the user with a 100/100
      // score off zero diagnostics — a worse outcome than running our
      // curated rules without their extras. Retry once without
      // `extends` and keep the scan useful. The retry is silent: a
      // mid-output stderr warning was noisy enough that users took it
      // as react-doctor itself crashing; the curated-rules scan is the
      // graceful path.
      if (extendsPaths.length === 0) throw error;
      const fallbackConfig = createOxlintConfig({
        pluginPath,
        project,
        customRulesOnly,
        extendsPaths: [],
        ignoredTags,
      });
      writeOxlintConfig(fallbackConfig);
      return await spawnLintBatches();
    }
  } finally {
    restoreDisableDirectives();
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }
};
