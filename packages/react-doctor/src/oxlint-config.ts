import { createRequire } from "node:module";
import type { Framework } from "./types.js";

const esmRequire = createRequire(import.meta.url);

const NEXTJS_RULES: Record<string, string> = {
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

const REACT_NATIVE_RULES: Record<string, string> = {
  "react-doctor/rn-no-raw-text": "error",
  "react-doctor/rn-no-deprecated-modules": "error",
  "react-doctor/rn-no-legacy-expo-packages": "warn",
  "react-doctor/rn-no-dimensions-get": "warn",
  "react-doctor/rn-no-inline-flatlist-renderitem": "warn",
  "react-doctor/rn-no-legacy-shadow-styles": "warn",
  "react-doctor/rn-prefer-reanimated": "warn",
  "react-doctor/rn-no-single-element-style-array": "warn",
};

const REACT_COMPILER_RULES: Record<string, string> = {
  "react-hooks-js/set-state-in-render": "error",
  "react-hooks-js/immutability": "error",
  "react-hooks-js/refs": "error",
  "react-hooks-js/purity": "error",
  "react-hooks-js/hooks": "error",
  "react-hooks-js/set-state-in-effect": "error",
  "react-hooks-js/globals": "error",
  "react-hooks-js/error-boundaries": "error",
  "react-hooks-js/preserve-manual-memoization": "error",
  "react-hooks-js/unsupported-syntax": "error",
  "react-hooks-js/component-hook-factories": "error",
  "react-hooks-js/static-components": "error",
  "react-hooks-js/use-memo": "error",
  "react-hooks-js/void-use-memo": "error",
  "react-hooks-js/incompatible-library": "error",
  "react-hooks-js/todo": "error",
};

interface OxlintConfigOptions {
  pluginPath: string;
  framework: Framework;
  hasReactCompiler: boolean;
}

export const createOxlintConfig = ({
  pluginPath,
  framework,
  hasReactCompiler,
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
  plugins: ["react", "jsx-a11y", ...(hasReactCompiler ? [] : ["react-perf"])],
  jsPlugins: [
    ...(hasReactCompiler
      ? [{ name: "react-hooks-js", specifier: esmRequire.resolve("eslint-plugin-react-hooks") }]
      : []),
    pluginPath,
  ],
  rules: {
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

    "jsx-a11y/alt-text": "error",
    "jsx-a11y/anchor-is-valid": "warn",
    "jsx-a11y/click-events-have-key-events": "warn",
    "jsx-a11y/no-static-element-interactions": "warn",
    "jsx-a11y/no-noninteractive-element-interactions": "warn",
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

    ...(hasReactCompiler ? REACT_COMPILER_RULES : {}),

    "react-doctor/no-derived-state-effect": "error",
    "react-doctor/no-fetch-in-effect": "error",
    "react-doctor/no-cascading-set-state": "warn",
    "react-doctor/no-effect-event-handler": "warn",
    "react-doctor/no-derived-useState": "warn",
    "react-doctor/prefer-useReducer": "warn",
    "react-doctor/rerender-lazy-state-init": "warn",
    "react-doctor/rerender-functional-setstate": "warn",
    "react-doctor/rerender-dependencies": "error",

    "react-doctor/no-giant-component": "warn",
    "react-doctor/no-render-in-render": "warn",
    "react-doctor/no-nested-component-definition": "error",

    "react-doctor/no-usememo-simple-expression": "warn",
    "react-doctor/no-layout-property-animation": "error",
    "react-doctor/rerender-memo-with-default-value": "warn",
    "react-doctor/rendering-animate-svg-wrapper": "warn",
    "react-doctor/no-inline-prop-on-memo-component": "warn",
    "react-doctor/rendering-hydration-no-flicker": "warn",

    "react-doctor/no-transition-all": "warn",
    "react-doctor/no-global-css-variable-animation": "error",
    "react-doctor/no-large-animated-blur": "warn",
    "react-doctor/no-scale-from-zero": "warn",
    "react-doctor/no-permanent-will-change": "warn",

    "react-doctor/no-secrets-in-client-code": "error",

    "react-doctor/no-barrel-import": "warn",
    "react-doctor/no-full-lodash-import": "warn",
    "react-doctor/no-moment": "warn",
    "react-doctor/prefer-dynamic-import": "warn",
    "react-doctor/use-lazy-motion": "warn",
    "react-doctor/no-undeferred-third-party": "warn",

    "react-doctor/no-array-index-as-key": "warn",
    "react-doctor/rendering-conditional-render": "warn",
    "react-doctor/no-prevent-default": "warn",

    "react-doctor/server-auth-actions": "error",
    "react-doctor/server-after-nonblocking": "warn",

    "react-doctor/client-passive-event-listeners": "warn",

    "react-doctor/async-parallel": "warn",
    ...(framework === "nextjs" ? NEXTJS_RULES : {}),
    ...(framework === "expo" || framework === "react-native" ? REACT_NATIVE_RULES : {}),
  },
});
