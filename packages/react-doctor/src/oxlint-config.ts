import { createRequire } from "node:module";
import { REACT_19_DEPRECATION_MIN_MAJOR, REACT_DOM_LEGACY_API_MIN_MAJOR } from "./constants.js";
import type { Framework } from "./types.js";

const esmRequire = createRequire(import.meta.url);

export type RuleSeverity = "error" | "warn" | "off";

export const NEXTJS_RULES: Record<string, RuleSeverity> = {
  "react-doctor/nextjs-no-img-element": "warn",
  "react-doctor/nextjs-async-client-component": "error",
  "react-doctor/nextjs-no-a-element": "warn",
  "react-doctor/nextjs-no-use-search-params-without-suspense": "warn",
  "react-doctor/nextjs-no-client-fetch-for-server-data": "warn",
  "react-doctor/nextjs-missing-metadata": "warn",
  "react-doctor/nextjs-no-client-side-redirect": "warn",
  "react-doctor/nextjs-no-redirect-in-try-catch": "warn",
  "react-doctor/nextjs-image-missing-sizes": "warn",
  "react-doctor/nextjs-no-native-script": "warn",
  "react-doctor/nextjs-inline-script-missing-id": "warn",
  "react-doctor/nextjs-no-font-link": "warn",
  "react-doctor/nextjs-no-css-link": "warn",
  "react-doctor/nextjs-no-polyfill-script": "warn",
  "react-doctor/nextjs-no-head-import": "error",
  "react-doctor/nextjs-no-side-effect-in-get-handler": "error",
};

export const REACT_NATIVE_RULES: Record<string, RuleSeverity> = {
  "react-doctor/rn-no-raw-text": "error",
  "react-doctor/rn-no-deprecated-modules": "error",
  "react-doctor/rn-no-legacy-expo-packages": "warn",
  "react-doctor/rn-no-dimensions-get": "warn",
  "react-doctor/rn-no-inline-flatlist-renderitem": "warn",
  "react-doctor/rn-no-legacy-shadow-styles": "warn",
  "react-doctor/rn-prefer-reanimated": "warn",
  "react-doctor/rn-no-single-element-style-array": "warn",
  "react-doctor/rn-prefer-pressable": "warn",
  "react-doctor/rn-prefer-expo-image": "warn",
  "react-doctor/rn-no-non-native-navigator": "warn",
  "react-doctor/rn-no-scroll-state": "error",
  "react-doctor/rn-no-scrollview-mapped-list": "warn",
  "react-doctor/rn-no-inline-object-in-list-item": "warn",
  "react-doctor/rn-animate-layout-property": "error",
  "react-doctor/rn-prefer-content-inset-adjustment": "warn",
  "react-doctor/rn-pressable-shared-value-mutation": "warn",
  "react-doctor/rn-list-data-mapped": "warn",
  "react-doctor/rn-list-callback-per-row": "warn",
  "react-doctor/rn-list-recyclable-without-types": "warn",
  "react-doctor/rn-animation-reaction-as-derived": "warn",
  "react-doctor/rn-bottom-sheet-prefer-native": "warn",
  "react-doctor/rn-scrollview-dynamic-padding": "warn",
  "react-doctor/rn-style-prefer-boxshadow": "warn",
};

export const TANSTACK_START_RULES: Record<string, RuleSeverity> = {
  "react-doctor/tanstack-start-route-property-order": "error",
  "react-doctor/tanstack-start-no-direct-fetch-in-loader": "warn",
  "react-doctor/tanstack-start-server-fn-validate-input": "warn",
  "react-doctor/tanstack-start-no-useeffect-fetch": "warn",
  "react-doctor/tanstack-start-missing-head-content": "warn",
  "react-doctor/tanstack-start-no-anchor-element": "warn",
  "react-doctor/tanstack-start-server-fn-method-order": "error",
  "react-doctor/tanstack-start-no-navigate-in-render": "warn",
  "react-doctor/tanstack-start-no-dynamic-server-fn-import": "error",
  "react-doctor/tanstack-start-no-use-server-in-handler": "error",
  "react-doctor/tanstack-start-no-secrets-in-loader": "error",
  "react-doctor/tanstack-start-get-mutation": "warn",
  "react-doctor/tanstack-start-redirect-in-try-catch": "warn",
  "react-doctor/tanstack-start-loader-parallel-fetch": "warn",
};

