import { createRequire } from "node:module";
import type { Framework } from "./types.js";

const esmRequire = createRequire(import.meta.url);

type RuleSeverity = "error" | "warn" | "off";

const NEXTJS_RULES: Record<string, RuleSeverity> = {
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

const REACT_NATIVE_RULES: Record<string, RuleSeverity> = {
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

const TANSTACK_START_RULES: Record<string, RuleSeverity> = {
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
}

const resolveReactHooksJsPlugin = (
  hasReactCompiler: boolean,
  customRulesOnly: boolean,
): Array<{ name: string; specifier: string }> => {
  if (!hasReactCompiler || customRulesOnly) return [];
  try {
    return [{ name: "react-hooks-js", specifier: esmRequire.resolve("eslint-plugin-react-hooks") }];
  } catch {
    return [];
  }
};

const TANSTACK_QUERY_RULES: Record<string, RuleSeverity> = {
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

const GLOBAL_REACT_DOCTOR_RULES: Record<string, RuleSeverity> = {
  "react-doctor/no-derived-state-effect": "warn",
  "react-doctor/no-fetch-in-effect": "warn",
  "react-doctor/no-cascading-set-state": "warn",
  "react-doctor/no-effect-event-handler": "warn",
  "react-doctor/no-effect-event-in-deps": "error",
  "react-doctor/no-prop-callback-in-effect": "warn",
  "react-doctor/no-derived-useState": "warn",
  "react-doctor/prefer-useReducer": "warn",
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

export const createOxlintConfig = ({
  pluginPath,
  framework,
  hasReactCompiler,
  hasTanStackQuery,
  customRulesOnly = false,
}: OxlintConfigOptions) => ({
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
  jsPlugins: [...resolveReactHooksJsPlugin(hasReactCompiler, customRulesOnly), pluginPath],
  rules: {
    ...(customRulesOnly ? {} : BUILTIN_REACT_RULES),
    ...(customRulesOnly ? {} : BUILTIN_A11Y_RULES),
    ...(hasReactCompiler && !customRulesOnly ? REACT_COMPILER_RULES : {}),
    ...GLOBAL_REACT_DOCTOR_RULES,
    ...(framework === "nextjs" ? NEXTJS_RULES : {}),
    ...(framework === "expo" || framework === "react-native" ? REACT_NATIVE_RULES : {}),
    ...(framework === "tanstack-start" ? TANSTACK_START_RULES : {}),
    ...(hasTanStackQuery ? TANSTACK_QUERY_RULES : {}),
  },
});
