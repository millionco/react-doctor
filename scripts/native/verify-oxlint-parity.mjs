import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromRepository = createRequire(path.join(repositoryRoot, "package.json"));
const nativeRules = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "native", "oxlint", "upstream.json"), "utf8"),
).nativeRules;
const argumentsList = process.argv.slice(2);
const readOption = (name) => {
  const optionIndex = argumentsList.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = argumentsList[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};
const corpusRuleOption = readOption("--rules");
const corpusRuleIds = corpusRuleOption ? corpusRuleOption.split(",") : nativeRules;
const unknownCorpusRuleIds = corpusRuleIds.filter((ruleId) => !nativeRules.includes(ruleId));
if (unknownCorpusRuleIds.length > 0) {
  throw new Error(`unknown native rules: ${unknownCorpusRuleIds.join(", ")}`);
}
const excludedCorpusRepositories = new Set(readOption("--exclude")?.split(",") ?? []);
const bindingDirectory = readOption("--directory");
const corpusDirectory = readOption("--corpus");
const configuredBindingPath =
  readOption("--binding") ?? process.env.REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH;
const nativeBindingCandidates = bindingDirectory
  ? fs
      .readdirSync(path.resolve(bindingDirectory))
      .filter((fileName) => fileName.endsWith(".node"))
      .map((fileName) => path.join(path.resolve(bindingDirectory), fileName))
  : configuredBindingPath
    ? [configuredBindingPath]
    : [];
if (nativeBindingCandidates.length > 1) {
  throw new Error(`expected one native binding, received ${nativeBindingCandidates.length}`);
}
const nativeBindingPath = nativeBindingCandidates[0];
if (!nativeBindingPath)
  throw new Error("pass --binding, --directory, or set the native binding env");
if (!fs.existsSync(nativeBindingPath))
  throw new Error(`native binding not found: ${nativeBindingPath}`);

const oxlintMainPath = requireFromRepository.resolve("oxlint");
const oxlintBinaryPath = path.join(
  path.resolve(path.dirname(oxlintMainPath), ".."),
  "bin",
  "oxlint",
);
const pluginPath = requireFromRepository.resolve("oxlint-plugin-react-doctor");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-native-parity-"));
const fixtureDirectory = path.join(temporaryDirectory, "production-fixtures");
const fixturePath = path.join(fixtureDirectory, "app", "error.tsx");
const motionConfigFixturePath = path.join(fixtureDirectory, "app", "layout.tsx");
const tanstackRouteFixturePath = path.join(fixtureDirectory, "src", "routes", "index.tsx");
const tanstackRootFixturePath = path.join(fixtureDirectory, "src", "routes", "__root.tsx");
const tanstackSafeRootFixturePath = path.join(
  fixtureDirectory,
  "src",
  "routes",
  "safe",
  "__root.tsx",
);
const inkWrapperFixturePath = path.join(fixtureDirectory, "app", "ink-wrappers.tsx");
const reactRouterConfigFixturePath = path.join(fixtureDirectory, "react-router.config.ts");
const globalErrorFixturePath = path.join(fixtureDirectory, "app", "global-error.tsx");
const ogImageFixturePath = path.join(fixtureDirectory, "app", "opengraph-image.tsx");
const routeHandlerFixturePath = path.join(fixtureDirectory, "app", "api", "route.ts");
const asyncClientFixturePath = path.join(fixtureDirectory, "app", "async-client.tsx");
const safeGlobalErrorFixturePath = path.join(fixtureDirectory, "app", "safe", "global-error.tsx");
const safePageFixturePath = path.join(fixtureDirectory, "app", "page.tsx");
const safeRouteHandlerFixturePath = path.join(fixtureDirectory, "app", "safe", "route.ts");
const nonProductionFixturePath = path.join(temporaryDirectory, "fixture.test.tsx");
const deepNonProductionFixturePath = path.join(temporaryDirectory, "deep-fixture.test.tsx");
const nonReactJsxFixturePath = path.join(temporaryDirectory, "solid-fixture.tsx");
const configuredFixturePath = path.join(temporaryDirectory, "configured.tsx");
const inactiveRouterFixtureDirectory = path.join(temporaryDirectory, "inactive-router-package");
const inactiveRouterFixturePath = path.join(inactiveRouterFixtureDirectory, "src", "fixture.tsx");
const activeRouterFixtureDirectory = path.join(temporaryDirectory, "active-router-package");
const activeRouterFixturePath = path.join(activeRouterFixtureDirectory, "src", "fixture.tsx");
const environmentRouteFixturePath = path.join(
  activeRouterFixtureDirectory,
  "app",
  "routes",
  "dashboard.server.tsx",
);
const frameworkRouterFixtureDirectory = path.join(temporaryDirectory, "framework-router-package");
const frameworkEnvironmentRouteFixturePath = path.join(
  frameworkRouterFixtureDirectory,
  "app",
  "routes",
  "dashboard.server.tsx",
);
const stockConfigPath = path.join(temporaryDirectory, "stock.json");
const nativeConfigPath = path.join(temporaryDirectory, "native.json");
const configuredStockConfigPath = path.join(temporaryDirectory, "configured-stock.json");
const configuredNativeConfigPath = path.join(temporaryDirectory, "configured-native.json");
const routerStockConfigPath = path.join(temporaryDirectory, "router-stock.json");
const routerNativeConfigPath = path.join(temporaryDirectory, "router-native.json");
const corpusStockConfigPath = path.join(temporaryDirectory, "corpus-stock.json");
const corpusNativeConfigPath = path.join(temporaryDirectory, "corpus-native.json");
const nonReactJsxStockConfigPath = path.join(temporaryDirectory, "solid-stock.json");
const nonReactJsxNativeConfigPath = path.join(temporaryDirectory, "solid-native.json");
const giantComponentStatements = Array.from(
  { length: 300 },
  (_unused, statementIndex) => `  void ${statementIndex};`,
).join("\n");
const nonReactComplexityBranches = Array.from(
  { length: 16 },
  (_unused, branchIndex) => `  if (value === ${branchIndex}) return <span>${branchIndex}</span>;`,
).join("\n");
const REACT_JSX_ONLY_COHORT_RULE_IDS = [
  "no-giant-component",
  "no-high-complexity-react-function",
  "no-nested-component-definition",
];
const EXPECTED_DIAGNOSTIC_COUNTS = {
  "jsx-no-duplicate-props": 1,
  "nextjs-no-vercel-og-import": 1,
  "no-children-prop": 4,
  "no-danger": 4,
  "no-document-write": 8,
  "no-moment": 1,
  "no-namespace": 2,
  "no-react-children": 2,
  "preact-no-react-hooks-import": 2,
  "rn-bottom-sheet-prefer-native": 1,
  "rn-no-deprecated-modules": 1,
  "rn-no-legacy-expo-packages": 1,
  "rn-no-panresponder": 1,
  "rn-prefer-pressable": 1,
  "rn-prefer-reanimated": 2,
  "use-lazy-motion": 1,
  "html-has-lang": 3,
  "no-access-key": 1,
  "no-clone-element": 1,
  "no-is-mounted": 1,
  "no-render-return-value": 2,
  "no-will-update-set-state": 1,
  "self-closing-comp": 2,
  "no-distracting-elements": 1,
  "require-render-return": 2,
  "jsx-no-comment-textnodes": 1,
  "void-dom-elements-no-children": 4,
  "forward-ref-uses-ref": 5,
  "aria-props": 5,
  "aria-unsupported-elements": 2,
  "no-unescaped-entities": 1,
  scope: 1,
  "no-set-state": 2,
  "no-find-dom-node": 2,
  "react-in-jsx-scope": 0,
  "tabindex-no-positive": 7,
  "no-autoplay-without-muted": 1,
  "details-requires-summary": 1,
  "no-broken-image-source": 4,
  "html-no-nested-form": 1,
  "no-img-lazy-with-high-fetchpriority": 1,
  "no-srcset-without-sizes": 1,
  "no-aria-hidden-on-focusable": 5,
  "jsx-props-no-spread-multi": 3,
  "no-redundant-should-component-update": 3,
  "no-direct-mutation-state": 2,
  "no-string-refs": 2,
  "state-in-constructor": 1,
  "nextjs-inline-script-missing-id": 1,
  "no-aria-hidden-on-body": 2,
  "html-xml-lang-mismatch": 1,
  "no-server-side-image-map": 1,
  "no-mixed-srcset-descriptors": 1,
  "no-assertive-status": 3,
  "no-uninformative-aria-label": 3,
  "no-aria-invalid-without-description": 4,
  "no-invalid-progress-range": 6,
  "preact-prefer-ondblclick": 3,
  "rn-no-set-native-props": 5,
  "rn-no-single-element-style-array": 2,
  "no-generic-handler-names": 1,
  "tanstack-start-no-dynamic-server-fn-import": 2,
  "nextjs-no-google-analytics-script": 2,
  "nextjs-no-head-import": 1,
  "nextjs-error-boundary-missing-use-client": 1,
  "nextjs-global-error-missing-html-body": 1,
  "nextjs-no-edge-og-runtime": 1,
  "nextjs-no-default-export-in-route-handler": 1,
  "nextjs-image-missing-sizes": 1,
  "nextjs-no-font-link": 1,
  "nextjs-no-polyfill-script": 1,
  "prefer-truncate-shorthand": 3,
  "no-multiple-main-landmarks": 3,
  "iframe-title-unique": 2,
  "html-label-has-single-control": 2,
  "fieldset-requires-legend": 2,
  "no-skipped-heading-level": 2,
  "no-duplicate-static-id-reference": 2,
  "motion-create-in-render": 5,
  "motion-use-transform-range-length": 3,
  "motion-value-constructor-in-render": 4,
  "dialog-has-accessible-name": 2,
  "no-disabled-zoom": 3,
  "nextjs-no-script-in-head": 1,
  "rendering-animate-svg-wrapper": 2,
  "rn-bottom-sheet-no-ignored-scroll-prop": 4,
  "rn-platform-shaking-use-direct-import": 1,
  "ink-newline-inside-text": 0,
  "ink-suspense-requires-concurrent": 0,
  "no-cascading-set-state": 0,
  "rn-animate-layout-property": 0,
  "rn-prefer-content-inset-adjustment": 0,
  "rn-no-inline-flatlist-renderitem": 2,
  "rn-no-image-children": 2,
  "motion-imperative-animation-in-render": 5,
  "motion-value-subscription-in-render": 2,
  "motion-animate-presence-requires-key": 6,
  "motion-animate-presence-wait-single-child": 3,
  "no-create-object-url-in-render": 4,
  "no-create-context-in-render": 3,
  "no-async-effect-callback": 3,
  "query-no-rest-destructuring": 2,
  "react-router-no-router-in-render": 2,
  "nextjs-async-client-component": 3,
  "no-string-false-on-boolean-attribute": 3,
  "nextjs-no-a-element": 6,
  "jsx-no-script-url": 2,
  "jsx-boolean-value": 2,
  "no-danger-with-children": 1,
  "heading-has-content": 1,
  "empty-table-header": 2,
  "aria-braille-equivalent": 2,
  "no-presentation-role-conflict": 4,
  "no-focusable-content-in-role-text": 2,
  "duplicate-jsx-subtree": 0,
  "circular-dependency": 0,
  "unused-dependency": 0,
  "unused-dev-dependency": 0,
  "unused-export": 0,
  "unused-file": 0,
  "unused-type": 0,
  "rn-reanimated-4-no-removed-api": 2,
  "rn-reanimated-4-no-legacy-spring-thresholds": 2,
  "rn-reanimated-4-use-worklets-scheduler": 2,
  "r3f-no-internal-imports": 6,
  "react-router-v8-no-react-router-dom-import": 4,
  "react-router-no-navigate-in-render": 2,
  "remotion-no-module-scope-delay-render": 4,
  "no-default-warm-page-surface": 2,
  "no-default-purple-page-gradient": 2,
  "no-deprecated-tailwind-class": 7,
  "no-italic-serif-display-heading": 1,
  "no-transitioned-focus-ring": 2,
  "no-overloaded-hover-state": 1,
  "no-tailwind-layout-transition": 3,
  "anchor-has-content": 1,
  "jsx-fragments": 2,
  "jsx-no-constructed-context-values": 1,
  "prefer-es6-class": 1,
  "prefer-function-component": 8,
  "aria-activedescendant-has-tabindex": 1,
  "aria-role": 5,
  "anchor-ambiguous-text": 2,
  "no-interactive-element-to-noninteractive-role": 1,
  "no-noninteractive-element-to-interactive-role": 1,
  "jsx-max-depth": 1,
  "no-unsafe": 1,
  "r3f-no-async-use-frame": 2,
  "react-router-csp-nonce-consistency": 1,
  "react-router-descendant-routes-require-splat": 1,
  "react-router-no-route-module-environment-suffix": 0,
  "react-router-no-session-mutation-in-loader": 2,
  "react-router-no-static-cookie-expires": 1,
  "react-router-no-unsynchronized-search-params-mutation": 1,
  "react-router-no-use-loader-data-in-error-ui": 1,
  "react-router-prefer-route-lazy": 1,
  "react-router-resource-link-requires-reload": 1,
  "react-router-return-navigation-promise-in-transition": 1,
  "react-router-v8-no-meta-data-field": 1,
  "three-webgpu-no-legacy-effect-composer": 2,
  "react-router-no-nested-router": 1,
  "no-full-viewport-width": 1,
  "prefer-dvh-over-vh": 2,
  "no-justified-text": 1,
  "no-arbitrary-px-font-size": 1,
  "no-pure-black-background": 1,
  "no-layout-transition-inline": 1,
  "no-common-root-font": 1,
  "no-redundant-display-class": 1,
  "no-repeated-placeholder-navigation": 1,
  "no-all-caps-body-text": 1,
  "no-tight-display-tracking": 1,
  "no-placeholder-persona-copy": 2,
  "js-early-exit": 1,
  "js-flatmap-filter": 4,
  "hooks-no-nan-in-deps": 5,
  "rendering-conditional-render": 2,
  "no-uppercase-tracked-navigation-label": 1,
  "no-redundant-title-tooltip": 1,
  "no-symmetric-text-button-padding": 1,
  "no-fake-browser-chrome": 1,
  "no-excessive-centered-copy": 1,
  "no-tiny-uppercase-tracked-label": 1,
  "no-uppercase-mono-label": 1,
  "no-tight-body-leading": 1,
  "no-repeated-hover-scale": 1,
  "no-tight-all-caps-heading": 1,
  "no-full-viewport-centered-hero": 1,
  "no-overwide-text-measure": 1,
  "require-autoplay-video-poster": 3,
  "rerender-dependencies": 4,
  "rerender-lazy-ref-init": 7,
  "no-inert-sticky-position": 1,
  "no-crushed-letter-spacing": 1,
  "no-inline-bounce-easing": 1,
  "prefer-tabular-numeric-data": 1,
  "no-excessive-font-families": 1,
  "no-repeated-section-shells": 1,
  "rerender-lazy-state-init": 7,
  "no-eager-new-in-use-state-initializer": 5,
  "no-oversized-long-heading": 1,
  "no-flat-page-type-scale": 1,
  "no-small-form-control-text": 1,
  "no-usememo-simple-expression": 8,
  "design-no-em-dash-in-jsx-text": 1,
  "design-no-redundant-padding-axes": 1,
  "design-no-redundant-size-axes": 1,
  "design-no-space-on-flex-children": 1,
  "design-no-three-period-ellipsis": 1,
  "design-no-vague-button-label": 1,
  "js-tosorted-immutable": 1,
  "rerender-functional-setstate": 8,
  "js-cache-storage": 1,
  "no-set-state-in-render": 2,
  "js-cache-property-access": 1,
  "no-effect-event-in-deps": 2,
  "js-async-reduce-without-awaited-acc": 2,
  "react-router-no-invalid-splat-path": 2,
  "react-router-no-invalid-absolute-child-path": 1,
  "react-router-no-empty-leaf-route": 1,
  "react-router-require-root-error-boundary": 1,
  "react-router-valid-route-object": 2,
  "react-router-v8-no-removed-future-flags": 2,
  "react-router-no-duplicate-route-id": 1,
  "ink-no-bare-process-exit": 1,
  "ink-no-measure-element-in-render": 1,
  "ink-no-focus-in-render": 1,
  "ink-no-direct-raw-mode": 1,
  "ink-no-layout-inside-text": 1,
  "ink-no-dom-host-elements": 1,
  "ink-no-dom-router": 1,
  "no-event-trigger-state": 5,
  "ink-static-is-append-only": 1,
  "ink-static-requires-key": 1,
  "ink-no-multiple-static": 1,
  "ink-valid-aria-semantics": 5,
  "ink-prefer-use-paste": 1,
  "ink-use-string-width-for-cursor": 1,
  "ink-use-suspend-terminal": 1,
  "ink-prefer-use-animation": 1,
  "ink-use-reactive-window-size": 1,
  "no-event-handler": 11,
  "ink-ctrl-c-handler-requires-exit-option": 1,
  "ink-no-live-hooks-in-render-to-string": 1,
  "ink-no-repeated-render": 4,
  "hook-use-state": 24,
  "rendering-svg-precision": 1,
  "no-document-start-view-transition": 1,
  "no-permanent-will-change": 2,
  "no-global-css-variable-animation": 1,
  "ink-no-raw-text": 9,
  "remotion-no-css-animation": 3,
  "remotion-no-css-transition": 4,
  "no-conflicting-spring-options": 2,
  "three-no-shadows-on-unsupported-light": 1,
  "three-no-async-animation-loop": 2,
  "three-cap-device-pixel-ratio": 1,
  "three-prefer-set-animation-loop": 1,
  "three-no-ignored-basic-material-properties": 3,
  "three-no-ignored-linewidth": 2,
  "three-no-normalized-float-buffer-attribute": 2,
  "three-valid-buffer-attribute-item-size": 3,
  "three-valid-raycaster-range": 3,
  "three-valid-fog-parameters": 4,
  "three-valid-perspective-camera": 8,
  "three-valid-orthographic-camera": 3,
  "three-valid-spot-light-properties": 4,
  "three-valid-data-texture-dimensions": 4,
  "three-valid-buffer-attribute-array-length": 3,
  "three-valid-shadow-map-size": 3,
  "three-valid-gpu-computation-dimensions": 2,
  "three-valid-pbr-material-properties": 2,
  "three-valid-physical-material-properties": 2,
  "three-valid-data-texture-data-length": 4,
  "three-valid-material-opacity": 3,
  "three-require-transparent-for-opacity": 2,
  "three-webgpu-no-legacy-material-api": 3,
  "three-gpu-computation-handle-init-error": 2,
  "three-gpu-computation-valid-variable-name": 6,
  "three-effect-composer-output-pass-last": 1,
  "three-webgpu-no-high-precision-instancing": 1,
  "three-limit-shadowed-point-lights": 1,
  "base-ui-tabs-tab-requires-list": 1,
  "shadcn-tabs-trigger-requires-list": 1,
  "radix-tabs-trigger-requires-list": 1,
  "base-ui-dialog-popup-requires-title": 1,
  "base-ui-field-requires-label": 1,
  "radix-dialog-content-requires-title": 1,
  "shadcn-dialog-content-requires-title": 1,
  "shadcn-form-item-requires-label": 1,
  "shadcn-icon-button-requires-label": 1,
  "react-aria-dialog-requires-heading": 1,
  "shadcn-input-group-no-raw-controls": 1,
  "shadcn-command-item-state-variant-requires-value": 1,
  "no-nonresizable-textarea": 1,
  "no-static-motion-config-never": 1,
  "tanstack-start-no-direct-fetch-in-loader": 1,
  "tanstack-start-route-property-order": 1,
  "tanstack-start-no-use-server-in-handler": 1,
  "tanstack-start-server-fn-method-order": 2,
  "tanstack-start-server-fn-validate-input": 2,
  "tanstack-start-no-secrets-in-loader": 2,
  "tanstack-start-no-anchor-element": 2,
  "tanstack-start-loader-parallel-fetch": 5,
  "tanstack-start-redirect-in-try-catch": 4,
  "tanstack-start-missing-head-content": 1,
  "tanstack-start-no-useeffect-fetch": 8,
  "tanstack-start-get-mutation": 11,
  "tanstack-start-no-navigate-in-render": 10,
  "tanstack-start-missing-scripts": 1,
  "activity-wraps-effect-heavy-subtree": 1,
  "advanced-event-handler-refs": 1,
  "nextjs-no-redirect-in-try-catch": 1,
  "nextjs-no-css-link": 1,
  "react-router-no-multiple-blockers": 1,
  "react-router-no-catch-middleware-next": 1,
  "react-router-no-middleware-response-body-consumption": 1,
  "react-router-no-multiple-middleware-next": 1,
  "react-router-no-multiple-set-search-params-in-tick": 1,
  "react-router-server-middleware-return-response": 1,
  "react-router-session-mutation-requires-commit": 1,
  "no-create-store-in-render": 1,
  "react-compiler-no-manual-memoization": 8,
  "no-giant-component": 1,
  "no-nested-component-definition": 1,
  "no-high-complexity-react-function": 1,
  "remotion-no-next-image": 1,
  "remotion-no-native-media-elements": 4,
  "remotion-stable-delay-render-handle": 1,
  "remotion-deterministic-randomness": 2,
  "remotion-no-css-url-assets": 1,
};
const BENCHMARK_FILE_COUNT = 100;
const BENCHMARK_CALL_COUNT_PER_FILE = 500;
const BENCHMARK_FINDING_COUNT_PER_FILE = 500;
const BENCHMARK_SAMPLE_COUNT = 5;
const CORPUS_PARITY_DIFF_LIMIT = 20;
const OXLINT_OUTPUT_MAX_BYTES = 256 * 1024 * 1024;
const DISABLED_RULE_CATEGORIES = {
  correctness: "off",
  nursery: "off",
  pedantic: "off",
  perf: "off",
  restriction: "off",
  style: "off",
  suspicious: "off",
};
const REACT_DOCTOR_SETTINGS = {
  "react-doctor": {
    portedRuleMode: "curated",
    framework: "unknown",
    rootDirectory: repositoryRoot,
    capabilities: ["react", "three:181", "base-ui", "shadcn", "radix-ui", "react-aria"],
  },
};
const CONFIGURED_REACT_DOCTOR_SETTINGS = {
  react: { version: "16.4.0" },
  "react-doctor": {
    ...REACT_DOCTOR_SETTINGS["react-doctor"],
    capabilities: ["react", "tailwind"],
    headingHasContent: { components: ["Title"] },
    jsxBooleanValue: { mode: "always", never: ["compact"] },
    noStringRefs: { noTemplateLiterals: true },
    stateInConstructor: { mode: "never" },
    ariaRole: { allowedInvalidRoles: ["datepicker"], ignoreNonDOM: false },
    anchorAmbiguousText: { words: ["continue"] },
    noInteractiveElementToNoninteractiveRole: { button: ["article"] },
    noNoninteractiveElementToInteractiveRole: { h1: ["button"] },
    jsxMaxDepth: { max: 2 },
    noUnsafe: { checkAliases: true },
  },
};
const shouldBenchmark = argumentsList.includes("--benchmark");
const fixture = `
import moment from "moment";
import type { Moment } from "moment";
import { ImageResponse } from "@vercel/og";
import { redirect as nextRedirect } from "next/navigation";
import React, { Activity as ReactActivity, Children, createContext as makeContext, useEffect, useEffectEvent as useReactEffectEvent, useLayoutEffect, useMemo, useRef, useState, Component, forwardRef as wrapRef, ViewTransition, memo, startTransition as beginRouteTransition } from "react";
import ReactDOM from "react-dom";
import type { useMemo as PreactTypeOnlyHook } from "react";
import { createContext as makeTrackedContext } from "react-tracked";
import { create as createZustandStore } from "zustand";
import { useQuery as useItemsQuery } from "@tanstack/react-query";
import * as TanstackQuery from "@tanstack/react-query";
import { BrowserRouter as OuterRouter, MemoryRouter as InnerRouter, RouterProvider as RouteProvider, ServerRouter as ServerRouteRouter, createBrowserRouter as makeBrowserRouter, createCookieSessionStorage as makeCookieSessionStorage, createHashRouter as makeHashRouter, redirect as routeRedirect, unstable_useBlocker as useRouteBlocker, useLoaderData as useRouteLoaderData, useMatches as useRouteMatches, useRoutes as useNestedRoutes, useSearchParams as useRouteSearchParams } from "react-router";
import { Link as DomLink, useNavigate as useRouteNavigate } from "react-router-dom";
import { renderToPipeableStream as renderRouteStream } from "react-dom/server";
import { runOnJS as callOnJavaScript, useWorkletCallback as makeLegacyWorklet, withSpring as makeSpring } from "react-native-reanimated";
import * as ReanimatedRuntime from "react-native-reanimated";
import { useFrame as useRenderFrame } from "@react-three/fiber";
import { privateFiberApi } from "@react-three/fiber/dist/core";
import FiberInternal = require("@react-three/fiber/src/core");
export { privateFiberRenderer } from "@react-three/fiber/dist/renderer";
export * from "@react-three/fiber/src/web";
export { Link as RouterLink } from "react-router-dom";
export * from "react-router-dom";
import RawBottomSheet from "react-native-raw-bottom-sheet";
import { BottomSheetScrollView as SheetScroll } from "@gorhom/bottom-sheet";
import * as GorhomBottomSheet from "@gorhom/bottom-sheet";
import { Audio } from "expo-av/build/Audio";
import {
  Animated,
  AsyncStorage,
  FlatList,
  Image as NativeImage,
  LayoutAnimation,
  PanResponder as PR,
  TouchableOpacity,
  type WebView,
} from "react-native";
import * as ReactNative from "react-native";
import { AnimatePresence, animate as runMotionAnimation, motion, motionValue as createMotionValue, useAnimate as useMotionAnimate, useAnimationControls as useMotionControls, useMotionValue as useLiveMotionValue, useSpring as useMotionSpring, useTransform as mapMotionValue, type MotionConfig } from "framer-motion";
import * as MotionRuntime from "motion/react";
import { delayRender, delayRender as holdRender, Img as RemotionImg } from "remotion";
import * as Remotion from "remotion";
import { Video as RemotionVideo } from "@remotion/media";
import { Box as InkBox, measureElement, render as renderInk, renderToString as renderInkToString, Static as InkStatic, Text as InkText, useApp, useCursor, useFocusManager, useInput, useStdin } from "ink";
import { ImportedInkLabel, ImportedInkPanel } from "./ink-wrappers";
import { spawn as spawnChild } from "node:child_process";
import * as ThreeRuntime from "three";
import { WebGPURenderer } from "three/webgpu";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { Tabs as ShadcnTabs, TabsTrigger as ShadcnTabsTrigger } from "@/components/ui/tabs";
import * as RadixTabs from "@radix-ui/react-tabs";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Field as BaseField } from "@base-ui/react/field";
import * as NativeRadixDialog from "@radix-ui/react-dialog";
import { DialogContent as ShadcnDialogContent } from "@/components/ui/dialog";
import { Button as ShadcnButton } from "@/components/ui/button";
import { FormControl as ShadcnFormControl, FormItem as ShadcnFormItem } from "@/components/ui/form";
import * as ShadcnInputGroupParts from "@/components/ui/input-group";
import { Trash2 as LucideTrash2 } from "lucide-react";
import * as Cmdk from "cmdk";
import { Dialog as ReactAriaDialog } from "react-aria-components";
import Head from "next/head";
import NextImage from "next/image";
void import("@react-three/fiber/dist/native");
require("@react-three/fiber/src/native");
void import("react-router-dom");
void privateFiberApi;
void FiberInternal;
makeLegacyWorklet(() => {});
const ReanimatedAlias = ReanimatedRuntime;
const legacyGestureHandler = ReanimatedAlias.useAnimatedGestureHandler;
legacyGestureHandler({});
makeSpring(1, { restDisplacementThreshold: 0.01, ["restSpeedThreshold"]: 2 });
callOnJavaScript(() => {});
ReanimatedRuntime.runOnRuntime(runtime, () => {});
document.write("a");
document.writeln("b");
document["write"]("c");
document[\`writeln\`]("d");
document?.write("e");
document!.write("f");
(document as Document)["write"]("g");
(document satisfies Document).writeln("h");
document[method]("safe");
stream.write("safe");
{ const document = { write() {} }; document.write("safe"); }
document.startViewTransition(() => {});
requestAnimationFrame(() => {
  document.documentElement.style.setProperty("--progress", "1");
});
const duplicateProps = <Widget value="first" value="second" />;
createFileRoute("/todos")({ loader: async () => fetch("/api/todos") });
createFileRoute("/")({ loader: async () => ({}), params: { parse: (raw) => raw } });
createFileRoute("/account")({ loader: async () => process.env.STRIPE_SECRET_KEY });
createFileRoute("/settings")({ beforeLoad: async () => import.meta.env.PRIVATE_TOKEN });
createFileRoute("/safe")({ loader: async () => createServerFn().handler(() => process.env.STRIPE_SECRET_KEY) });
createServerFn().handler(async () => { "use server"; return loadData(); });
createServerFn().handler(() => null).validator((input) => input);
createServerFn().handler(({ data }) => data);
(createServerFn().handler(() => null) as any).inputValidator((input) => input);
(createServerFn() as any).handler((context) => context.data);
const sharedSpreadProps = {};
const duplicateIdentifierSpread = <Widget {...sharedSpreadProps} {...sharedSpreadProps} {...sharedSpreadProps} />;
const nestedSpreadProps = { options: {} };
const duplicateMemberSpread = <Widget {...nestedSpreadProps.options} {...(nestedSpreadProps.options)} />;
const distinctMemberSpreads = <Widget {...nestedSpreadProps.options} {...nestedSpreadProps.other} />;
const wrappedComputedSpreads = <Widget {...nestedSpreadProps[("options" as string)]} {...nestedSpreadProps.options} />;
const duplicateOptionalSpread = <Widget {...nestedSpreadProps?.options} {...nestedSpreadProps?.options} />;
const MotionRenderFixture = () => {
  const FirstMotionElement = motion.create("div");
  const SecondMotionElement = MotionRuntime.motion.create("span");
  const firstMotionValue = createMotionValue(0);
  const secondMotionValue = MotionRuntime.motionValue(1);
  const stableMotionValue = useMemo(() => createMotionValue(2), []);
  const deferredMotionFactory = () => motion.create("button");
  return <FirstMotionElement onClick={deferredMotionFactory}>{firstMotionValue.get() + secondMotionValue.get() + stableMotionValue.get()}<SecondMotionElement /></FirstMotionElement>;
};
const MotionSideEffectFixture = () => {
  const controls = useMotionControls();
  const liveProgress = useLiveMotionValue(0);
  const controlsAlias = controls;
  const liveProgressAlias = liveProgress;
  const [, animatePanel] = useMotionAnimate();
  const animatePanelAlias = animatePanel;
  runMotionAnimation(".panel", { opacity: 1 });
  animatePanelAlias(".panel", { x: 10 });
  controlsAlias.start({ opacity: 1 });
  liveProgressAlias.set(1);
  liveProgress.jump(0);
  liveProgressAlias.on("change", console.log);
  useMotionSpring(liveProgress).on("change", console.log);
  const onClick = () => {
    runMotionAnimation(".panel", { opacity: 0 });
    liveProgress.on("change", console.log);
  };
  return <button onClick={onClick}>Animate</button>;
};
const ObjectUrlFixture = () => {
  const directObjectUrl = URL.createObjectURL(blob);
  const mappedObjectUrls = [blob].map((currentBlob) => URL.createObjectURL(currentBlob));
  const memoizedObjectUrl = useMemo(() => URL.createObjectURL(blob), []);
  const wrappedObjectUrl = (URL as typeof URL).createObjectURL(blob);
  useEffect(() => { const effectObjectUrl = URL.createObjectURL(blob); return () => URL.revokeObjectURL(effectObjectUrl); }, []);
  const onDownload = () => URL.createObjectURL(blob);
  return <a href={directObjectUrl} onClick={onDownload}>{mappedObjectUrls.length + memoizedObjectUrl.length + wrappedObjectUrl.length}</a>;
};
const ShadowedObjectUrlFixture = () => {
  const URL = { createObjectURL: () => "local" };
  return <a href={URL.createObjectURL()}>Local</a>;
};
const ContextRenderFixture = () => {
  const LocalContext = makeContext(null);
  return <LocalContext.Provider value={null} />;
};
function useTrackedContextFactory() {
  return makeTrackedContext(null);
}
const ContextNamespaceFixture = () => React.createContext(null);
const DeferredContextFixture = () => {
  const onClick = () => makeContext(null);
  return <button onClick={onClick}>Context</button>;
};
const AsyncEffectFixture = () => {
  useEffect(async () => { await loadProfile(); }, []);
  useLayoutEffect(async function () { await measure(); }, []);
  React.useEffect(async () => { await sync(); }, []);
  return null;
};
const { data: queryData, ...queryRest } = useItemsQuery({ queryKey: ["items"] });
const infiniteQueryResult = TanstackQuery.useInfiniteQuery({ queryKey: ["pages"] });
const { data: infiniteQueryData, ...infiniteQueryRest } = infiniteQueryResult;
const RouterRenderFixture = () => {
  makeBrowserRouter([]);
  ["hash"].map(() => makeHashRouter([]));
  const onClick = () => makeBrowserRouter([]);
  return <button onClick={onClick}>Router</button>;
};
const RouterNavigateFixture = () => {
  const navigateToRoute = useRouteNavigate();
  navigateToRoute("/profile");
  ["/settings"].forEach((path) => navigateToRoute(path));
  const onClick = () => navigateToRoute("/deferred");
  return <button onClick={onClick}>Navigate</button>;
};
const TransitionRouterFixture = ({ router }) => <RouteProvider router={router} unstable_useTransitions />;
const nonceMismatchStream = renderRouteStream(<ServerRouteRouter nonce="router-nonce" />, { nonce: "stream-nonce" });
const renderSafeNonceStream = (nonce) => {
  const routerNonce = nonce;
  const streamNonce = routerNonce;
  return renderRouteStream(<ServerRouteRouter nonce={routerNonce} />, { nonce: streamNonce });
};
const descendantRouteTrees = makeBrowserRouter([
  { path: "account", Component: () => useNestedRoutes([]), ErrorBoundary: RouteErrorBoundary },
  { path: "safe", Component: () => { const NestedRoutes = () => useNestedRoutes([]); return <main />; }, ErrorBoundary: RouteErrorBoundary },
]);
const [{ [\`data\`]: removedMatchData }] = useRouteMatches();
const DroppedTransitionNavigationFixture = () => {
  const navigateToTransitionRoute = useRouteNavigate();
  const onClick = () => beginRouteTransition(() => {
    navigateToTransitionRoute("/transition-next");
  });
  const onSafeClick = () => beginRouteTransition(() => navigateToTransitionRoute("/transition-safe"));
  return <><button onClick={onClick}>Navigate with transition</button><button onClick={onSafeClick}>Navigate safely</button></>;
};
const unkeyedPresence = <AnimatePresence><Panel /><Panel /></AnimatePresence>;
const partiallyKeyedNamespacePresence = <MotionRuntime.AnimatePresence><Panel /><Panel key="second" /></MotionRuntime.AnimatePresence>;
const AliasedPresence = AnimatePresence;
const MotionNamespaceAlias = MotionRuntime;
const aliasedPresence = <AliasedPresence><Panel /><Panel key="second" /></AliasedPresence>;
const waitingPresence = <AnimatePresence mode="wait"><Panel key="first" /><Panel key="second" /></AnimatePresence>;
const waitingNamespacePresence = <MotionRuntime.AnimatePresence mode={"wait"}><Panel key="first" /><Panel key="second" /></MotionRuntime.AnimatePresence>;
const aliasedWaitingPresence = <MotionNamespaceAlias.AnimatePresence mode="wait"><Panel key="first" /><Panel key="second" /></MotionNamespaceAlias.AnimatePresence>;
const spreadOwnedWaitingPresence = <AnimatePresence mode="wait" {...presenceProperties}><Panel /><Panel /></AnimatePresence>;
const mismatchedMotionTransform = mapMotionValue(progress, [0, 0.5, 1], [0, 1]);
const mismatchedNamespacedMotionTransform = MotionRuntime.useTransform(progress, [0, 1], [0]);
const aliasedMotionCreate = motion.create;
const aliasedMotionValue = createMotionValue;
const aliasedMotionTransform = MotionRuntime.useTransform;
const mismatchedAliasedMotionTransform = aliasedMotionTransform(progress, [0, 1, 2], [0, 1]);
const MemoMotionFixture = React.memo(() => {
  const MissingDepsMotionElement = useMemo(() => aliasedMotionCreate("section"));
  const mappedMotionElements = ["article"].map((tagName) => aliasedMotionCreate(tagName));
  const mappedMotionValues = [0].map((value) => aliasedMotionValue(value));
  const immediateMotionValue = (() => (createMotionValue as typeof createMotionValue)(4))();
  const [StableMotionElement] = useState(() => motion.create("aside"));
  const stableMemoMotionValue = useMemo(() => createMotionValue(5), []);
  return <MissingDepsMotionElement>{mappedMotionElements.length + mappedMotionValues.length + immediateMotionValue.get() + stableMemoMotionValue.get()}<StableMotionElement /></MissingDepsMotionElement>;
});
const mapArray = Array.from;
const ArrayFromMotionFixture = () => mapArray(["nav"], (tagName) => motion.create(tagName));
const dynamicMotionTransform = mapMotionValue(progress, inputRange, outputRange);
const animatedSvg = <svg animate={{ opacity: 1 }} />;
const SvgElement = "svg" as const;
const animatedSvgAlias = <SvgElement whileInView={{ opacity: 1 }} />;
const staticSvg = <svg viewBox="0 0 24 24" />;
const ignoredBottomSheetScrollProperties = <SheetScroll scrollEventThrottle={16} decelerationRate="fast" onScrollBeginDrag={handleDrag} />;
const ignoredNamespacedBottomSheetScrollProperty = <GorhomBottomSheet.BottomSheetScrollView decelerationRate="normal" />;
const supportedBottomSheetScrollProperty = <SheetScroll onScroll={handleScroll} {...scrollProperties} />;
const currentPlatform = ReactNative.Platform.OS;
const inlineFlatListRenderItem = <FlatList renderItem={({ item }) => <Row item={item} />} />;
const inlineSectionListRenderItem = <ReactNative.SectionList renderItem={function ({ item }) { return <Row item={item} />; }} />;
const stableFlatListRenderItem = <FlatList renderItem={renderRow} />;
const nativeImageTextChild = <NativeImage source={imageSource}>Caption</NativeImage>;
const nativeImageElementChild = <NativeImage source={imageSource}><Overlay /></NativeImage>;
const nativeImageEmptyChildren = <NativeImage source={imageSource}>{false}{null}{undefined}</NativeImage>;
const stringFalseButton = <button disabled="false" />;
const stringTrueInput = <input checked="true" />;
const stringFalseReadonlyInput = <input readOnly="false" />;
const booleanFalseButton = <button disabled={false} />;
const internalAnchor = <a href="/about">About</a>;
const internalExpressionAnchor = <a href={"/settings"} download={false}>Settings</a>;
const downloadAnchor = <a href="/report" download>Report</a>;
const protocolRelativeAnchor = <a href="//cdn.example.com/file">File</a>;
const scriptUrlAnchor = <a href="javascript:void(0)">Open</a>;
const obfuscatedScriptUrlAnchor = <a href=" \tJ\na\rv\ta\ns\tc\rr\ni\tp\tt:alert(1)">Open</a>;
const safeJavascriptArticle = <a href="https://example.com/JavaScript:Guide">Read</a>;
const namespaced = <svg:path />;
React.createElement("svg:path");
const danger = <div dangerouslySetInnerHTML={{ __html: markup }} />;
React.createElement("div", { dangerouslySetInnerHTML: { __html: markup } });
const dangerousPropsWithChildren = { dangerouslySetInnerHTML: { __html: markup } };
const dangerWithNestedChildren = <div {...dangerousPropsWithChildren}>Content</div>;
const suppressedOnlyForReact =
  // eslint-disable-next-line react/no-danger
  <div dangerouslySetInnerHTML={{ __html: markup }} />;
const suppressedReactDoctor =
  // eslint-disable-next-line react-doctor/no-danger
  <div dangerouslySetInnerHTML={{ __html: markup }} />;
const childrenProp = <Widget children="hidden" />;
React.createElement(Widget, { children: "hidden" });
Children.map(children, child => child);
React.Children.only(children);
const forwardedWithoutRef = React.forwardRef((props) => <div>{props.label}</div>);
const wrappedWithoutRef = wrapRef((props) => <div>{props.label}</div>);
const immutableForwardRef = wrapRef;
const aliasedWithoutRef = immutableForwardRef((props) => <div>{props.label}</div>);
const { forwardRef: destructuredForwardRef } = React;
const destructuredWithoutRef = destructuredForwardRef((props) => <div>{props.label}</div>);
const computedWithoutRef = React["forwardRef"]((props) => <div>{props.label}</div>);
const unrelatedForwardRef = (callback) => callback;
unrelatedForwardRef((props) => <div>{props.label}</div>);
const page = <html></html>;
const untitledFrame = <iframe />;
const invalidFrameTitle = <iframe title={undefined} />;
const invalidAnchor = <a>Open</a>;
const ambiguousAnchor = <a href="https://example.com/details">learn more</a>;
const expressionAmbiguousAnchor = <a href="https://example.com/next">{"learn more"}</a>;
const unfocusableActiveDescendant = <div aria-activedescendant="selected-item" />;
const editableActiveDescendant = <div contentEditable aria-activedescendant="selected-item" />;
const dynamicEditableActiveDescendant = <div contentEditable={editable} aria-activedescendant="selected-item" />;
const templateEditableActiveDescendant = <div contentEditable={\`true\`} aria-activedescendant="selected-item" />;
const negativeActiveDescendant = <div tabIndex={-1} aria-activedescendant="selected-item" />;
const invalidAriaRole = <div role="datepicker" />;
const INVALID_ROLE_ALIAS = "datepicker";
const invalidAliasedAriaRole = <div role={INVALID_ROLE_ALIAS} />;
const invalidConditionalAriaRole = <div role={condition ? "button" : "datepicker"} />;
const interactiveElementWithNoninteractiveRole = <button role="article">Save</button>;
const noninteractiveElementWithInteractiveRole = <h1 role="button">Open</h1>;
const allowedTablePresentationRole = <tr role="presentation" />;
const allowedListRole = <ul role="tablist" />;
const unfocusableSeparatorRole = <h2 role="separator">Divider</h2>;
const missingWidget = <MissingWidget />;
const missingMemberWidget = <Missing.Namespace />;
const mouseOnly = <div onMouseOver={handle} />;
const distracting = <marquee>scroll</marquee>;
const redundantRole = <button role="button">Save</button>;
const unsupportedAria = <button aria-invalid="true">Save</button>;
const invalidAria = <button aria-labeledby="label">Save</button>;
const reservedAria = <meta aria-label="description" role="none" />;
const unescapedEntity = <div>it's visible</div>;
const invalidScope = <td scope="col" />;
const voidChildren = <img children="description" />;
const visibleComment = <div>// visible comment</div>;
const literalComment = <code>// deliberately rendered</code>;
const styledComment = <span className="comment">// deliberately rendered</span>;
const separator = <div>{used} // 512 GB</div>;
const commentOnlyVoid = <input>{/* hint */}</input>;
const nullishVoid = <br>{undefined}{null}{void 0}</br>;
const formattingOnlyVoid = <img>
</img>;
const VoidTag = "img" as const;
const constantVoidChildren = <VoidTag>description</VoidTag>;
React.createElement("br", {}, null, undefined, void 0);
React.createElement("br", {}, "description");
React.createElement("br", { [children]: "description" });
React.createElement("div", { [dangerouslySetInnerHTML]: { __html: markup } });
window.document.createElement("img", { children: "description", dangerouslySetInnerHTML: { __html: markup } }, "description");
namespace[document].createElement("img", {}, "description");
const shortcut = <button accessKey="s">Save</button>;
const positiveTabOrder = <button tabIndex={2}>Later</button>;
const hexadecimalPositiveTabOrder = <button tabIndex="0x2">Later</button>;
const paddedPositiveTabOrder = <button tabIndex=" 2 ">Later</button>;
const infiniteTabOrder = <button tabIndex="Infinity">Normal</button>;
const staticFalseTabOrder = <button tabIndex={false ? 2 : 0}>Normal</button>;
const numericFalseTabOrder = <button tabIndex={0 ? 2 : 0}>Normal</button>;
const unaryPositiveTabOrder = <button tabIndex={+2}>Normal</button>;
const literalConditionalTabOrder = <button tabIndex={true ? 3 : -1}>Later</button>;
const unknownConditionalTabOrder = <button tabIndex={condition ? 4 : -1}>Later</button>;
const alternateConditionalTabOrder = <button tabIndex={false ? -1 : 5}>Later</button>;
const staticTemplateTabOrder = <button tabIndex={\`6\`}>Later</button>;
const dynamicTemplateTabOrder = <button tabIndex={\`7\${suffix}\`}>Normal</button>;
const hiddenFocusableButton = <button aria-hidden={true}>Hidden</button>;
const hiddenFocusableInput = <input aria-hidden="true" />;
const hiddenFocusablePlayer = <video controls aria-hidden src="clip.mp4" />;
const hiddenFocusableDiv = <div tabIndex={0} aria-hidden={"true"}>Hidden</div>;
const dynamicAriaHidden = <button aria-hidden={isHidden}>Dynamic</button>;
const visuallyHiddenInput = <input className="hidden" aria-hidden />;
const negativeHiddenButton = <button tabIndex={-1} aria-hidden />;
const FocusableAlias = "button" as const;
const hiddenFocusableAlias = <FocusableAlias aria-hidden />;
const legacyStringRef = <Widget ref="legacy" />;
const inlineNextScript = <Script>window.analytics = true;</Script>;
const identifiedInlineNextScript = <Script id="analytics">window.analytics = true;</Script>;
const externalNextScript = <Script src="/analytics.js" />;
const spreadInlineNextScript = <Script {...scriptProperties}>window.analytics = true;</Script>;
const inaccessibleBody = <body aria-hidden="true" />;
const spreadOverridesHiddenBody = <body aria-hidden {...{ "aria-hidden": false }} />;
const hiddenBodyOverridesSpread = <body {...{ "aria-hidden": false }} aria-hidden />;
const dynamicSpreadHiddenBody = <body aria-hidden {...bodyProperties} />;
const conflictingDocumentLanguage = <html lang="en-US" xml:lang="fr-CA" />;
const matchingDocumentLanguage = <html lang="EN-us" xml:lang="en-GB" />;
const spreadOverridesDocumentLanguage = <html lang="en" xml:lang="fr" {...{ "xml:lang": "en" }} />;
const serverSideImageMap = <img src="map.png" alt="Campus" isMap />;
const disabledServerSideImageMap = <img src="map.png" alt="Campus" isMap={false} />;
const dynamicServerSideImageMap = <img src="map.png" alt="Campus" isMap={isEnabled} />;
const spreadOverridesServerSideImageMap = <img src="map.png" alt="Campus" isMap {...{ isMap: false }} />;
const mixedSourceSet = <img src="fallback.jpg" srcSet="small.jpg 640w, large.jpg 2x" sizes="100vw" />;
const consistentSourceSet = <img src="fallback.jpg" srcSet="small.jpg 640w, large.jpg 1280w" sizes="100vw" />;
const spreadOwnedMixedSourceSet = <img srcSet="small.jpg 640w, large.jpg 2x" {...imageProperties} />;
const assertiveStatus = <div role="status" aria-live="assertive">Saved</div>;
const politeStatus = <div role="status" aria-live="polite">Saved</div>;
const customAssertiveStatus = <Status role="status" aria-live="assertive">Saved</Status>;
const IntrinsicStatusTag = "div" as const;
const intrinsicAliasAssertiveStatus = <IntrinsicStatusTag role="status" aria-live="assertive">Saved</IntrinsicStatusTag>;
const AliasedStatusTag = IntrinsicStatusTag;
const aliasedAssertiveStatus = <AliasedStatusTag role="status" aria-live="assertive">Saved</AliasedStatusTag>;
const ConditionalStatusTag = isOutput ? "output" : "div";
const conditionalAssertiveStatus = <ConditionalStatusTag role="status" aria-live="assertive">Saved</ConditionalStatusTag>;
const spreadAssertiveStatus = <div role="status" aria-live="assertive" {...statusProperties}>Saved</div>;
const uninformativeButtonLabel = <button aria-label=" Button " />;
const uninformativeImageLabel = <svg aria-label={"image"} />;
const spreadUninformativeLabel = <button aria-label="icon" {...labelProperties} />;
const descriptiveButtonLabel = <button aria-label="Search" />;
const dynamicButtonLabel = <button aria-label={buttonLabel} />;
const invalidInput = <input aria-invalid />;
const invalidSelect = <select aria-invalid="true" />;
const invalidTextarea = <textarea aria-invalid={true} />;
const grammarInvalidInput = <input aria-invalid="grammar" />;
const describedInvalidInput = <input aria-invalid aria-describedby="email-error" />;
const dynamicInvalidInput = <input aria-invalid={isInvalid} />;
const spreadInvalidInput = <input aria-invalid {...inputProperties} />;
const invalidNativeProgressAboveMaximum = <progress value={11} max={10} />;
const invalidNativeProgressBelowMinimum = <progress value={-1} max={10} />;
const invalidWrappedNativeProgress = <progress value={(-1 as number)} max={(10 as number)} />;
const invalidNativeProgressMaximum = <progress value={1} max={0} />;
const invalidAriaProgressRange = <div role="progressbar" aria-valuemin={10} aria-valuemax={5} aria-valuenow={7} />;
const invalidAriaProgressCurrent = <div role="progressbar" aria-valuemin={0} aria-valuemax={10} aria-valuenow={12} />;
const validNativeProgress = <progress value={5} max={10} />;
const dynamicNativeProgress = <progress value={progressValue} max={progressMaximum} />;
const spreadAriaProgress = <div role="progressbar" aria-valuenow={progressValue} {...progressProperties} />;
const preactDoubleClickListItem = <li onDoubleClick={openInline}>Item</li>;
const preactDoubleClickButton = <button onDoubleClick={beginEdit}>Edit</button>;
const preactDblClickButton = <button onDblClick={beginEdit}>Edit</button>;
const PreactItem = () => null;
const preactCustomDoubleClick = <PreactItem onDoubleClick={openInline}>Item</PreactItem>;
const PreactButton = "button" as const;
const preactAliasedDoubleClick = <PreactButton onDoubleClick={openInline}>Open</PreactButton>;
inputRef.current.setNativeProps({ text: value });
textInputRef.current?.setNativeProps({ selection: { start, end } });
this.rootViewRef.current.setNativeProps({ style: { opacity: 0 } });
inputRef.current?.textInputRef.current?.setNativeProps({ selection });
(inputRef.current as any).setNativeProps({ text: value });
config.setNativeProps({ text: value });
inputRef.current.focus();
const singleStyleArray = <View style={[styles.box]} />;
const singleCustomStyleArray = <View contentStyle={[styles.content]} />;
const spreadStyleArray = <View style={[...baseStyles]} />;
const multipleStyleArray = <View style={[styles.box, isActive && styles.active]} />;
const genericClickHandler = <button onClick={handleClick}>Save</button>;
const actionClickHandler = <button onClick={saveProfile}>Save</button>;
const dynamicServerFunctions = import("~/utils/users.functions");
const typedDynamicServerFunctions = import(\`~/utils/admin.functions.ts\`);
const dynamicClientModule = import("~/components/chart");
const dynamicServerFunctionName = import(\`~/utils/\${serverFunctionName}.functions\`);
const tagManagerScript = <Script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ" />;
const analyticsScript = <script src="https://www.google-analytics.com/analytics.js" />;
const unrelatedScript = <Script src="https://example.com/widget.js" />;
const expressionAnalyticsScript = <Script src={"https://www.google-analytics.com/analytics.js"} />;
const truncateClasses = <span className="overflow-hidden text-ellipsis whitespace-nowrap" />;
const reorderedTruncateClasses = <span className={"whitespace-nowrap text-sm overflow-hidden text-ellipsis"} />;
const templateTruncateClasses = <span className={\`text-ellipsis overflow-hidden whitespace-nowrap\`} />;
const incompleteTruncateClasses = <span className="overflow-hidden whitespace-nowrap" />;
const duplicateMainLandmarks = <><main /><section><main /></section><main /></>;
const MainLandmark = "main" as const;
const duplicateAliasedMainLandmarks = <section><MainLandmark /><MainLandmark /></section>;
const separateMainLandmarks = condition ? <main /> : <main />;
const duplicateFrameTitles = <><iframe title="Store map" /><section><frame title={" store   MAP "} /></section></>;
const duplicateUnicodeFrameTitles = <><iframe title={"\uFEFFAdmin\u00A0map"} /><iframe title=" admin map " /></>;
const distinctFrameTitles = <><iframe title="Store map" /><iframe title="Campus map" /></>;
const dynamicFrameTitles = <><iframe title={frameTitle} /><iframe title={frameTitle} /></>;
const expressionBranchFrameTitles = <div>{condition && <><iframe title="Map" /><iframe title="Map" /></>}</div>;
const multiControlLabel = <label>Name <input /><span><select /></span></label>;
const LabelTag = "label" as const;
const InputTag = "input" as const;
const aliasedMultiControlLabel = <LabelTag><InputTag /><textarea /></LabelTag>;
const expressionControlLabel = <label><input />{condition && <input />}</label>;
const unnamedFieldset = <fieldset><input /><select /></fieldset>;
const nestedLegendFieldset = <fieldset><div><legend>Contact</legend></div><input /><textarea /></fieldset>;
const namedFieldset = <fieldset><legend>Contact</legend><input /><input /></fieldset>;
const spreadFieldset = <fieldset {...fieldsetProperties}><input /><input /></fieldset>;
const skippedMainHeading = <main><h1>Title</h1><section><h3>Details</h3></section></main>;
const nestedSkippedArticleHeading = <main><h1>Title</h1><article><h2>Article</h2><h4>Detail</h4></article></main>;
const expressionHeading = <main><h1>Title</h1>{condition && <h3>Details</h3>}</main>;
const continuousHeadings = <article><h1>Title</h1><h2>Details</h2></article>;
const emptyHeading = <h2 />;
const emptyTableHeaders = <table><tbody><tr><th /><td role="columnheader" /></tr></tbody></table>;
const accessibleTableHeaders = <table><tbody><tr><th>Name</th><th>{headerName}</th><th aria-label="Status" /></tr></tbody></table>;
const customTableHeader = <Cell role="columnheader" />;
const brailleOnlyNames = <><button aria-braillelabel="sv"> </button><div aria-brailleroledescription="ctl" /></>;
const brailleEquivalents = <><button aria-braillelabel="sv">Save</button><div aria-brailleroledescription="ctl" aria-roledescription="control" /><button aria-braillelabel="sv" aria-label={buttonLabel} /><div {...brailleProperties} aria-brailleroledescription="ctl" /></>;
const presentationalConflicts = <><div role="presentation" tabIndex={0} /><span role="none" aria-label="Status" /></>;
const focusableDecorativeImage = <img alt="" src="logo.svg" tabIndex={-1} />;
const safePresentationalElements = <><div role="presentation" /><span role={dynamicRole} tabIndex={0} /><span role="presentation" aria-hidden="true" /></>;
const focusableRoleTextContent = <span role="text"><button>Open</button><span tabIndex={0}>More</span></span>;
const safeRoleTextContent = <span role="text">Total <button disabled>Help</button><Wrapper><button>Open</button></Wrapper></span>;
const firstModuleRenderHandle = delayRender();
const secondModuleRenderHandle = holdRender();
const thirdModuleRenderHandle = Remotion.delayRender();
const fourthModuleRenderHandle = Remotion["delayRender"]();
const deferredRenderHandle = () => delayRender();
const unrelatedDelayRender = otherRemotion.delayRender();
useRenderFrame(async () => update());
const asyncFrame = React.useCallback(async () => update(), []);
useRenderFrame(asyncFrame);
const webgpuRenderer = new WebGPURenderer();
const legacyComposer = new EffectComposer(webgpuRenderer);
const warmMainSurface = <main className="bg-stone-50">Warm</main>;
const warmFullPageSurface = <div className="min-h-dvh bg-amber-50">Warm</div>;
const safeVariantWarmSurface = <main className="bg-white dark:bg-stone-50">Safe</main>;
const purpleGradientPage = <main className="bg-gradient-to-r from-violet-500 to-cyan-400">Purple</main>;
const purpleGradientWrapper = <div className="min-h-screen bg-linear-to-br from-indigo-500 via-slate-500 to-pink-500">Purple</div>;
const safeVariantGradient = <main className="bg-gradient-to-r from-violet-500 dark:to-cyan-400">Safe</main>;
const deprecatedTailwindClasses = <div className="md:flex-shrink-0 group-hover:!flex-grow overflow-ellipsis bg-gradient-to-r bg-gradient-radial" />;
const deprecatedTailwindTemplate = <div className={\`flex-shrink\`} />;
const safeTailwindClasses = <div className="shrink-0 grow text-ellipsis bg-linear-to-r" />;
const italicSerifDisplayHeading = <h1 className="font-serif italic text-7xl">Title</h1>;
const safeVariantDisplayHeading = <h2 className="font-serif dark:italic md:text-8xl">Title</h2>;
const transitionedFocusIndicators = <><button className="transition-shadow focus-visible:ring-2" /><button className="transition-[outline] focus-visible:outline-2" /></>;
const instantFocusIndicator = <button className="transition-colors hover:bg-blue-600 focus-visible:ring-2" />;
const overloadedHoverState = <article className="hover:-translate-y-1 hover:shadow-xl hover:bg-white" />;
const restrainedHoverState = <article className="md:scale-105 group-hover:rotate-2 hover:shadow-lg" />;
const layoutTransitions = <><div className="transition-[height]" /><div className="motion-safe:transition-[width,opacity]" /><section className="transition-[ margin-top , opacity ]" /></>;
const safeLayoutTransitions = <><rect className="transition-[height,width]" /><div className="before:content-['transition-[height]'] transition-[transform]" /></>;
const emptyNamedAnchor = <a href="/empty" />;
const explicitFragment = <React.Fragment><span /></React.Fragment>;
interface StableContext { count: number; }
const StableContext = React.createContext(null);
const ConstructedContextValue = () => <StableContext.Provider value={{ count: 1 }} />;
const LegacyCreateClass = createReactClass({ render() { return <div />; } });
class LegacyClassComponent extends React.Component {
  render() { return <div />; }
}
const duplicateEmailId = <><label htmlFor="email">Email</label><input id="email" /><input id="email" /></>;
const duplicateUnicodeId = <><div aria-labelledby="item" /><span id={"\uFEFFitem\u00A0"} /><span id="item" /></>;
const conditionalDuplicateId = <div aria-labelledby="item">{condition ? <span id="item" /> : <span id="item" />}</div>;
const customDuplicateIdReference = <><Custom aria-labelledby="item" /><span id="item" /><span id="item" /></>;
const unnamedDialog = <dialog>Confirm</dialog>;
const unnamedRoleDialog = <section role="alertdialog">Confirm</section>;
const namedDialog = <div role="dialog" aria-labelledby="dialog-title">Confirm</div>;
const spreadDialog = <dialog {...dialogProperties}>Confirm</dialog>;
const disabledViewportZoom = <meta name="viewport" content="width=device-width, user-scalable=yes, user-scalable=no, maximum-scale=1" />;
const userScalableViewportZoom = <meta name="viewport" content="width=device-width, user-scalable=yes, user-scalable=no" />;
const restrictiveViewportZoom = <meta name="viewport" content="width=device-width, maximum-scale=1.5.9" />;
const accessibleViewportZoom = <meta name="viewport" content="width=device-width, maximum-scale=5" />;
const ignoredHeadScript = <Head><Script src="/ignored.js" /></Head>;
const headAttributeScript = <Head icon={<Script src="/loaded.js" />} />;
const autoplayingVideo = <video autoPlay src="hero.mp4" />;
const mutedAutoplayingVideo = <video autoPlay muted src="hero.mp4" />;
const unnamedDetails = <details><p>Answer</p></details>;
const brokenImage = <img alt="Preview" />;
const nestedForm = <form><form /></form>;
const conflictingImagePriority = <img src="hero.png" loading="lazy" fetchPriority="high" />;
const responsiveImage = <img srcSet="hero-640.jpg 640w, hero-1280.jpg 1280w" alt="" />;
const fillImageWithoutSizes = <Image fill src="hero.jpg" alt="Hero" />;
const forwardedImageSizes = <Image fill {...imageProperties} />;
const disabledFillImage = <Image fill={false} src="hero.jpg" alt="Hero" />;
const googleFontStylesheet = <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter" />;
const googleFontPreconnect = <link rel="preconnect" href="https://fonts.googleapis.com" />;
const polyfillScript = <script src="https://polyfill.io/v3/polyfill.min.js" />;
const dataPolyfillScript = <script src="data:text/javascript,polyfill.min.js" />;
const clonedChild = React.cloneElement(child);
const renderResult = ReactDOM.render(<div />, root);
const wrappedRenderResult = (ReactDOM as any).render(<div />, root);
ReactDOM.findDOMNode(root);
ReactDOM[findDOMNode](root);
(ReactDOM as any).findDOMNode(root);
ReactDOM[(findDOMNode as any)](root);
class LegacyState extends Component {
  state = { value: 0, count: 0 };
  UNSAFE_componentWillMount() {}
  componentWillUpdate() { this.setState({ loading: true }); }
  computedUpdate() { this[setState]({ loading: false }); this[(setState as any)]({}); }
  update() { this.state.value = 1; this.state.count++; this.refs.legacy; this.isMounted(); }
  render() { return null; }
}
class PureOverride extends React.PureComponent {
  shouldComponentUpdate() { return true; }
}
const AnonymousPureOverride = class extends PureComponent {
  "shouldComponentUpdate" = () => true;
};
class ComputedPureOverride extends React[PureComponent] {
  [shouldComponentUpdate]() { return true; }
}
class WrappedReactPure extends (React as any).PureComponent {
  shouldComponentUpdate() { return true; }
}
class ConnectionPool {
  isMounted() { return true; }
  inspect() { return this.isMounted(); }
}
class MissingRender extends Component {
  render() {}
}
class ForeignSuppressedMissingRender extends Component {
  // eslint-disable-next-line react/require-render-return
  render() {}
}
const deeplyNestedJsx = <div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><span /></div></div></div></div></div></div></div></div></div></div></div></div></div></div></div>;
const nestedRouter = <OuterRouter><InnerRouter /></OuterRouter>;
const fullViewportWidth = <div className="w-screen" />;
const fullViewportHeight = <main className="min-h-screen" />;
const justifiedText = <p style={{ textAlign: "justify" }}>Long justified text</p>;
const arbitraryPixelFontSize = <p className="text-[13px]">Small text</p>;
const pureBlackBackground = <section style={{ backgroundColor: "#000" }} />;
const inlineLayoutTransition = <div style={{ transition: "width 200ms" }} />;
const commonRootFont = <main style={{ fontFamily: "Inter, sans-serif" }}>Content</main>;
const redundantDisplay = <div className="block rounded-lg" />;
const placeholderNavigation = <nav><a href="#">Home</a><a href="#">Settings</a></nav>;
const allCapsBody = <p className="uppercase">This paragraph contains enough readable copy that forcing every word into capitals makes it harder to scan.</p>;
const tightDisplayTracking = <h1 className="tracking-tighter">Build faster</h1>;
const placeholderPersona = <main><p>Jane Doe</p></main>;
function deeplyNestedConditions(first, second, third, fourth) {
  if (first) {
    if (second) {
      if (third) {
        if (fourth) runNestedWork();
      }
    }
  }
}
function branchedNestedConditions(first, second, third, fourth) {
  if (first) {
    if (second) {
      if (third) {
        if (fourth) runNestedWork();
      } else {
        runAlternateWork();
      }
    }
  }
}
const compactedItems = items.map((item) => item.value).filter(Boolean);
const typedCompactedItems = (items.map((item) => item.value) as any).filter(Boolean);
const identityCompactedItems = items.map((item) => item.value).filter((item) => item);
const parenthesizedIdentityCompactedItems = items.map((item) => item.value).filter((item => item));
const boundedCompactedItems = items.slice(0, 4).map((item) => item.value).filter(Boolean);
const smallCompactedItems = [first, second].map((item) => item.value).filter(Boolean);
const immutableNanValue = Number.NaN;
const aliasedNanValue = immutableNanValue;
const { ["NaN"]: destructuredNanValue } = Number;
const [, arrayNanValue] = [0, Number.NaN];
const conditionalEffect = condition ? useEffect : React.useEffect;
const { useImperativeHandle: exposeImperativeHandle } = React;
const NanDependencyFixture = () => {
  useEffect(() => {}, [NaN]);
  conditionalEffect(() => {}, [aliasedNanValue, destructuredNanValue, arrayNanValue]);
  exposeImperativeHandle(ref, () => ({}), [Number.NaN]);
  {
    const NaN = 0;
    const Number = { NaN: 0 };
    useEffect(() => {}, [NaN, Number.NaN]);
  }
  return null;
};
const leakedNumericConditional = itemCount && <Badge n={itemCount} />;
const leakedLengthConditional = items.length && <List items={items} />;
const safeBooleanConditional = showCount && <Badge n={itemCount} />;
const nestedPlaceholderPersona = <main><article><p>John Smith</p></article></main>;
const trackedNavigationLabel = <aside><span className="uppercase tracking-widest">Workspace</span></aside>;
const redundantTitle = <button title="Save changes">Save changes</button>;
const symmetricTextButton = <button className="p-3">Save changes</button>;
const fakeBrowserChrome = <div className="overflow-hidden rounded-xl border"><div><span className="size-3 rounded-full bg-red-500" /><span className="size-3 rounded-full bg-yellow-500" /><span className="size-3 rounded-full bg-green-500" /></div></div>;
const excessiveCenteredCopy = <main><p className="text-center">Build polished interfaces with a workflow that keeps every decision visible.</p><p className="text-center">Move from an initial idea to a working result without losing important context.</p><p className="text-center">Keep the whole team aligned with clear updates and shared project history.</p></main>;
const tinyUppercaseTrackedLabel = <span className="text-[0.6875rem] uppercase tracking-wide">Recent activity</span>;
const uppercaseMonoLabel = <span className="font-mono text-xs uppercase tracking-widest">System online</span>;
const tightBodyLeading = <p className="leading-tight">This paragraph contains enough words to wrap across several lines in a typical content column.</p>;
const repeatedHoverScale = <main><article className="hover:scale-105" /><article className="hover:scale-105" /><article className="hover:scale-105" /></main>;
const tightAllCapsHeading = <h1 className="uppercase leading-none">Infrastructure for every engineering team</h1>;
const fullViewportCenteredHero = <section className="flex min-h-dvh items-center justify-center"><h1>Build faster</h1></section>;
const overwideTextMeasure = <blockquote className="max-w-[90ch]">Copy</blockquote>;
const autoplayVideoWithoutPoster = <video autoPlay muted src="/demo.mp4" />;
useEffect(() => {}, [{ mode }, [mode], () => mode, function dependency() { return mode; }]);
const expensiveReference = useRef(buildExpensiveCache());
const memberReference = useRef(cache.build());
const optionalCallReference = useRef(cache.factory?.());
const dateReference = useRef(new Date());
const populatedMapReference = useRef(new Map([["mode", mode]]));
const memberMapReference = useRef(new cache.Map());
const lazyState = useState(buildRows(raw) ?? []);
const eagerConstructedState = useState(new AbortController());
const directLazyState = useState(buildState(raw));
const memberLazyState = useState(computeState(raw).value);
const spreadLazyState = useState([...buildState(raw)]);
const optionalLazyState = useState(buildState?.(raw));
const optionalMemberLazyState = useState(buildState(raw)?.value);
const hookState = useState(useMemo(() => raw, [raw]));
const trivialDateState = useState(Date.now());
const conditionalFallbackState = useState(raw ?? buildState(raw));
const conditionalConstructedState = useState(raw ? new ReadClient() : new WriteClient());
const nestedConstructedState = useState({ client: new ApiClient() });
const runtimeMapState = useState(new Map(items));
const constantMapState = useState(new Map([["raw", raw]]));
const globalMapState = useState(new globalThis.Map());
const lazyConstructedState = useState(() => new ApiClient());
const wrappedConstructedState = useState(wrap(new ApiClient()));
const cheapMemo = useMemo(() => raw + 1, [raw]);
const staticTemplateMemo = useMemo(() => \`static label\`, []);
const conditionalMemo = useMemo(() => (raw ? mode : "fallback"), [raw, mode]);
const blockMemo = useMemo(function () { return raw !== mode; }, [raw, mode]);
const memberOnlyMemo = useMemo(() => [raw], [raw]);
const memberOnlyMemoLength = memberOnlyMemo.length;
const destructuredMemo = useMemo(() => ({ total: raw + mode, parts: 2 }), [raw, mode]);
const { total: destructuredMemoTotal } = destructuredMemo;
const { raw: immediateMemoRaw } = useMemo(() => ({ raw, mode }), [raw, mode]);
const [tupleMemoFirst] = useMemo(() => [raw, mode], [raw, mode]);
useMemo(() => ({ raw, mode }), [raw, mode]);
const interpolatedMemo = useMemo(() => \`mode \${mode}\`, [mode]);
const wrappedCallbackMemo = useMemo((() => raw + 1) as () => number, [raw]);
const escapingMemo = useMemo(() => ({ raw }), [raw]);
const escapedMemoElement = <Widget value={escapingMemo} />;
const aliasedMemo = escapingMemo;
const computedKeyMemo = useMemo(() => ({ [mode]: raw }), [raw, mode]);
const computedKeyMemoSize = computedKeyMemo.size;
const mutableMemo = useMemo(() => [raw], [raw]);
mutableMemo.push(mode);
const assignedMemo = useMemo(() => ({ raw }), [raw]);
assignedMemo.raw = mode;
const deletedMemo = useMemo(() => ({ raw }), [raw]);
delete deletedMemo.raw;
const FunctionalSetstateFixture = () => {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [profile, setProfile] = useState({ active: false });
  const [page, setPage] = useState(1);
  const doubleStep = () => {
    setCount(count + 1);
    setCount(count + 1);
  };
  useEffect(() => {
    const interval = setInterval(() => setCount(count - 1), 1000);
    return () => clearInterval(interval);
  }, []);
  const remember = debounce((item) => setItems([...items, item]), 100);
  const updateProfile = throttle((active) => setProfile({ ...profile, active }), 100);
  queueMicrotask(() => setPage(++page));
  Promise.resolve().then(() => setPage(page ** 2));
  requestAnimationFrame(() => setPage(page / 2));
  const singleStep = () => setPage(page + 1);
  const synchronousSpread = () => setItems([...items, raw]);
  const mutuallyExclusiveStep = () => {
    if (page === 0) {
      setPage(1);
    } else if (page > 0) {
      setPage(page - 1);
    }
  };
  return <button onClick={doubleStep} onBlur={singleStep} onFocus={synchronousSpread} onKeyDown={mutuallyExclusiveStep}>{remember}{updateProfile}</button>;
};
function UnconditionalRenderSetterFixture() {
  const [renderCount, setRenderCount] = useState(0);
  setRenderCount(1);
  return renderCount;
}
const ArrowRenderSetterFixture = () => {
  const [renderOpen, setRenderOpen] = React.useState(false);
  setRenderOpen(true);
  return renderOpen;
};
function ConditionalRenderSetterFixture(nextCount) {
  const [previousCount, setPreviousCount] = useState(nextCount);
  if (previousCount !== nextCount) setPreviousCount(nextCount);
  return previousCount;
}
function HandlerRenderSetterFixture() {
  const [handlerCount, setHandlerCount] = useState(0);
  const increment = () => setHandlerCount(handlerCount + 1);
  return <button onClick={increment}>{handlerCount}</button>;
}
function EffectEventDependencyFixture({ value }) {
  const onTick = useEffectEvent(() => value);
  useEffect(() => onTick(), [onTick]);
  return null;
}
function ImportedEffectEventDependencyFixture({ value }) {
  const onImportedTick = useReactEffectEvent(() => value);
  useEffect(() => onImportedTick(), [onImportedTick]);
  return null;
}
function NonReactEffectEventDependencyFixture({ value }) {
  const onTick = StableHooks.useEffectEvent(() => value);
  useEffect(() => onTick(), [onTick]);
  return null;
}
function EventTriggerStateFixture() {
  const [submittedPayload, setSubmittedPayload] = useState(null);
  useEffect(() => {
    if (submittedPayload) {
      post("/api/register", submittedPayload);
    }
  }, [submittedPayload]);
  return <button onClick={() => setSubmittedPayload({ ok: true })}>Submit registration</button>;
}
function NamedEventTriggerStateFixture() {
  const [namedPayload, setNamedPayload] = useState(null);
  const handleSubmit = () => setNamedPayload({ ok: true });
  useEffect(() => {
    if (namedPayload) post("/api/named", namedPayload);
  }, [namedPayload]);
  return <button onClick={handleSubmit}>Submit named registration</button>;
}
function HelperEventTriggerStateFixture() {
  const [helperPayload, setHelperPayload] = useState(null);
  const markSubmitted = () => setHelperPayload({ ok: true });
  const handleSubmit = () => markSubmitted();
  useEffect(() => {
    if (helperPayload) post("/api/helper", helperPayload);
  }, [helperPayload]);
  return <button onClick={handleSubmit}>Submit helper registration</button>;
}
function PropertyEventTriggerStateFixture() {
  const [propertyPayload, setPropertyPayload] = useState(null);
  const handlers = { onClick: () => setPropertyPayload({ ok: true }) };
  useEffect(() => {
    if (propertyPayload) post("/api/property", propertyPayload);
  }, [propertyPayload]);
  return <button {...handlers}>Submit property registration</button>;
}
function MixedWriterEventTriggerStateFixture({ automatic }) {
  const [mixedPayload, setMixedPayload] = useState(null);
  const handleSubmit = () => setMixedPayload({ ok: true });
  useEffect(() => {
    if (automatic) setMixedPayload({ automatic: true });
  }, [automatic]);
  useEffect(() => {
    if (mixedPayload) post("/api/mixed", mixedPayload);
  }, [mixedPayload]);
  return <button onClick={handleSubmit}>Submit mixed registration</button>;
}
function RenderUsedEventTriggerStateFixture() {
  const [visiblePayload, setVisiblePayload] = useState(null);
  useEffect(() => {
    if (visiblePayload) post("/api/visible", visiblePayload);
  }, [visiblePayload]);
  return <button onClick={() => setVisiblePayload({ ok: true })}>{visiblePayload ? "Submitted" : "Submit visible registration"}</button>;
}
function EventHandlerEffectFixture() {
  const [payload, setPayload] = useState(null);
  useEffect(() => {
    if (payload) submitData(payload);
  }, [payload]);
  return <button onClick={() => setPayload({ ok: true })}>Submit event payload</button>;
}
function EventHandlerEffectWithoutDependenciesFixture() {
  const [payload, setPayload] = useState(null);
  useEffect(() => {
    if (payload) submitData(payload);
  });
  return <button onClick={() => setPayload({ ok: true })}>Submit dependency-free payload</button>;
}
function EventHandlerMemberGuardFixture() {
  const [payload, setPayload] = useState(null);
  useEffect(() => {
    if (payload.name && payload.name.length > 0) submitData(payload);
  }, [payload]);
  return <button onClick={() => setPayload({ name: "Ada" })}>Submit named payload</button>;
}
function EventHandlerCleanupFixture({ subscribe, unsubscribe }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (enabled) subscribe();
    return () => unsubscribe();
  }, [enabled, subscribe, unsubscribe]);
  return <button onClick={() => setEnabled(true)}>Enable subscription</button>;
}
function EventHandlerMixedGuardFixture({ ready }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (enabled && ready) submitData();
  }, [enabled, ready]);
  return <button onClick={() => setEnabled(true)}>Submit ready payload</button>;
}
function EventHandlerNestedGuardFixture() {
  const [enabled, setEnabled] = useState(false);
  const [ready] = useState(false);
  useEffect(() => {
    if (enabled) {
      if (ready) submitData();
    }
  }, [enabled, ready]);
  return <button onClick={() => setEnabled(true)}>Submit nested payload</button>;
}
function EventHandlerDeferredFrameFixture() {
  const [sortField, setSortField] = useState("");
  const onSort = React.useCallback((field) => setSortField(field), []);
  useEffect(() => {
    Promise.resolve().then(() => {
      if (sortField) applySort(getField(sortField));
    });
  }, [sortField]);
  return <Grid onSort={onSort} />;
}
function EventHandlerStateSetterHelperFixture({ onChange }) {
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState(0);
  const commitChange = () => {
    setValue(1);
    onChange(1);
  };
  useEffect(() => {
    if (!focused) commitChange();
  }, [focused]);
  return <input value={value} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />;
}
function EventHandlerPropInitializedStateFixture({ initialEnabled }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  useEffect(() => {
    if (enabled) submitData();
  }, [enabled]);
  return <button onClick={() => setEnabled(true)}>Enable prop-initialized submission</button>;
}
function EventHandlerUseCallbackFrameFixture() {
  const [query, setQuery] = useState("");
  const fetchMore = React.useCallback(() => {
    if (query) fetchNextPage(query);
  }, [query]);
  useEffect(() => {
    fetchMore();
  }, [fetchMore]);
  return <button onClick={() => setQuery("next")}>Fetch more</button>;
}
function EventHandlerAsyncFrameFixture() {
  const [payload, setPayload] = useState(null);
  const submitLater = async () => {
    if (payload) submitData(payload);
  };
  useEffect(() => {
    submitLater();
  }, [submitLater]);
  return <button onClick={() => setPayload({ ok: true })}>Submit later</button>;
}
function EventHandlerNestedTriggeredCallFixture() {
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    if (selected) client.subscribe(() => analytics.track("selected"));
  }, [selected]);
  return <button onClick={() => setSelected(true)}>Select</button>;
}
function HookUseStateFixture() {
  const stateResult = React.useState(0);
  const [value, updateValue] = React.useState(0);
  return <button onClick={() => updateValue(value + 1)}>{stateResult[0]}</button>;
}
const OverpreciseSvgPathFixture = () => <path d="M10.293847 20.847362" />;
const PermanentWillChangeFixture = () => <><div className="will-change-transform" /><div style={{ willChange: "opacity" }} /></>;
const RemotionCssTimeFixture = () => {
  Remotion.useCurrentFrame();
  return <><div className="motion-safe:animate-spin hover:transition-colors" style={{ animationName: "spin", animation: "fade 1s", transition: "all 1s", transitionProperty: "opacity" }} /><div className="animate-none transition-none" style={{ animation: "none", animationName: \` NONE \`, transition: "none", transitionProperty: \` NONE \` }} /></>;
};
const RemotionMediaTransitionFixture = () => <RemotionVideo style={{ transition: "opacity 1s" }} />;
function RemotionMediaFixture() {
  Remotion.useCurrentFrame();
  const unstableHandle = holdRender();
  const [stableHandle] = useState(() => delayRender());
  const randomValue = Math.random();
  const globalRandomValue = globalThis.Math["random"]();
  return <><NextImage alt="Frame" src="/frame.png" width={100} height={100} /><img alt="Frame" src="/frame.png" /><audio aria-label="Audio" /><iframe title="Frame" /><video aria-label="Video" /><div style={{ backgroundImage: "url('/background.png')", maskImage: "url(data:image/png;base64,abc)", WebkitMaskImage: "url(#mask)" }} /><RemotionImg alt="Preloaded" src="/preloaded.png" /><div style={{ backgroundImage: "url('/preloaded.png')" }} />{unstableHandle}{stableHandle}{randomValue}{globalRandomValue}</>;
}
function SafeRemotionRandomFixture() {
  const Math = { random: () => 0.5 };
  Remotion.useCurrentFrame();
  return <div>{Math.random()}</div>;
}
const ConflictingMotionSpringFixture = () => <><MotionRuntime.motion.div transition={{ type: "spring", stiffness: 200, duration: 0.4 }} /><MotionRuntime.motion.div animate={{ x: 100, transition: { type: "spring", mass: 1, bounce: 0.3 } }} /></>;
const unsupportedShadowLight = new ThreeRuntime.AmbientLight();
unsupportedShadowLight.castShadow = true;
const asyncAnimationRenderer = new ThreeRuntime.WebGLRenderer();
asyncAnimationRenderer.setAnimationLoop(async () => updateFrame());
asyncAnimationRenderer.setPixelRatio(window.devicePixelRatio);
const ignoredBasicMaterial = new ThreeRuntime.MeshBasicMaterial({ roughness: 0.4, metalness: 0.8 });
ignoredBasicMaterial.roughness = 0.5;
const ignoredLineMaterial = new ThreeRuntime.LineBasicMaterial({ linewidth: 4 });
ignoredLineMaterial.linewidth = 3;
const floatBufferValues = new Float32Array(9);
new ThreeRuntime.BufferAttribute(floatBufferValues, 3, true);
new ThreeRuntime.Float32BufferAttribute([], 3, true);
new ThreeRuntime.BufferAttribute(floatBufferValues, 0);
new ThreeRuntime.Float32BufferAttribute([], -1);
new ThreeRuntime.Float32BufferAttribute([], 1.5);
new ThreeRuntime.Raycaster(origin, direction, -1, 10);
new ThreeRuntime.Raycaster(origin, direction, 10, 5);
const invalidRaycaster = new ThreeRuntime.Raycaster();
invalidRaycaster.near = -0.1;
new ThreeRuntime.Fog("white", -1, 10);
new ThreeRuntime.Fog(0xffffff, 10, 10);
new ThreeRuntime.Fog(0xffffff, 20, 10);
new ThreeRuntime.FogExp2("white", -0.1);
const invalidPerspectiveCamera = new ThreeRuntime.PerspectiveCamera();
invalidPerspectiveCamera.aspect = 0;
invalidPerspectiveCamera.near = -1;
invalidPerspectiveCamera.far = 0;
new ThreeRuntime.PerspectiveCamera(75, 0, 0.1, 1000);
new ThreeRuntime.PerspectiveCamera(75, 1, 0, 1000);
new ThreeRuntime.PerspectiveCamera(75, 1, 100, 100);
new ThreeRuntime.PerspectiveCamera(75, 1, 100, 50);
new ThreeRuntime.PerspectiveCamera(75, 1, dynamicNear, 0);
new ThreeRuntime.OrthographicCamera(1, 1, 1, -1, 0, 10);
new ThreeRuntime.OrthographicCamera(-1, 1, 2, 2, 0, 10);
new ThreeRuntime.OrthographicCamera(-1, 1, 1, -1, 5, 5);
new ThreeRuntime.SpotLight(0xffffff, 1, 0, 2, -0.1);
const invalidSpotLight = new ThreeRuntime.SpotLight();
invalidSpotLight.angle = 0;
invalidSpotLight.penumbra = 2;
new ThreeRuntime.DataTexture(data, 0, 8);
new ThreeRuntime.DataTexture(data, 8, -1);
new ThreeRuntime.Data3DTexture(data, 4, 4, 1.5);
new ThreeRuntime.DataArrayTexture(data, 2, 3.2, 4);
new ThreeRuntime.BufferAttribute(new Float32Array(10), 3);
new ThreeRuntime.Float32BufferAttribute([0, 1, 2, 3, 4], 2);
new ThreeRuntime.InstancedBufferAttribute(new Uint8Array([0, 1, 2, 3, 4]), 4);
const invalidDirectionalShadow = new ThreeRuntime.DirectionalLight();
const invalidPointShadow = new ThreeRuntime.PointLight();
invalidDirectionalShadow.shadow.mapSize.set(1000, 1024);
invalidPointShadow.shadow.mapSize.set(0, -512);
new ThreeRuntime.GPUComputationRenderer(0, -1, renderer);
new ThreeRuntime.MeshStandardMaterial({ roughness: 2, metalness: -0.25 });
const invalidPhysicalMaterial = new ThreeRuntime.MeshPhysicalMaterial();
invalidPhysicalMaterial.clearcoat = 2;
invalidPhysicalMaterial.ior = 3;
new ThreeRuntime.DataTexture(new Uint8Array(15), 2, 2);
new ThreeRuntime.DataTexture(new Float32Array([1, 2, 3]), 2, 2, ThreeRuntime.RedFormat);
new ThreeRuntime.Data3DTexture(new Float32Array(31), 2, 2, 2);
new ThreeRuntime.DataArrayTexture(new Uint8Array(23), 2, 2, 3, ThreeRuntime.RGFormat);
new ThreeRuntime.MeshBasicMaterial({ opacity: -0.1 });
new ThreeRuntime.MeshStandardMaterial({ opacity: 1.2 });
const invalidOpacityMaterial = new ThreeRuntime.MeshBasicMaterial();
invalidOpacityMaterial.opacity = -1;
new ThreeRuntime.MeshBasicMaterial({ opacity: 0.5 });
new ThreeRuntime.MeshStandardMaterial({ opacity: 0.2, transparent: false });
const threeNamespaceWebgpuRenderer = new ThreeRuntime.WebGPURenderer();
new ThreeRuntime.ShaderMaterial();
new ThreeRuntime.RawShaderMaterial();
const legacyWebgpuMaterial = new ThreeRuntime.MeshStandardMaterial();
legacyWebgpuMaterial.onBeforeCompile = patchShader;
const gpuComputation = new ThreeRuntime.GPUComputationRenderer(4, 4, renderer);
gpuComputation.init();
void gpuComputation.init();
gpuComputation.addVariable("texture-position", shader, texture);
gpuComputation.addVariable("gl_Position", shader, texture);
gpuComputation.addVariable("uniform", shader, texture);
gpuComputation.addVariable("projectionMatrix", shader, texture);
gpuComputation.addVariable("texturePosition", firstShader, firstTexture);
gpuComputation.addVariable("texturePosition", secondShader, secondTexture);
const gpuComputationAlias = gpuComputation;
gpuComputationAlias.addVariable("textureVelocity", firstShader, firstTexture);
gpuComputation.addVariable("textureVelocity", secondShader, secondTexture);
const outputComposer = new EffectComposer(renderer);
outputComposer.addPass(new OutputPass());
outputComposer.addPass(new ShaderPass(shader));
const highPrecisionRenderer = new ThreeRuntime.WebGPURenderer();
highPrecisionRenderer.highPrecision = true;
const highPrecisionScene = new ThreeRuntime.Scene();
const highPrecisionMesh = new ThreeRuntime.InstancedMesh(geometry, material, 10);
highPrecisionScene.add(highPrecisionMesh);
highPrecisionRenderer.render(highPrecisionScene, camera);
const shadowScene = new ThreeRuntime.Scene();
const firstShadowLight = new ThreeRuntime.PointLight();
const secondShadowLight = new ThreeRuntime.PointLight();
const thirdShadowLight = new ThreeRuntime.PointLight();
firstShadowLight.castShadow = true;
secondShadowLight.castShadow = true;
thirdShadowLight.castShadow = true;
shadowScene.add(firstShadowLight, secondShadowLight, thirdShadowLight);
const TabsHierarchyFixture = () => <>
  <BaseTabs.Root><BaseTabs.Tab value="base">Base</BaseTabs.Tab></BaseTabs.Root>
  <ShadcnTabs><ShadcnTabsTrigger value="shadcn">Shadcn</ShadcnTabsTrigger></ShadcnTabs>
  <RadixTabs.Root><RadixTabs.Trigger value="radix">Radix</RadixTabs.Trigger></RadixTabs.Root>
</>;
const BaseUiStructureFixture = () => <>
  <BaseDialog.Popup><p>Body</p></BaseDialog.Popup>
  <BaseField.Root><BaseField.Control /></BaseField.Root>
</>;
const DialogTitleFixture = () => <>
  <NativeRadixDialog.Content><p>Body</p></NativeRadixDialog.Content>
  <ShadcnDialogContent><p>Body</p></ShadcnDialogContent>
</>;
const ShadcnLabelFixture = () => <>
  <ShadcnFormItem><ShadcnFormControl><input /></ShadcnFormControl></ShadcnFormItem>
  <ShadcnButton size="icon"><LucideTrash2 /></ShadcnButton>
</>;
const ReactAriaDialogFixture = () => <ReactAriaDialog><p>Body</p></ReactAriaDialog>;
const ShadcnInputGroupFixture = ({ isVisible }) => <ShadcnInputGroupParts.InputGroup><>{isVisible && <textarea />}</><ShadcnInputGroupParts.InputGroupAddon>Search</ShadcnInputGroupParts.InputGroupAddon></ShadcnInputGroupParts.InputGroup>;
const ShadcnCommandItemFixture = ({ extra }) => <Cmdk.Command.Item className={\`px-2 \${extra} data-[disabled]:opacity-50\`} />;
const NonresizableTextareaFixture = () => <textarea className="resize-none" />;
async function AsyncThreeAnimationFrameFixture() {
  await updateFrame();
  asyncAnimationRenderer.render(scene, camera);
  requestAnimationFrame(AsyncThreeAnimationFrameFixture);
}
requestAnimationFrame(AsyncThreeAnimationFrameFixture);
const CompilerInnerFixture = () => <div />;
const CompilerMemoFixture = memo(CompilerInnerFixture);
function NativeStoreFixture() {
  const useStore = createZustandStore(() => ({ count: 0 }));
  return <div>{String(useStore)}</div>;
}
function NativeNestedParentFixture() {
  const NativeNestedChildFixture = () => <span>nested</span>;
  return <NativeNestedChildFixture />;
}
function NativeComplexityFixture({ value }) {
  if (value === 0) return <span>0</span>;
  if (value === 1) return <span>1</span>;
  if (value === 2) return <span>2</span>;
  if (value === 3) return <span>3</span>;
  if (value === 4) return <span>4</span>;
  if (value === 5) return <span>5</span>;
  if (value === 6) return <span>6</span>;
  if (value === 7) return <span>7</span>;
  if (value === 8) return <span>8</span>;
  if (value === 9) return <span>9</span>;
  if (value === 10) return <span>10</span>;
  if (value === 11) return <span>11</span>;
  if (value === 12) return <span>12</span>;
  if (value === 13) return <span>13</span>;
  if (value === 14) return <span>14</span>;
  return <span>fallback</span>;
}
function NativeGiantComponentFixture() {
${giantComponentStatements}
  return <div />;
}
{
  class Map {}
  const shadowedMapState = useState(new Map());
}
const emptyMapReference = useRef(new Map());
const directGlobalMapReference = useRef(new globalThis.Map());
const GlobalSet = globalThis.Set;
const emptySetReference = useRef(new GlobalSet());
const { WeakMap: GlobalWeakMap } = globalThis;
const emptyWeakMapReference = useRef(new GlobalWeakMap());
{
  const Map = cache.Map;
  const shadowedMapReference = useRef(new Map());
}
const inertStickyPosition = <header className="sticky z-10" />;
const crushedLetterSpacing = <h1 style={{ letterSpacing: "-0.12em" }}>Readable heading</h1>;
const inlineBounceEasing = <div className="animate-bounce" />;
const proportionalNumericData = <table><tbody><tr><td>{total.toLocaleString()}</td></tr></tbody></table>;
const excessiveFontFamilies = <main><h1 style={{ fontFamily: "Fraunces" }}>Title</h1><p style={{ fontFamily: "Inter" }}>Body</p><code style={{ fontFamily: "JetBrains Mono" }}>Code</code><aside style={{ fontFamily: "Caveat" }}>Note</aside></main>;
const repeatedSectionShells = <main><section className="py-20"><div className="mx-auto max-w-6xl">Intro</div></section><section className="py-24"><div className="mx-auto max-w-6xl">Features</div></section><section className="py-20"><div className="mx-auto max-w-6xl">Pricing</div></section></main>;
const oversizedLongHeading = <><h1 className="text-8xl">Build a better workflow for every team in your growing organization</h1><h1 style={{ fontSize: "5rem" }}>Build a better workflow for every team in your growing organization</h1></>;
const flatPageTypeScale = <main><p style={{ fontSize: 14 }}>A</p><h2 style={{ fontSize: 16 }}>B</h2><h1 style={{ fontSize: 18 }}>C</h1></main>;
const smallFormControlText = <><input className="text-xs" style={{ fontSize: 14 }} /><input type="hidden" style={{ fontSize: 12 }} /></>;
const proseEmDash = <p>The tool is fast — blazingly fast — and simple to use.</p>;
const redundantPaddingAxes = <div className="px-4 py-4" />;
const redundantSizeAxes = <><svg className="w-4 h-4" /><svg className="w-6 h-6" /></>;
const spaceOnFlexChildren = <div className="flex space-x-4"><span /><span /></div>;
const threePeriodEllipsis = <button>Loading...</button>;
const vagueButtonLabel = <button>Click here</button>;
const sortedCopy = [...items].sort();
function readCachedTheme(items) {
  const theme = localStorage.getItem("theme");
  items.map(() => localStorage.getItem("theme"));
  return theme;
}
function readUnrelatedTheme() {
  return localStorage.getItem("theme");
}
function renderPalette(rows, theme, render, nextPalette) {
  for (const row of rows) {
    render(theme.colors.primary, row);
    render(theme.colors.primary, row);
    render(theme.colors.primary, row);
  }
  for (const row of rows) {
    render(theme.colors.secondary, row);
    render(theme.colors.secondary, row);
    theme.colors = nextPalette(row);
    render(theme.colors.secondary, row);
  }
}
const LazyRoutePage = (React.lazy(() => import("./lazy-route-page")));
const ResourceRouteDownload = () => <DomLink to="/resource-route?download=1" reloadDocument={false as const}>Download</DomLink>;
const routerWithSplatPaths = makeBrowserRouter([
  { path: "/lazy-route", Component: (LazyRoutePage), ErrorBoundary: RouteError },
  { path: "/files/*/edit", element: <Editor />, ErrorBoundary: RouteError },
  {
    path: "/files/*",
    ErrorBoundary: RouteError,
    children: [
      { path: "details/*/edit", element: <DetailEditor /> },
      { path: "details/*", element: <Details /> },
    ],
  },
  {
    path: "/admin",
    ErrorBoundary: RouteError,
    children: [
      { path: "/settings", element: <Settings /> },
      { path: "/admin/settings", element: <AdminSettings /> },
    ],
  },
  { path: "/empty-route", ErrorBoundary: RouteError },
  { path: "/resource-route", loader: loadResourceRoute, ErrorBoundary: RouteError },
  { path: "/uncovered-route", element: <UncoveredRoute /> },
  {
    path: "/route-validity",
    ErrorBoundary: RouteError,
    children: [
      {
        index: true,
        Component: RouteHome,
        element: <RouteHome />,
        children: [{ path: "child", element: <RouteChild /> }],
      },
    ],
  },
  {
    id: "duplicate-route-id",
    path: "/first-explicit-id",
    loader: loadFirstExplicitRoute,
    ErrorBoundary: RouteError,
  },
  {
    id: "duplicate-route-id",
    path: "/second-explicit-id",
    loader: loadSecondExplicitRoute,
    ErrorBoundary: RouteError,
  },
]);
useInput(() => {
  process.exit();
});
function InkMeasuredDuringRender({ node }) {
  measureElement(node);
  return null;
}
function InkFocusChangedDuringRender() {
  const focusManager = useFocusManager();
  focusManager.focus("name");
  return null;
}
function InkRawModeChangedDuringRender() {
  const { setRawMode } = useStdin();
  setRawMode(true);
  return null;
}
const InkLayoutInsideText = () => <InkText><InkBox /></InkText>;
const InkDomHost = () => <InkBox><div /></InkBox>;
const InkDomRouter = () => <InkBox><DomLink to="/" /></InkBox>;
const InkStaticReordered = ({ items }) => <InkStatic items={items.toReversed()}>{item => <InkText key={item.id}>{item.label}</InkText>}</InkStatic>;
const InkStaticMissingKey = ({ items }) => <InkStatic items={items}>{item => <InkText>{item.label}</InkText>}</InkStatic>;
const InkMultipleStatic = () => <><InkStatic items={[]} /><InkStatic items={[]} /></>;
const FirstInkStatic = () => <InkStatic items={[]} />;
const SecondInkStatic = () => <InkStatic items={[]} />;
const InkConditionalStatic = ({ compact }) => <>{compact ? <InkStatic items={[]} /> : <InkStatic items={[]} />}</>;
const InkLogicalStatic = ({ compact }) => <>{compact && <InkStatic items={[]} />}{!compact && <InkStatic items={[]} />}</>;
const InkTextAriaSemantics = () => <InkText aria-role="dialog" aria-state={{ checked: true }}>Open</InkText>;
const InkInvalidAriaRole = () => <InkBox aria-role="dialog" />;
const InkInvalidAriaState = () => <InkBox aria-state={{ pressed: true }} />;
const InkHiddenAriaLabel = () => <InkBox aria-hidden aria-label="Hidden" />;
const InkPastedInput = () => { useInput(input => { if (input.includes("\\n")) acceptPaste(input); }); return null; };
const InkOrdinaryInputLength = () => { useInput(input => { if (input.length >= 1) acceptInput(input); }); return null; };
const InkUnicodeCursor = ({ label }) => { const cursor = useCursor(); cursor.setCursorPosition({ x: label.length, y: 0 }); return null; };
const InkAsciiCursor = () => { const label = "Ready"; const cursor = useCursor(); cursor.setCursorPosition({ x: label.length, y: 0 }); return null; };
const InkUnsuspendedChild = () => { useInput(() => { spawnChild("vim", [], { stdio: "inherit" }); }); return null; };
const InkSuspendedChild = () => { const { suspendTerminal } = useApp(); useInput(() => suspendTerminal(() => spawnChild("vim", [], { stdio: "inherit" }))); return null; };
const InkIntervalAnimation = () => { const [frame, setFrame] = useState(0); useEffect(() => { setInterval(() => setFrame(value => value + 1), 80); }, []); return <InkText>{frame}</InkText>; };
const DomIntervalAnimation = () => { const [frame, setFrame] = useState(0); useEffect(() => { setInterval(() => setFrame(value => value + 1), 80); }, []); return <div>{frame}</div>; };
const InkNonReactiveWindowSize = () => <InkText>{process.stdout.columns}</InkText>;
const InkReactiveWindowSize = () => { const [columns, setColumns] = useState(process.stdout.columns); useEffect(() => { const updateColumns = () => setColumns(process.stdout.columns); process.stdout.on("resize", updateColumns); return () => process.stdout.off("resize", updateColumns); }, []); return <InkText>{columns}</InkText>; };
const InkCtrlCHandler = () => { useInput((input, key) => { if (key.ctrl && input === "c") closeApp(); }); return null; };
renderInk(<InkCtrlCHandler />);
const InkSnapshotInput = () => { useInput(() => {}); return null; };
renderInkToString(<InkSnapshotInput />);
const repeatInkRender = () => { renderInk(null); renderInk(null); };
const chooseInkRender = (server) => { if (server) renderInk(null); else renderInk(null); };
const unmountInkRender = () => { const instance = renderInk(null); instance.unmount(); renderInk(null); };
const destructureInkUnmount = () => { const { unmount } = renderInk(null); unmount(); renderInk(null); };
const immediateInkUnmount = () => { renderInk(null).unmount(); renderInk(null); };
const conditionalInkUnmount = (shouldStop) => { const instance = renderInk(null); if (shouldStop) instance.unmount(); renderInk(null); };
const branchInkUnmount = (shouldStop) => { const instance = renderInk(null); if (shouldStop) instance.unmount(); else instance.unmount(); renderInk(null); };
const separateInkOutputs = (firstOutput, secondOutput) => { renderInk(null, { stdout: firstOutput }); renderInk(null, { stdout: secondOutput }); };
const repeatedInkOutput = (output) => { renderInk(null, { stdout: output }); renderInk(null, { stdout: output }); };
const explicitDefaultInkOutput = () => { renderInk(null); renderInk(null, { stdout: process.stdout }); };
const InkRawText = () => <InkBox>plain{"string"}{7}{\`template\`}</InkBox>;
const InkFragmentRawText = () => <InkBox><>short</><React.Fragment>named</React.Fragment></InkBox>;
const LocalInkUnsafe = ({ children }) => <InkBox>{children}</InkBox>;
const LocalInkSafe = ({ children }) => <InkText>{children}</InkText>;
const InkWrapperRawText = () => <InkBox><LocalInkUnsafe>bad</LocalInkUnsafe><LocalInkSafe>good</LocalInkSafe></InkBox>;
const OuterInkUnsafe = ({ children }) => <InnerInkUnsafe>{children}</InnerInkUnsafe>;
const InnerInkUnsafe = ({ children }) => <InkBox>{children}</InkBox>;
const InkWrapperChainRawText = () => <OuterInkUnsafe>bad</OuterInkUnsafe>;
const InkImportedRawText = () => <InkBox><ImportedInkPanel>bad</ImportedInkPanel><ImportedInkLabel>good</ImportedInkLabel></InkBox>;
const InkShadowedImportedWrapper = (ImportedInkPanel) => <ImportedInkPanel>good</ImportedInkPanel>;
async function buildAsyncReduce(items) {
  const object = await items.reduce(async (accumulator, item) => {
    accumulator[item.id] = await getItem(item);
    return accumulator;
  }, {});
  const tuple = await items["reduceRight"](async ([sum, count], item) => {
    const value = await getItem(item);
    return [sum + value, count + 1];
  }, [0, 0]);
  const safe = await items.reduce(async (previous, item) => {
    const accumulator = await previous;
    accumulator[item.id] = await getItem(item);
    return accumulator;
  }, Promise.resolve({}));
  return { object, tuple, safe };
}
const ActivityEffectChild = () => { useEffect(() => subscribe(), []); return null; };
const ActivityEffectScreen = ({ open }) => <ReactActivity mode={open ? "visible" : "hidden"}><ActivityEffectChild /></ReactActivity>;
function AdvancedEventHandlerRefsExample({ onResize }) {
  useEffect(() => {
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onResize]);
  return null;
}
function swallowedNextRedirect() {
  try {
    nextRedirect("/login");
  } catch (error) {
    console.error(error);
  }
}
function NextCssLinkExample() {
  return <link rel="stylesheet" href="/styles.css" />;
}
function MultipleRouteBlockersExample() {
  useRouteBlocker(true);
  useRouteBlocker(false);
  return null;
}
function MultipleSearchParamUpdatesExample({ compact }) {
  const [, setRouteSearchParams] = useRouteSearchParams();
  const update = () => {
    setRouteSearchParams({ page: "1" });
    setRouteSearchParams({ view: "compact" });
  };
  const updateAfterSave = async () => {
    setRouteSearchParams({ phase: "start" });
    await save();
    setRouteSearchParams({ phase: "done" });
  };
  const updateView = () => compact
    ? setRouteSearchParams({ view: "compact" })
    : setRouteSearchParams({ view: "full" });
  const updateNever = () => {
    if (false) {
      setRouteSearchParams({ hidden: "first" });
      setRouteSearchParams({ hidden: "second" });
    }
  };
  const updateAfterGuard = () => {
    if (compact) {
      setRouteSearchParams({ guard: "compact" });
      return;
    }
    setRouteSearchParams({ guard: "full" });
  };
  void updateNever;
  void updateAfterGuard;
  return <button onClick={update} onFocus={updateAfterSave} onBlur={updateView} />;
}
function UnsynchronizedSearchParamsExample() {
  const [searchParams] = useRouteSearchParams();
  searchParams.set("tab", "all");
  return null;
}
export const middleware = [async (_context, next) => {
  try {
    return await next();
  } catch (error) {
    return new Response(String(error), { status: 500 });
  }
}, async (_context, next) => {
  const response = await next();
  await response.json();
  return response;
}, async (_context, next) => {
  await next();
  return next();
}, async ({ enabled }, next) => enabled ? next() : next(),
async (_context, next) => {
  observe(next);
  observe(next);
  return new Response();
}, async (_context, next) => {
  await next();
}];
const { getSession: getRouteSession, commitSession: commitRouteSession, destroySession: destroyRouteSession } = makeCookieSessionStorage({ cookie: { name: "session", expires: new Date(Date.now() + 1000) } });
makeBrowserRouter([{ path: "/loader-data-error", element: <main />, ErrorBoundary: function LoaderDataErrorBoundary() {
  const data = useRouteLoaderData();
  return <pre>{data.message}</pre>;
} }, { path: "/session", ErrorBoundary: SessionErrorBoundary, action: async ({ request }) => {
  const session = await getRouteSession(request.headers.get("Cookie"));
  session.set("user", "a");
  return null;
}, loader: async ({ request }) => {
  const session = await getRouteSession(request.headers.get("Cookie"));
  session.set("loaderNotice", "hello");
  return null;
} }, { path: "/safe-session", ErrorBoundary: SessionErrorBoundary, action: async ({ request }) => {
  const session = await getRouteSession(request.headers.get("Cookie"));
  session.set("user", "a");
  const cookie = await commitRouteSession(session);
  return routeRedirect("/", { headers: { "Set-Cookie": cookie } });
}, loader: async ({ request }) => {
  const session = await getRouteSession(request.headers.get("Cookie"));
  return routeRedirect("/", { headers: { "Set-Cookie": await destroyRouteSession(session) } });
} }]);
export async function action({ request }) {
  const session = await getRouteSession(request.headers.get("Cookie"));
  session.set("ignoredOutsideRouteModule", true);
  return null;
}
`;

const normalizeDiagnostics = (diagnostics) =>
  diagnostics
    .filter(
      (diagnostic) =>
        typeof diagnostic.code === "string" &&
        nativeRules.some((nativeRuleId) => diagnostic.code.includes(`(${nativeRuleId})`)),
    )
    .map((diagnostic) => ({
      code: diagnostic.code.replace("react-doctor-native", "react-doctor"),
      filename: path.relative(repositoryRoot, path.resolve(repositoryRoot, diagnostic.filename)),
      message: diagnostic.message,
      severity: diagnostic.severity,
      labels: diagnostic.labels,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const countDiagnosticsByRule = (diagnostics) => {
  const counts = Object.fromEntries(nativeRules.map((nativeRuleId) => [nativeRuleId, 0]));
  for (const diagnostic of diagnostics) {
    const ruleId = nativeRules.find((candidateRuleId) =>
      diagnostic.code.includes(`(${candidateRuleId})`),
    );
    if (ruleId) counts[ruleId] += 1;
  }
  return counts;
};

const runOxlint = (configPath, environment, targetPath = fixturePath) => {
  const startedAt = performance.now();
  const result = spawnSync(
    process.execPath,
    [oxlintBinaryPath, "-c", configPath, "--format", "json", targetPath],
    {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
      maxBuffer: OXLINT_OUTPUT_MAX_BYTES,
    },
  );
  if (result.error) throw result.error;
  if (!result.stdout) {
    throw new Error(result.stderr || `oxlint exited with status ${result.status}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `oxlint returned non-JSON output\nstdout=${result.stdout}\nstderr=${result.stderr}`,
      { cause: error },
    );
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `oxlint exited with status ${result.status}`);
  }
  return {
    durationMs: performance.now() - startedAt,
    diagnostics: normalizeDiagnostics(parsed.diagnostics),
  };
};

const buildConfig = ({ isNative, settings, ruleIds = nativeRules }) => ({
  categories: DISABLED_RULE_CATEGORIES,
  plugins: isNative ? ["react-doctor-native"] : [],
  jsPlugins: isNative ? [] : [pluginPath],
  settings,
  rules: Object.fromEntries(
    ruleIds.map((nativeRuleId) => [
      `${isNative ? "react-doctor-native" : "react-doctor"}/${nativeRuleId}`,
      "warn",
    ]),
  ),
});

try {
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDirectory, "package.json"),
    JSON.stringify({ dependencies: { ink: "^7.1.0" } }),
  );
  fs.writeFileSync(fixturePath, fixture);
  fs.writeFileSync(
    motionConfigFixturePath,
    `import React from "react";\nimport { MotionConfig } from "motion/react";\nexport const App = () => <MotionConfig reducedMotion="never"><main /></MotionConfig>;\n`,
  );
  fs.mkdirSync(path.dirname(tanstackRouteFixturePath), { recursive: true });
  fs.writeFileSync(
    tanstackRouteFixturePath,
    `import React from "react";
const AnchorAlias = "a" as const;
export const RouteLinks = () => <>
  <a href="/dashboard">Dashboard</a>
  <AnchorAlias href={"/settings?tab=profile"}>Settings</AnchorAlias>
  <a href="//cdn.example.com/asset">CDN</a>
  <a href="/api/export">Export</a>
  <a href="/resume.pdf" download>Resume</a>
  <a href="/docs" target={"_blank"}>Docs</a>
</>;
createFileRoute("/parallel")({ loader: async () => { const first = await loadFirst(); const second = await loadSecond(); return { first, second }; } });
createFileRoute("/siblings")({ loader: async () => { const user = await loadUser(); const posts = await loadPosts(user.id); const comments = await loadComments(user.id); return { posts, comments }; } });
createFileRoute("/dependent")({ loader: async () => { const user = await loadUser(); const posts = await loadPosts(user.id); return posts; } });
createFileRoute("/laundered")({ loader: async () => { const user = await loadUser(); const userId = user.id; const posts = await loadPosts(userId); return posts; } });
createFileRoute("/later-independent")({ loader: async () => { const user = await loadUser(); const posts = await loadPosts(user.id); const teams = await loadTeams(); return { posts, teams }; } });
createFileRoute("/for-await")({ loader: async () => { for await (const first of loadFirst()) consume(first); for await (const second of loadSecond()) consume(second); } });
createFileRoute("/assigned")({ loader: async () => { let first; let second; first = await loadFirst(); second = await loadSecond(); return { first, second }; } });
async function swallowedRedirect() { try { throw redirect({ to: "/login" }); } catch (error) { console.error(error); } }
async function swallowedNotFound() { try { throw notFound(); } catch (error) { return null; } }
function swallowedIifeRedirect() { try { (() => { throw redirect({ to: "/login" }); })(); } catch (error) { console.error(error); } }
async function rethrownRedirect() { try { throw redirect({ to: "/login" }); } catch (error) { throw error; } }
function deferredRedirect() { try { setTimeout(() => { throw redirect({ to: "/login" }); }); } catch (error) { console.error(error); } }
async function outerSwallowedRedirect() { try { try { throw redirect({ to: "/done" }); } catch (error) { throw error; } } catch (outerError) { console.error(outerError); } }
function DirectEffectFetch() { useEffect(() => { fetch("/api/direct"); }, []); return null; }
function LocalEffectFetch() { useEffect(() => { const load = () => { fetch("/api/local"); }; load(); }, []); return null; }
function PromiseEffectFetch() { useEffect(() => { loadConfig().then(() => { fetch("/api/promise"); }); }, []); return null; }
function AsyncIifeEffectFetch() { useEffect(() => { (async () => { await fetch("/api/iife"); })(); }, []); return null; }
function LayoutEffectFetch() { useLayoutEffect(() => { fetch("/api/layout"); }, []); return null; }
function LocalHookNameFetch() { const useEffect = (callback) => callback(); useEffect(() => { fetch("/api/local-hook"); }); return null; }
function MemberHookNameFetch() { hooks.useEffect(() => { fetch("/api/member-hook"); }); return null; }
function ComputedIdentifierHookNameFetch() { hooks[useEffect](() => { fetch("/api/computed-hook"); }); return null; }
function DeferredEffectFetch() { useEffect(() => { setInterval(() => { fetch("/api/timer"); }, 1000); }, []); return null; }
function EventHandlerEffectFetch() { useEffect(() => { const refresh = () => { fetch("/api/event"); }; window.addEventListener("online", refresh); }, []); return null; }
function ComputedStringHookNameFetch() { hooks["useEffect"](() => { fetch("/api/computed-string-hook"); }); return null; }
createServerFn().handler(async () => { await db.update({ active: true }); });
(createServerFn() as any).handler(() => cookies().set("session", "active"));
createServerFn({ method: "GET" }).handler(() => fetch("/api/notify", { method: "POST" }));
createServerFn({ method: "get" }).handler(() => db.users.delete("123"));
createServerFn().handler(async () => { const cookieStore = await cookies(); cookieStore.delete("session"); });
createServerFn().handler(() => { const deferredMutation = () => db.insert({ active: true }); return deferredMutation; });
createServerFn().handler(function () { db.destroy({ id: "123" }); });
createServerFn().handler(() => db[update]({ active: true }));
createServerFn()[handler](() => db.remove({ id: "123" }));
createServerFn().handler(() => fetch("/api/computed-method", { [method]: "POST" }));
createServerFn({ "method": "POST" }).handler(() => db.upsert({ id: "123" }));
createServerFn({ method: "POST" }).handler(() => db.create({ active: true }));
createServerFn({ method: "PATCH" }).handler(() => db.update({ active: true }));
createServerFn({ [method]: "POST" }).handler(() => db.insert({ active: true }));
createServerFn().handler(() => { const customHeaders = new Headers(); customHeaders.set("x-trace", "abc"); });
createServerFn().handler(() => { const localCache = new Map(); localCache.set("hit", true); });
createServerFn().handler(() => { const response = NextResponse.json({ ok: true }); response.headers.set("x-trace", "abc"); });
createServerFn().handler(() => fetch("/api/quoted-method", { "method": "POST" }));
createServerFn().handler(namedServerHandler);
createServerFn().handler(() => db["update"]({ active: true }));
otherFactory().handler(() => db.update({ active: true }));
function DirectRenderNavigate() { navigate({ to: "/direct" }); return null; }
function SynchronousIterationNavigate() { items.forEach((item) => navigate({ to: item.path })); return null; }
function LazyStateNavigate() { useState(() => { navigate({ to: "/state" }); return 0; }); return null; }
function SyncExternalStoreNavigate() { useSyncExternalStore(() => { navigate({ to: "/store" }); return value; }); return null; }
function TransitionNavigate() { startTransition(() => navigate({ to: "/transition" })); return null; }
function LocalHelperNavigate() { const go = () => navigate({ to: "/helper" }); go(); return null; }
function IifeNavigate() { (() => navigate({ to: "/iife" }))(); return null; }
function ComputedPromiseNavigate() { doThing()[then](() => navigate({ to: "/computed-promise" })); return null; }
function MemberCustomHookNavigate() { hooks.useInterval(() => navigate({ to: "/member-hook" }), 1000); return null; }
function SecondArgumentCustomHookNavigate() { useInterval(1000, () => navigate({ to: "/second-argument" })); return null; }
function DeferredEffectNavigate() { useEffect(() => navigate({ to: "/effect" }), []); return null; }
function DeferredLayoutEffectNavigate() { useLayoutEffect(() => navigate({ to: "/layout-effect" }), []); return null; }
function DeferredMemoNavigate() { useMemo(() => navigate({ to: "/memo" }), []); return null; }
function DeferredCallbackNavigate() { useCallback(() => navigate({ to: "/callback" }), []); return null; }
function CustomHookCallbackNavigate() { useInterval(() => navigate({ to: "/custom-hook" }), 1000); return null; }
function PromiseCallbackNavigate() { doThing().then(() => navigate({ to: "/promise" })); return null; }
function InlineHandlerNavigate() { return <button onClick={() => navigate({ to: "/inline" })}>Open dashboard</button>; }
function ObjectHandlerNavigate() { useForm({ "onSubmit": () => navigate({ to: "/submit" }) }); return null; }
function NamedHandlerNavigate() { const handleSubmit = () => navigate({ to: "/named" }); return handleSubmit; }
function WiredHandlerNavigate() { const goHome = () => navigate({ to: "/wired" }); return <button onClick={goHome}>Open dashboard</button>; }
export const useExplicitNavigate = () => { return () => navigate({ to: "/explicit-return" }); };
export const useImplicitNavigate = () => () => navigate({ to: "/implicit-return" });
function ZeroArgumentNavigate() { navigate(); return null; }
function MemberNavigate() { router.navigate({ to: "/member" }); return null; }
`,
  );
  fs.writeFileSync(
    tanstackRootFixturePath,
    `import React from "react";
export const Route = createRootRoute({
  component: () => <html lang="en"><head><meta charSet="utf-8" /></head><body><main>Root</main></body></html>,
});`,
  );
  fs.mkdirSync(path.dirname(tanstackSafeRootFixturePath), { recursive: true });
  fs.writeFileSync(
    tanstackSafeRootFixturePath,
    `import React from "react";
import * as TanStackRouter from "@tanstack/react-router";
import { HeadContent as AppHead } from "@tanstack/react-router";
const RouterScripts = TanStackRouter.Scripts;
const AppScripts = () => <RouterScripts />;
const AppShell = () => <AppScripts />;
const RootDocument = () => <html lang="en"><head><AppHead /></head><body><main>Safe root</main><AppShell /></body></html>;
class ClassRoot extends React.Component { render() { return <html><body><TanStackRouter.Scripts /></body></html>; } }
const ValueRoot = () => { const scripts = <RouterScripts />; return <html><body>{scripts}</body></html>; };
const routeOptions = { component: RootDocument };
const makeRootRoute = TanStackRouter.createRootRoute;
export const Route = makeRootRoute(routeOptions);
export const ClassRoute = TanStackRouter.createRootRoute({ component: ClassRoot });
export const ValueRoute = TanStackRouter.createRootRoute({ component: ValueRoot });`,
  );
  fs.writeFileSync(
    inkWrapperFixturePath,
    `import React from "react";\nimport { Box, Text } from "ink";\nexport const ImportedInkPanel = ({ children }) => <Box>{children}</Box>;\nexport const ImportedInkLabel = ({ children }) => <Text>{children}</Text>;\n`,
  );
  fs.writeFileSync(
    reactRouterConfigFixturePath,
    "const config = { future: { v8_middleware: true, unstable_previewServerPrerendering: true } }; export default config;\n",
  );
  fs.writeFileSync(
    globalErrorFixturePath,
    `'use client';\nimport React from "react";\nexport default function GlobalError() { return <div />; }\n`,
  );
  fs.writeFileSync(ogImageFixturePath, 'export const runtime = "edge";');
  fs.mkdirSync(path.dirname(routeHandlerFixturePath), { recursive: true });
  fs.writeFileSync(routeHandlerFixturePath, "export default function handler() {}\n");
  fs.writeFileSync(
    asyncClientFixturePath,
    `'use client';\nimport React from "react";\nexport default async function AsyncProfile() { return <div />; }\nconst AsyncSettings = async () => <section />;\nconst FrozenClient = Object.freeze(Object.seal(async () => <main />));\nconst SyncClient = Object.freeze(() => <aside />);\n`,
  );
  fs.mkdirSync(path.dirname(safeGlobalErrorFixturePath), { recursive: true });
  fs.writeFileSync(
    safeGlobalErrorFixturePath,
    `'use client';\nimport React from "react";\nexport default function GlobalError() { return <html lang="en"><body /></html>; }\n`,
  );
  fs.writeFileSync(safePageFixturePath, 'export const runtime = "edge";\n');
  fs.mkdirSync(path.dirname(safeRouteHandlerFixturePath), { recursive: true });
  fs.writeFileSync(
    safeRouteHandlerFixturePath,
    "export const GET = () => new Response();\nexport default function handler() {}\n",
  );
  fs.writeFileSync(
    nonProductionFixturePath,
    `const shortcut = <button accessKey="s" />; const classicJsx = <div />; const inlineNextScript = <Script>window.analytics = true;</Script>; const smallTestInput = <input style={{ fontSize: 14 }} />; function nested(first, second, third, fourth) { if (first) { if (second) { if (third) { if (fourth) run(); } } } } items.map((item) => item.value).filter(Boolean); useEffect(() => {}, [{}]); useRef(buildCache()); useState(buildRows()); useState(new Worker("worker.js")); useMemo(() => value + 1, [value]); function TestCounter() { const [count, setCount] = useState(0); setTimeout(() => setCount(count + 1), 0); } function TestEventEffect() { const [payload, setPayload] = useState(null); useEffect(() => { if (payload) post(payload); }, [payload]); return { onClick: () => setPayload({ ok: true }) }; }`,
  );
  fs.writeFileSync(
    deepNonProductionFixturePath,
    `import React from "react"; const deeplyNestedTestJsx = <div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><span /></div></div></div></div></div></div></div></div></div></div></div></div></div></div></div>;`,
  );
  fs.writeFileSync(
    nonReactJsxFixturePath,
    `import { createSignal } from "solid-js";
export const SolidGiant = () => {
  createSignal(0);
${giantComponentStatements}
  return <div />;
};
export const SolidParent = ({ value }) => {
  const SolidChild = () => <span />;
${nonReactComplexityBranches}
  return <SolidChild />;
};
`,
  );
  fs.writeFileSync(
    configuredFixturePath,
    `
import React, { Component } from "react";
class ConfiguredState extends Component {
  state = {};
  componentWillMount() {}
  constructor() {
    super();
    this.state = {};
    this["state"] = {};
    this[state] = {};
  }
  render() { return <Widget ref={\`legacy-\${id}\`} />; }
}
const configuredBooleanProps = <Widget enabled compact={true} />;
const configuredHeading = <Title />;
const configuredAllowedInvalidRole = <div role="datepicker" />;
const configuredInvalidCustomRole = <Widget role="custom-invalid" />;
const configuredAmbiguousAnchor = <a href="https://example.com/continue">continue</a>;
const configuredAllowedInteractiveRole = <button role="article">Save</button>;
const configuredAllowedNoninteractiveRole = <h1 role="button">Open</h1>;
const configuredDeepJsx = <div><section><span><em /></span></section></div>;
const configuredCompetingDeepJsx = <div><section><span><em /></span><Widget render={() => <section><span><em /></span></section>} /></section></div>;
const configuredOversizedLongHeading = <h1 className="text-8xl">Build a better workflow for every team in your growing organization</h1>;
const configuredFlatPageTypeScale = <main><p className="text-sm">A</p><h2 className="text-base">B</h2><h1 className="text-lg">C</h1></main>;
const configuredSmallFormControlText = <><input className="text-sm" /><input className="hidden md:block text-xs" /></>;
`,
  );
  const routerGateFixture =
    'import { createBrowserRouter, useNavigate } from "react-router-dom"; export function App() { const navigate = useNavigate(); navigate("/next"); createBrowserRouter([]); return null; }';
  fs.mkdirSync(path.dirname(inactiveRouterFixturePath), { recursive: true });
  fs.writeFileSync(
    path.join(inactiveRouterFixtureDirectory, "package.json"),
    JSON.stringify({ dependencies: { react: "latest" } }),
  );
  fs.writeFileSync(inactiveRouterFixturePath, routerGateFixture);
  fs.mkdirSync(path.dirname(activeRouterFixturePath), { recursive: true });
  fs.writeFileSync(
    path.join(activeRouterFixtureDirectory, "package.json"),
    JSON.stringify({ dependencies: { "react-router-dom": "latest" } }),
  );
  fs.writeFileSync(activeRouterFixturePath, routerGateFixture);
  fs.mkdirSync(path.dirname(environmentRouteFixturePath), { recursive: true });
  fs.writeFileSync(
    environmentRouteFixturePath,
    "export default function DashboardRoute() { return null; }\n",
  );
  fs.mkdirSync(path.dirname(frameworkEnvironmentRouteFixturePath), { recursive: true });
  fs.writeFileSync(
    path.join(frameworkRouterFixtureDirectory, "package.json"),
    JSON.stringify({ dependencies: { "@react-router/dev": "latest" } }),
  );
  fs.writeFileSync(
    frameworkEnvironmentRouteFixturePath,
    "export default function DashboardRoute() { return null; }\n",
  );
  fs.writeFileSync(
    stockConfigPath,
    JSON.stringify(buildConfig({ isNative: false, settings: REACT_DOCTOR_SETTINGS })),
  );
  fs.writeFileSync(
    nativeConfigPath,
    JSON.stringify(buildConfig({ isNative: true, settings: REACT_DOCTOR_SETTINGS })),
  );
  fs.writeFileSync(
    corpusStockConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: false,
        settings: REACT_DOCTOR_SETTINGS,
        ruleIds: corpusRuleIds,
      }),
    ),
  );
  fs.writeFileSync(
    corpusNativeConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: true,
        settings: REACT_DOCTOR_SETTINGS,
        ruleIds: corpusRuleIds,
      }),
    ),
  );
  fs.writeFileSync(
    nonReactJsxStockConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: false,
        settings: REACT_DOCTOR_SETTINGS,
        ruleIds: REACT_JSX_ONLY_COHORT_RULE_IDS,
      }),
    ),
  );
  fs.writeFileSync(
    nonReactJsxNativeConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: true,
        settings: REACT_DOCTOR_SETTINGS,
        ruleIds: REACT_JSX_ONLY_COHORT_RULE_IDS,
      }),
    ),
  );
  const configuredRuleIds = [
    "heading-has-content",
    "jsx-boolean-value",
    "no-string-refs",
    "state-in-constructor",
    "aria-activedescendant-has-tabindex",
    "aria-role",
    "anchor-ambiguous-text",
    "no-interactive-element-to-noninteractive-role",
    "no-noninteractive-element-to-interactive-role",
    "jsx-max-depth",
    "no-unsafe",
    "no-oversized-long-heading",
    "no-flat-page-type-scale",
    "no-small-form-control-text",
  ];
  fs.writeFileSync(
    configuredStockConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: false,
        settings: CONFIGURED_REACT_DOCTOR_SETTINGS,
        ruleIds: configuredRuleIds,
      }),
    ),
  );
  fs.writeFileSync(
    configuredNativeConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: true,
        settings: CONFIGURED_REACT_DOCTOR_SETTINGS,
        ruleIds: configuredRuleIds,
      }),
    ),
  );
  const routerRuleIds = [
    "react-router-no-navigate-in-render",
    "react-router-no-route-module-environment-suffix",
    "react-router-no-router-in-render",
    "react-router-v8-no-react-router-dom-import",
  ];
  const routerSettings = {
    "react-doctor": {
      ...REACT_DOCTOR_SETTINGS["react-doctor"],
      rootDirectory: fs.realpathSync(temporaryDirectory),
    },
  };
  fs.writeFileSync(
    routerStockConfigPath,
    JSON.stringify(
      buildConfig({ isNative: false, settings: routerSettings, ruleIds: routerRuleIds }),
    ),
  );
  fs.writeFileSync(
    routerNativeConfigPath,
    JSON.stringify(
      buildConfig({ isNative: true, settings: routerSettings, ruleIds: routerRuleIds }),
    ),
  );
  const stockDiagnostics = runOxlint(stockConfigPath, process.env, fixtureDirectory).diagnostics;
  const nativeEnvironment = {
    ...process.env,
    NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(nativeBindingPath),
  };
  const nativeDiagnostics = runOxlint(
    nativeConfigPath,
    nativeEnvironment,
    fixtureDirectory,
  ).diagnostics;
  const stockDiagnosticCounts = countDiagnosticsByRule(stockDiagnostics);
  if (JSON.stringify(stockDiagnosticCounts) !== JSON.stringify(EXPECTED_DIAGNOSTIC_COUNTS)) {
    throw new Error(
      `unexpected JavaScript diagnostic coverage\nexpected=${JSON.stringify(EXPECTED_DIAGNOSTIC_COUNTS, null, 2)}\nreceived=${JSON.stringify(stockDiagnosticCounts, null, 2)}`,
    );
  }
  if (JSON.stringify(nativeDiagnostics) !== JSON.stringify(stockDiagnostics)) {
    const nativeDiagnosticKeys = new Set(nativeDiagnostics.map(JSON.stringify));
    const stockDiagnosticKeys = new Set(stockDiagnostics.map(JSON.stringify));
    const stockOnlyDiagnostic = stockDiagnostics.find(
      (diagnostic) => !nativeDiagnosticKeys.has(JSON.stringify(diagnostic)),
    );
    const nativeOnlyDiagnostic = nativeDiagnostics.find(
      (diagnostic) => !stockDiagnosticKeys.has(JSON.stringify(diagnostic)),
    );
    throw new Error(
      `native parity failed\nstock count=${stockDiagnostics.length}\nnative count=${nativeDiagnostics.length}\nstock only=${JSON.stringify(stockOnlyDiagnostic, null, 2)}\nnative only=${JSON.stringify(nativeOnlyDiagnostic, null, 2)}`,
    );
  }
  process.stdout.write(`Native parity passed for ${stockDiagnostics.length} diagnostics.\n`);

  const stockNonProductionDiagnostics = runOxlint(
    stockConfigPath,
    process.env,
    nonProductionFixturePath,
  ).diagnostics;
  const nativeNonProductionDiagnostics = runOxlint(
    nativeConfigPath,
    nativeEnvironment,
    nonProductionFixturePath,
  ).diagnostics;
  const expectedNonProductionDiagnosticCounts = {
    ...Object.fromEntries(nativeRules.map((nativeRuleId) => [nativeRuleId, 0])),
    "react-in-jsx-scope": 4,
    "no-small-form-control-text": 1,
    "hook-use-state": 2,
  };
  if (
    JSON.stringify(countDiagnosticsByRule(stockNonProductionDiagnostics)) !==
      JSON.stringify(expectedNonProductionDiagnosticCounts) ||
    JSON.stringify(nativeNonProductionDiagnostics) !== JSON.stringify(stockNonProductionDiagnostics)
  ) {
    throw new Error(
      `native non-production parity failed\nstock=${JSON.stringify(stockNonProductionDiagnostics, null, 2)}\nnative=${JSON.stringify(nativeNonProductionDiagnostics, null, 2)}`,
    );
  }

  const deepNonProductionStockDiagnostics = runOxlint(
    stockConfigPath,
    process.env,
    deepNonProductionFixturePath,
  ).diagnostics;
  const deepNonProductionNativeDiagnostics = runOxlint(
    nativeConfigPath,
    nativeEnvironment,
    deepNonProductionFixturePath,
  ).diagnostics;
  if (
    deepNonProductionStockDiagnostics.length !== 0 ||
    deepNonProductionNativeDiagnostics.length !== 0
  ) {
    throw new Error(
      `native deep non-production parity failed\nstock=${JSON.stringify(deepNonProductionStockDiagnostics, null, 2)}\nnative=${JSON.stringify(deepNonProductionNativeDiagnostics, null, 2)}`,
    );
  }

  const nonReactJsxStockDiagnostics = runOxlint(
    nonReactJsxStockConfigPath,
    process.env,
    nonReactJsxFixturePath,
  ).diagnostics;
  const nonReactJsxNativeDiagnostics = runOxlint(
    nonReactJsxNativeConfigPath,
    nativeEnvironment,
    nonReactJsxFixturePath,
  ).diagnostics;
  if (nonReactJsxStockDiagnostics.length !== 0 || nonReactJsxNativeDiagnostics.length !== 0) {
    throw new Error(
      `native non-React JSX parity failed\nstock=${JSON.stringify(nonReactJsxStockDiagnostics, null, 2)}\nnative=${JSON.stringify(nonReactJsxNativeDiagnostics, null, 2)}`,
    );
  }

  const configuredStockDiagnostics = runOxlint(
    configuredStockConfigPath,
    process.env,
    configuredFixturePath,
  ).diagnostics;
  const configuredNativeDiagnostics = runOxlint(
    configuredNativeConfigPath,
    nativeEnvironment,
    configuredFixturePath,
  ).diagnostics;
  const expectedConfiguredDiagnosticCounts = {
    ...Object.fromEntries(nativeRules.map((nativeRuleId) => [nativeRuleId, 0])),
    "heading-has-content": 1,
    "jsx-boolean-value": 2,
    "no-string-refs": 1,
    "state-in-constructor": 3,
    "aria-role": 1,
    "anchor-ambiguous-text": 1,
    "jsx-max-depth": 2,
    "no-unsafe": 1,
    "no-oversized-long-heading": 1,
    "no-flat-page-type-scale": 1,
    "no-small-form-control-text": 1,
  };
  if (
    JSON.stringify(countDiagnosticsByRule(configuredStockDiagnostics)) !==
      JSON.stringify(expectedConfiguredDiagnosticCounts) ||
    JSON.stringify(configuredNativeDiagnostics) !== JSON.stringify(configuredStockDiagnostics)
  ) {
    throw new Error(
      `native configured parity failed\nstock=${JSON.stringify(configuredStockDiagnostics, null, 2)}\nnative=${JSON.stringify(configuredNativeDiagnostics, null, 2)}`,
    );
  }

  const inactiveRouterStockDiagnostics = runOxlint(
    routerStockConfigPath,
    process.env,
    inactiveRouterFixturePath,
  ).diagnostics;
  const inactiveRouterNativeDiagnostics = runOxlint(
    routerNativeConfigPath,
    nativeEnvironment,
    inactiveRouterFixturePath,
  ).diagnostics;
  if (inactiveRouterStockDiagnostics.length !== 0 || inactiveRouterNativeDiagnostics.length !== 0) {
    throw new Error(
      `native inactive React Router package parity failed\nstock=${JSON.stringify(inactiveRouterStockDiagnostics, null, 2)}\nnative=${JSON.stringify(inactiveRouterNativeDiagnostics, null, 2)}`,
    );
  }
  const activeRouterStockDiagnostics = runOxlint(
    routerStockConfigPath,
    process.env,
    activeRouterFixturePath,
  ).diagnostics;
  const activeRouterNativeDiagnostics = runOxlint(
    routerNativeConfigPath,
    nativeEnvironment,
    activeRouterFixturePath,
  ).diagnostics;
  if (
    activeRouterStockDiagnostics.length !== 3 ||
    JSON.stringify(activeRouterNativeDiagnostics) !== JSON.stringify(activeRouterStockDiagnostics)
  ) {
    throw new Error(
      `native active React Router package parity failed\nstock=${JSON.stringify(activeRouterStockDiagnostics, null, 2)}\nnative=${JSON.stringify(activeRouterNativeDiagnostics, null, 2)}`,
    );
  }
  const environmentRouteStockDiagnostics = runOxlint(
    routerStockConfigPath,
    process.env,
    environmentRouteFixturePath,
  ).diagnostics;
  const environmentRouteNativeDiagnostics = runOxlint(
    routerNativeConfigPath,
    nativeEnvironment,
    environmentRouteFixturePath,
  ).diagnostics;
  if (
    environmentRouteStockDiagnostics.length !== 0 ||
    JSON.stringify(environmentRouteNativeDiagnostics) !==
      JSON.stringify(environmentRouteStockDiagnostics)
  ) {
    throw new Error(
      `native React Router route module parity failed\nstock=${JSON.stringify(environmentRouteStockDiagnostics, null, 2)}\nnative=${JSON.stringify(environmentRouteNativeDiagnostics, null, 2)}`,
    );
  }
  const frameworkEnvironmentRouteStockDiagnostics = runOxlint(
    routerStockConfigPath,
    process.env,
    frameworkEnvironmentRouteFixturePath,
  ).diagnostics;
  const frameworkEnvironmentRouteNativeDiagnostics = runOxlint(
    routerNativeConfigPath,
    nativeEnvironment,
    frameworkEnvironmentRouteFixturePath,
  ).diagnostics;
  if (
    frameworkEnvironmentRouteStockDiagnostics.length !== 1 ||
    JSON.stringify(frameworkEnvironmentRouteNativeDiagnostics) !==
      JSON.stringify(frameworkEnvironmentRouteStockDiagnostics)
  ) {
    throw new Error(
      `native React Router framework route module parity failed\nstock=${JSON.stringify(frameworkEnvironmentRouteStockDiagnostics, null, 2)}\nnative=${JSON.stringify(frameworkEnvironmentRouteNativeDiagnostics, null, 2)}`,
    );
  }

  if (corpusDirectory) {
    const resolvedCorpusDirectory = path.resolve(corpusDirectory);
    const corpusRepositories = fs
      .readdirSync(resolvedCorpusDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((repositoryName) => !excludedCorpusRepositories.has(repositoryName))
      .sort();
    if (corpusRepositories.length === 0) {
      throw new Error(`no repositories found in corpus: ${resolvedCorpusDirectory}`);
    }
    let corpusDiagnosticCount = 0;
    const corpusParityFailures = [];
    for (const repositoryName of corpusRepositories) {
      const repositoryPath = path.join(resolvedCorpusDirectory, repositoryName);
      const repositoryStockDiagnostics = runOxlint(
        corpusStockConfigPath,
        process.env,
        repositoryPath,
      ).diagnostics;
      const repositoryNativeDiagnostics = runOxlint(
        corpusNativeConfigPath,
        nativeEnvironment,
        repositoryPath,
      ).diagnostics;
      if (
        JSON.stringify(repositoryNativeDiagnostics) !== JSON.stringify(repositoryStockDiagnostics)
      ) {
        const nativeDiagnosticKeys = new Set(repositoryNativeDiagnostics.map(JSON.stringify));
        const stockDiagnosticKeys = new Set(repositoryStockDiagnostics.map(JSON.stringify));
        const stockOnlyDiagnostics = repositoryStockDiagnostics.filter(
          (diagnostic) => !nativeDiagnosticKeys.has(JSON.stringify(diagnostic)),
        );
        const nativeOnlyDiagnostics = repositoryNativeDiagnostics.filter(
          (diagnostic) => !stockDiagnosticKeys.has(JSON.stringify(diagnostic)),
        );
        corpusParityFailures.push(
          `native corpus parity failed for ${repositoryName}\nstock count=${repositoryStockDiagnostics.length}\nnative count=${repositoryNativeDiagnostics.length}\nstock only=${JSON.stringify(stockOnlyDiagnostics.slice(0, CORPUS_PARITY_DIFF_LIMIT), null, 2)}\nnative only=${JSON.stringify(nativeOnlyDiagnostics.slice(0, CORPUS_PARITY_DIFF_LIMIT), null, 2)}`,
        );
        continue;
      }
      corpusDiagnosticCount += repositoryStockDiagnostics.length;
    }
    if (corpusParityFailures.length > 0) {
      throw new Error(corpusParityFailures.join("\n\n"));
    }
    process.stdout.write(
      `Native corpus parity passed for ${corpusRepositories.length} repositories and ${corpusDiagnosticCount} diagnostics.\n`,
    );
  }

  if (shouldBenchmark) {
    const benchmarkDirectory = path.join(temporaryDirectory, "benchmark");
    fs.mkdirSync(benchmarkDirectory);
    const benchmarkSource = `${Array.from(
      { length: BENCHMARK_CALL_COUNT_PER_FILE },
      (_unused, index) => `stream.write(value${index});`,
    ).join("\n")}\n`;
    for (let fileIndex = 0; fileIndex < BENCHMARK_FILE_COUNT; fileIndex += 1) {
      fs.writeFileSync(path.join(benchmarkDirectory, `fixture-${fileIndex}.ts`), benchmarkSource);
    }
    runOxlint(stockConfigPath, process.env, benchmarkDirectory);
    runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory);
    const stockDurationsMs = [];
    const nativeDurationsMs = [];
    for (let sampleIndex = 0; sampleIndex < BENCHMARK_SAMPLE_COUNT; sampleIndex += 1) {
      const shouldRunNativeFirst = sampleIndex % 2 === 1;
      if (shouldRunNativeFirst) {
        nativeDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory).durationMs,
        );
        stockDurationsMs.push(
          runOxlint(stockConfigPath, process.env, benchmarkDirectory).durationMs,
        );
      } else {
        stockDurationsMs.push(
          runOxlint(stockConfigPath, process.env, benchmarkDirectory).durationMs,
        );
        nativeDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, benchmarkDirectory).durationMs,
        );
      }
    }
    const median = (values) => {
      const sortedValues = [...values].sort((left, right) => left - right);
      return sortedValues[Math.floor(sortedValues.length / 2)];
    };
    const stockMedianMs = median(stockDurationsMs);
    const nativeMedianMs = median(nativeDurationsMs);
    const speedupPercent = ((stockMedianMs - nativeMedianMs) / stockMedianMs) * 100;
    process.stdout.write(
      `Benchmark p50: JavaScript ${stockMedianMs.toFixed(1)} ms, native ${nativeMedianMs.toFixed(1)} ms, ${speedupPercent.toFixed(1)}% faster.\n`,
    );

    const findingBenchmarkDirectory = path.join(temporaryDirectory, "finding-benchmark");
    fs.mkdirSync(findingBenchmarkDirectory);
    const findingBenchmarkSource = `${Array.from(
      { length: BENCHMARK_FINDING_COUNT_PER_FILE },
      (_unused, index) => `const Empty${index} = <Widget></Widget>;`,
    ).join("\n")}\n`;
    for (let fileIndex = 0; fileIndex < BENCHMARK_FILE_COUNT; fileIndex += 1) {
      fs.writeFileSync(
        path.join(findingBenchmarkDirectory, `fixture-${fileIndex}.tsx`),
        findingBenchmarkSource,
      );
    }
    runOxlint(stockConfigPath, process.env, findingBenchmarkDirectory);
    runOxlint(nativeConfigPath, nativeEnvironment, findingBenchmarkDirectory);
    const stockFindingDurationsMs = [];
    const nativeFindingDurationsMs = [];
    for (let sampleIndex = 0; sampleIndex < BENCHMARK_SAMPLE_COUNT; sampleIndex += 1) {
      const shouldRunNativeFirst = sampleIndex % 2 === 1;
      if (shouldRunNativeFirst) {
        nativeFindingDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, findingBenchmarkDirectory).durationMs,
        );
        stockFindingDurationsMs.push(
          runOxlint(stockConfigPath, process.env, findingBenchmarkDirectory).durationMs,
        );
      } else {
        stockFindingDurationsMs.push(
          runOxlint(stockConfigPath, process.env, findingBenchmarkDirectory).durationMs,
        );
        nativeFindingDurationsMs.push(
          runOxlint(nativeConfigPath, nativeEnvironment, findingBenchmarkDirectory).durationMs,
        );
      }
    }
    const stockFindingMedianMs = median(stockFindingDurationsMs);
    const nativeFindingMedianMs = median(nativeFindingDurationsMs);
    const findingSpeedupPercent =
      ((stockFindingMedianMs - nativeFindingMedianMs) / stockFindingMedianMs) * 100;
    process.stdout.write(
      `Finding benchmark p50: JavaScript ${stockFindingMedianMs.toFixed(1)} ms, native ${nativeFindingMedianMs.toFixed(1)} ms, ${findingSpeedupPercent.toFixed(1)}% faster.\n`,
    );
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