const REACT_COMPILER_RULES: Record<string, RuleSeverity> = {
  "react-hooks-js/set-state-in-render": "warn",
  "react-hooks-js/immutability": "warn",
  "react-hooks-js/refs": "warn",
  "react-hooks-js/purity": "warn",
  "react-hooks-js/hooks": "warn",
  "react-hooks-js/set-state-in-effect": "warn",
  "react-hooks-js/globals": "warn",
  "react-hooks-js/error-boundaries": "warn",
  "react-hooks-js/preserve-manual-memoization": "warn",
  "react-hooks-js/unsupported-syntax": "warn",
  "react-hooks-js/component-hook-factories": "warn",
  "react-hooks-js/static-components": "warn",
  "react-hooks-js/use-memo": "warn",
  "react-hooks-js/void-use-memo": "warn",
  "react-hooks-js/incompatible-library": "warn",
  "react-hooks-js/todo": "warn",
};

interface OxlintConfigOptions {
  pluginPath: string;
  framework: Framework;
  hasReactCompiler: boolean;
  hasTanStackQuery: boolean;
  customRulesOnly?: boolean;
  /**
   * Major version of React detected for the project (e.g. 17, 18, 19).
   * `null` means the version couldn't be parsed (workspace tags, missing
   * dep, exotic spec) — treat as "unknown, leave React-19-deprecation
   * rules enabled" to err on the side of surfacing the migration nudge.
   */
  reactMajorVersion?: number | null;
  /**
   * Absolute paths to extra configs that should be merged into the
   * generated oxlint config via the `extends` field. Used to fold the
   * user's existing `.oxlintrc.json` / `.eslintrc.json` rules into the
   * same scan so those diagnostics factor into the react-doctor score.
   */
  extendsPaths?: string[];
}

interface ReactHooksJsPluginEntry {
  name: string;
  specifier: string;
}

interface ResolvedReactHooksJsPlugin {
  entry: ReactHooksJsPluginEntry;
  /** Rule names exported by the loaded plugin (e.g. "void-use-memo"). */
  availableRuleNames: ReadonlySet<string>;
}

interface MaybePluginModule {
  rules?: Record<string, unknown>;
  default?: { rules?: Record<string, unknown> };
}

const readPluginRuleNames = (pluginSpecifier: string): ReadonlySet<string> => {
  // HACK: oxlint resolves the plugin itself at scan time; we just need
  // a fast-and-dirty rule-name listing to filter our config so we don't
  // reference rules that don't exist in the user's installed version
  // (e.g. void-use-memo lives in v7 but not v6 of eslint-plugin-react-hooks,
  // and our peer range is `^6 || ^7`). Failing to read the module is
  // non-fatal — we fall back to enabling every rule the user has us
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

const resolveReactHooksJsPlugin = (
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

const filterRulesToAvailable = (
  rules: Record<string, RuleSeverity>,
  pluginNamespace: string,
  availableRuleNames: ReadonlySet<string>,
): Record<string, RuleSeverity> => {
  // Empty `availableRuleNames` means we couldn't introspect the plugin
  // (e.g. exotic export shape). Fall back to the unfiltered rule set so
  // we don't silently disable rules in supported configurations.
  if (availableRuleNames.size === 0) return rules;
  const ruleKeyPrefix = `${pluginNamespace}/`;
  const filtered: Record<string, RuleSeverity> = {};
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

export const TANSTACK_QUERY_RULES: Record<string, RuleSeverity> = {
  "react-doctor/query-stable-query-client": "warn",
  "react-doctor/query-no-rest-destructuring": "warn",
  "react-doctor/query-no-void-query-fn": "warn",
  "react-doctor/query-no-query-in-effect": "warn",
  "react-doctor/query-mutation-missing-invalidation": "warn",
  "react-doctor/query-no-usequery-for-mutation": "warn",
};

const BUILTIN_REACT_RULES: Record<string, RuleSeverity> = {
  "react/rules-of-hooks": "error",
  "react/no-direct-mutation-state": "error",
  "react/jsx-no-duplicate-props": "error",
  "react/jsx-key": "error",
  "react/no-children-prop": "warn",
  "react/no-danger": "warn",
  "react/jsx-no-script-url": "error",
  "react/no-render-return-value": "warn",
  "react/no-string-refs": "warn",
  "react/no-is-mounted": "warn",
  "react/require-render-return": "error",
  "react/no-unknown-property": "warn",
};

const BUILTIN_A11Y_RULES: Record<string, RuleSeverity> = {
  "jsx-a11y/alt-text": "error",
  "jsx-a11y/anchor-is-valid": "warn",
  "jsx-a11y/click-events-have-key-events": "warn",
  "jsx-a11y/no-static-element-interactions": "warn",
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/no-autofocus": "warn",
  "jsx-a11y/heading-has-content": "warn",
  "jsx-a11y/html-has-lang": "warn",
  "jsx-a11y/no-redundant-roles": "warn",
  "jsx-a11y/scope": "warn",
  "jsx-a11y/tabindex-no-positive": "warn",
  "jsx-a11y/label-has-associated-control": "warn",
  "jsx-a11y/no-distracting-elements": "error",
  "jsx-a11y/iframe-has-title": "warn",
};

export const GLOBAL_REACT_DOCTOR_RULES: Record<string, RuleSeverity> = {
  "react-doctor/no-derived-state-effect": "warn",
  "react-doctor/no-fetch-in-effect": "warn",
  "react-doctor/no-cascading-set-state": "warn",
  "react-doctor/no-effect-event-handler": "warn",
  "react-doctor/no-effect-event-in-deps": "error",
  "react-doctor/no-prop-callback-in-effect": "warn",
  "react-doctor/no-derived-useState": "warn",
  "react-doctor/no-direct-state-mutation": "warn",
  "react-doctor/no-set-state-in-render": "warn",
  "react-doctor/prefer-useReducer": "warn",
  "react-doctor/prefer-use-sync-external-store": "warn",
  "react-doctor/rerender-lazy-state-init": "warn",
  "react-doctor/rerender-functional-setstate": "warn",
  "react-doctor/rerender-dependencies": "error",
  "react-doctor/rerender-state-only-in-handlers": "warn",
  "react-doctor/rerender-defer-reads-hook": "warn",
  "react-doctor/advanced-event-handler-refs": "warn",

  "react-doctor/no-giant-component": "warn",
  "react-doctor/no-render-in-render": "warn",
  "react-doctor/no-many-boolean-props": "warn",
  "react-doctor/no-react19-deprecated-apis": "warn",
  "react-doctor/no-render-prop-children": "warn",
  "react-doctor/no-nested-component-definition": "error",
  "react-doctor/react-compiler-destructure-method": "warn",
  "react-doctor/no-legacy-class-lifecycles": "error",
  "react-doctor/no-legacy-context-api": "error",
  "react-doctor/no-default-props": "warn",
  "react-doctor/no-react-dom-deprecated-apis": "warn",

  "react-doctor/no-usememo-simple-expression": "warn",
  "react-doctor/no-layout-property-animation": "error",
  "react-doctor/rerender-memo-with-default-value": "warn",
  "react-doctor/rerender-memo-before-early-return": "warn",
  "react-doctor/rerender-transitions-scroll": "warn",
  "react-doctor/rerender-derived-state-from-hook": "warn",
  "react-doctor/async-defer-await": "warn",
  "react-doctor/async-await-in-loop": "warn",
  "react-doctor/rendering-animate-svg-wrapper": "warn",
  "react-doctor/rendering-hoist-jsx": "warn",
  "react-doctor/rendering-hydration-mismatch-time": "warn",
  "react-doctor/no-inline-prop-on-memo-component": "warn",
  "react-doctor/rendering-hydration-no-flicker": "warn",
  "react-doctor/rendering-script-defer-async": "warn",
  "react-doctor/rendering-usetransition-loading": "warn",

  "react-doctor/no-transition-all": "warn",
  "react-doctor/no-global-css-variable-animation": "error",
  "react-doctor/no-large-animated-blur": "warn",
  "react-doctor/no-scale-from-zero": "warn",
  "react-doctor/no-permanent-will-change": "warn",

  "react-doctor/no-eval": "error",
  "react-doctor/no-secrets-in-client-code": "warn",

  "react-doctor/no-generic-handler-names": "warn",

  "react-doctor/js-flatmap-filter": "warn",
  "react-doctor/js-combine-iterations": "warn",
  "react-doctor/js-tosorted-immutable": "warn",
  "react-doctor/js-hoist-regexp": "warn",
  "react-doctor/js-hoist-intl": "warn",
  "react-doctor/js-cache-property-access": "warn",
  "react-doctor/js-length-check-first": "warn",
  "react-doctor/js-min-max-loop": "warn",
  "react-doctor/js-set-map-lookups": "warn",
  "react-doctor/js-batch-dom-css": "warn",
  "react-doctor/js-index-maps": "warn",
  "react-doctor/js-cache-storage": "warn",
  "react-doctor/js-early-exit": "warn",

  "react-doctor/no-barrel-import": "warn",
  "react-doctor/no-dynamic-import-path": "warn",
  "react-doctor/no-full-lodash-import": "warn",
  "react-doctor/no-moment": "warn",
  "react-doctor/prefer-dynamic-import": "warn",
  "react-doctor/use-lazy-motion": "warn",
  "react-doctor/no-undeferred-third-party": "warn",

  "react-doctor/no-array-index-as-key": "warn",
  "react-doctor/no-polymorphic-children": "warn",
  "react-doctor/rendering-conditional-render": "warn",
  "react-doctor/rendering-svg-precision": "warn",
  "react-doctor/no-prevent-default": "warn",
  "react-doctor/no-uncontrolled-input": "warn",
  "react-doctor/no-document-start-view-transition": "warn",
  "react-doctor/no-flush-sync": "warn",

  "react-doctor/server-auth-actions": "error",
  "react-doctor/server-after-nonblocking": "warn",
  "react-doctor/server-no-mutable-module-state": "error",
  "react-doctor/server-cache-with-object-literal": "warn",
  "react-doctor/server-hoist-static-io": "warn",
  "react-doctor/server-dedup-props": "warn",
  "react-doctor/server-sequential-independent-await": "warn",
  "react-doctor/server-fetch-without-revalidate": "warn",

  "react-doctor/client-passive-event-listeners": "warn",
  "react-doctor/client-localstorage-no-version": "warn",

  "react-doctor/no-inline-bounce-easing": "warn",
  "react-doctor/no-z-index-9999": "warn",
  "react-doctor/no-inline-exhaustive-style": "warn",
  "react-doctor/no-side-tab-border": "warn",
  "react-doctor/no-pure-black-background": "warn",
  "react-doctor/no-gradient-text": "warn",
  "react-doctor/no-dark-mode-glow": "warn",
  "react-doctor/no-justified-text": "warn",
  "react-doctor/no-tiny-text": "warn",
  "react-doctor/no-wide-letter-spacing": "warn",
  "react-doctor/no-gray-on-colored-background": "warn",
  "react-doctor/no-layout-transition-inline": "warn",
  "react-doctor/no-disabled-zoom": "error",
  "react-doctor/no-outline-none": "warn",
  "react-doctor/no-long-transition-duration": "warn",

  "react-doctor/design-no-bold-heading": "warn",
  "react-doctor/design-no-redundant-padding-axes": "warn",
  "react-doctor/design-no-redundant-size-axes": "warn",
  "react-doctor/design-no-space-on-flex-children": "warn",
  "react-doctor/design-no-em-dash-in-jsx-text": "warn",
  "react-doctor/design-no-three-period-ellipsis": "warn",
  "react-doctor/design-no-default-tailwind-palette": "warn",
  "react-doctor/design-no-vague-button-label": "warn",

  "react-doctor/async-parallel": "warn",
};

// HACK: includes every rule that COULD be enabled by createOxlintConfig
// regardless of framework / TanStack flags. Used only by
// validateRuleRegistration to assert RULE_CATEGORY_MAP / RULE_HELP_MAP
// metadata coverage; we want to catch metadata gaps for all conditional
// rules, not just the ones active in the current scan's framework.
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(GLOBAL_REACT_DOCTOR_RULES),
  ...Object.keys(NEXTJS_RULES),
  ...Object.keys(REACT_NATIVE_RULES),
  ...Object.keys(TANSTACK_START_RULES),
  ...Object.keys(TANSTACK_QUERY_RULES),
]);

// HACK: single source of truth for which rules are gated behind the
// project's detected React major. Adding a new version-gated rule means
// touching just this map. `null` reactMajorVersion (couldn't detect)
// keeps every rule enabled so we never silently swallow real findings.
const VERSION_GATED_RULE_IDS: ReadonlyMap<string, number> = new Map([
  ["react-doctor/no-react19-deprecated-apis", REACT_19_DEPRECATION_MIN_MAJOR],
  ["react-doctor/no-default-props", REACT_19_DEPRECATION_MIN_MAJOR],
  ["react-doctor/no-react-dom-deprecated-apis", REACT_DOM_LEGACY_API_MIN_MAJOR],
]);

const filterRulesByReactMajor = (
  rules: Record<string, RuleSeverity>,
  reactMajorVersion: number | null,
): Record<string, RuleSeverity> => {
  if (reactMajorVersion === null) return rules;
  return Object.fromEntries(
    Object.entries(rules).filter(([ruleKey]) => {
      const minMajor = VERSION_GATED_RULE_IDS.get(ruleKey);
      return minMajor === undefined || reactMajorVersion >= minMajor;
    }),
  );
};

export const createOxlintConfig = ({
  pluginPath,
  framework,
  hasReactCompiler,
  hasTanStackQuery,
  customRulesOnly = false,
  reactMajorVersion = null,
  extendsPaths = [],
}: OxlintConfigOptions) => {
  // HACK: REACT_COMPILER_RULES live under the `react-hooks-js` plugin
  // namespace, which is provided by the (optional peer) eslint-plugin-react-hooks
  // package. Two failure modes oxlint won't tolerate:
  //   1. plugin missing entirely → "Plugin 'react-hooks-js' not found" (#141)
  //   2. plugin installed but at an older version that lacks one of our
  //      configured rules → "Rule '<rule>' not found in plugin 'react-hooks-js'"
  //      (e.g. v6 has no `void-use-memo`, peer range is `^6 || ^7`)
  // Gate the rules on successful plugin resolution AND filter to the
  // rule names the loaded plugin actually exports. A missing optional
  // peer or version drift then silently skips just the affected rules
  // instead of crashing the whole scan.
  const reactHooksJsPlugin = resolveReactHooksJsPlugin(hasReactCompiler, customRulesOnly);
  const reactCompilerRules = reactHooksJsPlugin
    ? filterRulesToAvailable(
        REACT_COMPILER_RULES,
        "react-hooks-js",
        reactHooksJsPlugin.availableRuleNames,
      )
    : {};
  // HACK: oxlint merges configs from first to last, with later entries
  // overriding earlier ones — and the local config always overrides
  // every entry in `extends`. So adding the user's existing oxlintrc
  // path to `extends` adds their `rules` to the union without letting
  // their config silence anything react-doctor explicitly configures.
  // Categories the user enables in their own config are blocked by our
  // local `categories: { ... "off" }` block; that's intentional, since
  // mass-enabling oxlint categories would balloon the rule set far
  // beyond the curated react-doctor surface.
  return {
    ...(extendsPaths.length > 0 ? { extends: extendsPaths } : {}),
    categories: {
      correctness: "off",
      suspicious: "off",
      pedantic: "off",
      perf: "off",
      restriction: "off",
      style: "off",
      nursery: "off",
    },
    plugins: customRulesOnly ? [] : ["react", "jsx-a11y"],
    jsPlugins: reactHooksJsPlugin ? [reactHooksJsPlugin.entry, pluginPath] : [pluginPath],
    rules: {
      ...(customRulesOnly ? {} : BUILTIN_REACT_RULES),
      ...(customRulesOnly ? {} : BUILTIN_A11Y_RULES),
      ...reactCompilerRules,
      ...filterRulesByReactMajor(GLOBAL_REACT_DOCTOR_RULES, reactMajorVersion),
      ...(framework === "nextjs" ? NEXTJS_RULES : {}),
      ...(framework === "expo" || framework === "react-native" ? REACT_NATIVE_RULES : {}),
      ...(framework === "tanstack-start" ? TANSTACK_START_RULES : {}),
      ...(hasTanStackQuery ? TANSTACK_QUERY_RULES : {}),
    },
  };
};
