import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromCore = createRequire(
  path.join(repositoryRoot, "packages", "core", "package.json"),
);
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

const oxlintMainPath = requireFromCore.resolve("oxlint");
const oxlintBinaryPath = path.join(
  path.resolve(path.dirname(oxlintMainPath), ".."),
  "bin",
  "oxlint",
);
const pluginPath = requireFromCore.resolve("oxlint-plugin-react-doctor");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-native-parity-"));
const fixtureDirectory = path.join(temporaryDirectory, "production-fixtures");
const fixturePath = path.join(fixtureDirectory, "app", "error.tsx");
const jsxFilenameMismatchFixturePath = path.join(fixtureDirectory, "app", "jsx-mismatch.js");
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
const r3fLightingFixturePath = path.join(fixtureDirectory, "app", "r3f-lighting.tsx");
const r3fMetalEnvironmentFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-metal-environment.tsx",
);
const r3fNoCompileFixturePath = path.join(fixtureDirectory, "app", "r3f-no-compile.tsx");
const r3fClockFixturePath = path.join(fixtureDirectory, "app", "r3f-clock.tsx");
const r3fCapDprFixturePath = path.join(fixtureDirectory, "app", "r3f-cap-dpr.tsx");
const r3fCloneInFrameFixturePath = path.join(fixtureDirectory, "app", "r3f-clone-in-frame.tsx");
const r3fDeepSelectorFixturePath = path.join(fixtureDirectory, "app", "r3f-deep-selector.tsx");
const r3fDisposeLoaderCacheFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-dispose-loader-cache.tsx",
);
const r3fDuplicatePrimitiveFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-duplicate-primitive.tsx",
);
const r3fPointerAllocationFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-pointer-allocation.tsx",
);
const r3fExtendNamespaceFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-extend-namespace.tsx",
);
const r3fFreshPortalFixturePath = path.join(fixtureDirectory, "app", "r3f-fresh-portal.tsx");
const r3fFreshSelectorFixturePath = path.join(fixtureDirectory, "app", "r3f-fresh-selector.tsx");
const r3fManagedRefAttachmentFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-managed-ref-attachment.tsx",
);
const r3fInlinePrimitiveFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-inline-primitive.tsx",
);
const r3fInlineResourceFixturePath = path.join(fixtureDirectory, "app", "r3f-inline-resource.tsx");
const r3fManualResizeFixturePath = path.join(fixtureDirectory, "app", "r3f-manual-resize.tsx");
const r3fMutateLoaderCacheFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-mutate-loader-cache.tsx",
);
const r3fMutateUniformSourceFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-mutate-uniform-source.tsx",
);
const r3fMutatingPointerEventDataFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-mutating-pointer-event-data.tsx",
);
const r3fNewInFrameFixturePath = path.join(fixtureDirectory, "app", "r3f-new-in-frame.tsx");
const r3fNullLoaderFixturePath = path.join(fixtureDirectory, "app", "r3f-null-loader.tsx");
const r3fObjectPointerCaptureFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-object-pointer-capture.tsx",
);
const r3fRecursiveRafFixturePath = path.join(fixtureDirectory, "app", "r3f-recursive-raf.tsx");
const r3fShaderConfigurationFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-shader-configuration.tsx",
);
const r3fStatePointerMoveFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-state-pointer-move.tsx",
);
const r3fStateInFrameFixturePath = path.join(fixtureDirectory, "app", "r3f-state-in-frame.tsx");
const r3fSyncReadbackFixturePath = path.join(fixtureDirectory, "app", "r3f-sync-readback.tsx");
const r3fUnstableArgsFixturePath = path.join(fixtureDirectory, "app", "r3f-unstable-args.tsx");
const r3fGpuInstancedAnimationFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-gpu-instanced-animation.tsx",
);
const r3fGpuPositionAnimationFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-gpu-position-animation.tsx",
);
const r3fInstancedMeshFixturePath = path.join(fixtureDirectory, "app", "r3f-instanced-mesh.tsx");
const r3fPreferUseLoaderFixturePath = path.join(fixtureDirectory, "app", "r3f-use-loader.tsx");
const r3fDataTextureUpdateFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-data-texture-update.tsx",
);
const r3fDynamicBufferUsageFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-dynamic-buffer-usage.tsx",
);
const r3fOwnedTextureCleanupFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-owned-texture-cleanup.tsx",
);
const r3fPositionBufferUpdateFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-position-buffer-update.tsx",
);
const r3fProjectionMatrixUpdateFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-projection-matrix-update.tsx",
);
const r3fRenderTargetResetFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-render-target-reset.tsx",
);
const r3fRenderWithPositivePriorityFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-render-with-positive-priority.tsx",
);
const r3fRenderWithPositivePriorityWorkingFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-render-with-positive-priority-working.tsx",
);
const r3fRenderWithPositivePriorityNamespaceFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-render-with-positive-priority-namespace.tsx",
);
const r3fRenderWithPositivePriorityTemplateFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-render-with-positive-priority-template.tsx",
);
const r3fValidTextureColorSpaceFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-valid-texture-color-space.tsx",
);
const r3fWebgpuNoGlStateFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-webgpu-no-gl-state.tsx",
);
const r3fWebgpuNoHighPrecisionInstancingFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-webgpu-no-high-precision-instancing.tsx",
);
const r3fRootUnmountFixturePath = path.join(fixtureDirectory, "app", "r3f-root-unmount.tsx");
const r3fAnimationMixerFixturePath = path.join(fixtureDirectory, "app", "r3f-animation-mixer.tsx");
const r3fFrameDeltaFixturePath = path.join(fixtureDirectory, "app", "r3f-frame-delta.tsx");
const r3fGlobalEffectCleanupFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-global-effect-cleanup.tsx",
);
const r3fInstancedBufferUpdateFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-instanced-buffer-update.tsx",
);
const r3fLitMaterialNormalsFixturePath = path.join(
  fixtureDirectory,
  "app",
  "r3f-lit-material-normals.tsx",
);
const r3fRequireUvFixturePath = path.join(fixtureDirectory, "app", "r3f-require-uv.tsx");
const r3fShadowsFixturePath = path.join(fixtureDirectory, "app", "r3f-shadows.tsx");
const r3fTextureRepeatFixturePath = path.join(fixtureDirectory, "app", "r3f-texture-repeat.tsx");
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
const frameworkClientEntryFixturePath = path.join(
  frameworkRouterFixtureDirectory,
  "app",
  "entry.client.tsx",
);
const frameworkServerEntryFixturePath = path.join(
  frameworkRouterFixtureDirectory,
  "app",
  "entry.server.tsx",
);
const stockConfigPath = path.join(temporaryDirectory, "stock.json");
const nativeConfigPath = path.join(temporaryDirectory, "native.json");
const configuredStockConfigPath = path.join(temporaryDirectory, "configured-stock.json");
const configuredNativeConfigPath = path.join(temporaryDirectory, "configured-native.json");
const jsxFilenameAsNeededFixturePath = path.join(temporaryDirectory, "as-needed.jsx");
const jsxFilenameIgnoredFixturePath = path.join(temporaryDirectory, "ignored.jsx");
const jsxFilenameAsNeededStockConfigPath = path.join(
  temporaryDirectory,
  "jsx-filename-as-needed-stock.json",
);
const jsxFilenameAsNeededNativeConfigPath = path.join(
  temporaryDirectory,
  "jsx-filename-as-needed-native.json",
);
const jsxFilenameIgnoredStockConfigPath = path.join(
  temporaryDirectory,
  "jsx-filename-ignored-stock.json",
);
const jsxFilenameIgnoredNativeConfigPath = path.join(
  temporaryDirectory,
  "jsx-filename-ignored-native.json",
);
const routerStockConfigPath = path.join(temporaryDirectory, "router-stock.json");
const routerNativeConfigPath = path.join(temporaryDirectory, "router-native.json");
const frameworkServerEntryStockConfigPath = path.join(
  temporaryDirectory,
  "framework-server-entry-stock.json",
);
const frameworkServerEntryNativeConfigPath = path.join(
  temporaryDirectory,
  "framework-server-entry-native.json",
);
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
  "no-eval": 1,
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
  "iframe-has-title": 2,
  "iframe-missing-sandbox": 12,
  "img-redundant-alt": 4,
  "interactive-supports-focus": 3,
  "label-has-associated-control": 4,
  "mouse-events-have-key-events": 1,
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
  "rendering-script-defer-async": 5,
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
  "query-no-void-query-fn": 1,
  "react-router-no-router-in-render": 2,
  "nextjs-async-client-component": 3,
  "no-string-false-on-boolean-attribute": 3,
  "nextjs-no-a-element": 6,
  "jsx-no-script-url": 2,
  "jsx-boolean-value": 2,
  "jsx-curly-brace-presence": 18,
  "jsx-handler-names": 1,
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
  "jsx-filename-extension": 1,
  "no-unsafe": 1,
  "r3f-cap-device-pixel-ratio": 6,
  "r3f-no-allocation-in-pointer-move": 3,
  "r3f-no-advancing-clock-in-use-frame": 2,
  "r3f-no-async-use-frame": 2,
  "r3f-no-clone-in-use-frame": 4,
  "r3f-no-compile-in-use-frame": 2,
  "r3f-no-deep-use-three-selector": 3,
  "r3f-no-dispose-loader-cache": 8,
  "r3f-no-duplicate-primitive-object": 5,
  "r3f-no-extend-in-render": 0,
  "r3f-no-extend-three-namespace": 4,
  "r3f-no-fresh-portal-container": 1,
  "r3f-no-fresh-use-three-selector": 1,
  "r3f-no-imperative-attach-of-managed-ref": 1,
  "r3f-no-inline-primitive-object": 1,
  "r3f-no-inline-resource-prop": 1,
  "r3f-no-manual-canvas-resize": 1,
  "r3f-no-mutate-loader-cache": 4,
  "r3f-no-mutate-uniform-prop-source-in-use-frame": 3,
  "r3f-no-mutating-pointer-event-data": 6,
  "r3f-no-new-in-use-frame": 4,
  "r3f-no-null-loader-input": 11,
  "r3f-no-object-pointer-capture": 6,
  "r3f-no-recursive-raf-with-use-frame": 6,
  "r3f-no-shader-configuration-mutation-in-use-frame": 4,
  "r3f-no-state-in-pointer-move": 7,
  "r3f-no-state-in-use-frame": 5,
  "r3f-no-sync-readback-in-use-frame": 8,
  "r3f-no-unstable-args": 6,
  "r3f-prefer-gpu-instanced-animation": 3,
  "r3f-prefer-gpu-position-animation": 6,
  "r3f-prefer-instanced-mesh": 2,
  "r3f-prefer-use-loader": 3,
  "r3f-require-animation-mixer-update": 2,
  "r3f-require-data-texture-update": 2,
  "r3f-require-dynamic-buffer-usage": 1,
  "r3f-require-frame-delta": 13,
  "r3f-require-global-effect-cleanup": 6,
  "r3f-require-instanced-buffer-update": 4,
  "r3f-require-lit-material-normals": 2,
  "r3f-require-owned-texture-cleanup": 1,
  "r3f-require-position-buffer-update": 7,
  "r3f-require-projection-matrix-update": 1,
  "r3f-require-render-target-reset": 2,
  "r3f-require-render-with-positive-priority": 11,
  "r3f-require-root-unmount": 8,
  "r3f-require-uv-for-texture-map": 4,
  "react-router-csp-nonce-consistency": 1,
  "react-router-descendant-routes-require-splat": 1,
  "react-router-guard-aborted-handle-error": 0,
  "react-router-internal-route-anchor": 1,
  "react-router-loader-fetch-forwards-signal": 0,
  "react-router-loader-parallel-fetch": 0,
  "react-router-nested-route-requires-outlet": 0,
  "react-router-no-client-module-in-server-render": 0,
  "react-router-no-invalid-lazy-route-properties": 0,
  "react-router-no-loader-request-body": 0,
  "react-router-no-redirect-in-try-catch": 0,
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
  "hook-use-state": 28,
  "rendering-svg-precision": 1,
  "no-document-start-view-transition": 1,
  "no-permanent-will-change": 2,
  "no-global-css-variable-animation": 1,
  "ink-no-raw-text": 9,
  "remotion-no-css-animation": 3,
  "remotion-no-css-transition": 4,
  "no-conflicting-spring-options": 2,
  "motion-keyframe-times-mismatch": 2,
  "three-no-shadows-on-unsupported-light": 1,
  "three-no-async-animation-loop": 2,
  "three-cap-device-pixel-ratio": 1,
  "three-prefer-set-animation-loop": 5,
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
  "three-require-lighting-for-pbr": 1,
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
  "react-compiler-no-manual-memoization": 10,
  "no-giant-component": 1,
  "no-nested-component-definition": 1,
  "no-high-complexity-react-function": 1,
  "remotion-no-next-image": 1,
  "remotion-no-native-media-elements": 4,
  "remotion-stable-delay-render-handle": 1,
  "remotion-deterministic-randomness": 2,
  "remotion-no-css-url-assets": 1,
  "no-react19-deprecated-apis": 1,
  "no-react-dom-deprecated-apis": 7,
  "no-legacy-class-lifecycles": 2,
  "no-legacy-context-api": 7,
  "no-long-transition-duration": 2,
  "no-low-contrast-inline-style": 1,
  "no-manufactured-contrast-copy": 1,
  "no-repeating-gradient-decoration": 1,
  "no-decorative-blur-orb": 1,
  "no-repeated-emoji-tiles": 1,
  "no-repeated-kicker-labels": 1,
  "no-repeated-glass-surfaces": 1,
  "no-pill-navigation-count": 1,
  "no-excessive-pill-treatment": 1,
  "no-empty-card-shell": 1,
  "no-dynamic-tailwind-class-fragment": 1,
  "no-ease-in-motion": 1,
  "no-clipped-overlay": 1,
  "no-fixed-inside-transformed-ancestor": 1,
  "no-wide-letter-spacing": 1,
  "no-hairline-border-wide-shadow": 1,
  "no-pure-black-shadow": 1,
  "no-z-index-9999": 1,
  "no-emoji-heading-decoration": 1,
  "no-auto-scrolling-content": 1,
  "no-dark-mode-glow": 1,
  "no-decorative-grid-background": 1,
  "no-decorative-pulse": 1,
  "no-decorative-radial-spotlight": 1,
  "no-default-props": 1,
  "no-deprecated-keyboard-event-keycode-which": 1,
  "no-excessive-card-surfaces": 1,
  "no-nested-card-surface": 1,
  "no-icon-tile-heading-stack": 1,
  "no-uniform-feature-card-grid": 1,
  "no-svg-currentcolor-with-fill-class": 1,
  "no-outline-none": 1,
  "require-scale-reveal-transform-origin": 1,
  "no-generic-purple-blue-icon-gradient": 1,
  "no-pointer-disabled-enabled-control": 1,
  "no-inert-pointer-affordance": 1,
  "no-generic-marketing-copy": 1,
  "no-gradient-text": 1,
  "no-gray-on-colored-background": 1,
  "no-hero-eyebrow-chip": 1,
  "no-cramped-container-padding": 1,
  "no-inline-exhaustive-style": 3,
  "no-focus-in-animation-completion-handler": 1,
  "no-hover-only-reveal": 1,
  "no-image-hover-transform": 1,
  "no-indeterminate-attribute": 4,
  "no-impure-call-at-module-scope": 7,
  "no-impure-state-updater": 1,
  "no-inline-hoc-on-component": 1,
  "no-inline-prop-on-memo-component": 1,
  "no-invisible-focus-control": 1,
  "no-json-parse-stringify-clone": 1,
  "no-jsx-element-type": 1,
  "no-large-animated-blur": 1,
  "no-layout-property-animation": 1,
  "no-layout-shifting-interaction-state": 1,
  "no-many-boolean-props": 1,
  "no-match-media-in-state-initializer": 1,
  "no-mirror-prop-effect": 1,
  "no-monotonous-page-spacing": 1,
  "no-multiple-unlabeled-navigation-landmarks": 2,
  "no-mutable-in-deps": 1,
  "no-mutating-array-method-on-prop-or-hook-result": 1,
  "no-mutating-reducer-state": 1,
  "no-non-literal-selector-query-without-try-catch": 1,
  "no-nullish-coalescing-arithmetic-precedence": 1,
  "no-numbered-section-markers": 1,
  "no-object-or-array-coerced-to-string-in-template-literal": 1,
  "no-passive-request-owner-ref": 1,
  "no-path-prefix-containment": 1,
  "no-placeholder-only-field": 1,
  "no-polymorphic-children": 1,
  "no-predicate-function-reference-in-boolean-position": 1,
  "no-prevent-default": 1,
  "no-random-key": 1,
  "no-ref-callback-cleanup-before-react-19": 1,
  "no-uncontrolled-input": 2,
  "no-undeferred-third-party": 3,
  "no-undersized-icon-button": 0,
  "no-ungated-tailwind-animation": 2,
  "no-unthrottled-scroll-mutation": 0,
  "preact-prefer-oninput": 1,
  "waapi-animation-in-render": 0,
  "zod-v4-no-deprecated-error-apis": 0,
  "zod-v4-no-deprecated-error-customization": 0,
  "zod-v4-no-deprecated-schema-apis": 0,
  "zod-v4-prefer-top-level-string-formats": 0,
  "rn-no-non-native-navigator": 1,
  "server-cache-with-object-literal": 1,
  "nextjs-no-client-fetch-for-server-data": 1,
  "r3f-no-ignored-linewidth": 1,
  "r3f-no-shadows-on-unsupported-light": 1,
  "r3f-no-ignored-basic-material-properties": 1,
  "r3f-valid-material-opacity": 1,
  "r3f-valid-pbr-material-properties": 1,
  "r3f-valid-physical-material-properties": 1,
  "r3f-require-transparent-for-opacity": 1,
  "r3f-require-lighting-for-pbr": 2,
  "r3f-require-environment-for-metal": 1,
  "r3f-require-shadows-enabled": 1,
  "r3f-texture-repeat-requires-wrapping": 1,
  "r3f-valid-buffer-attribute-item-size": 1,
  "r3f-valid-buffer-attribute-array-length": 1,
  "r3f-valid-shadow-map-size": 1,
  "r3f-valid-raycaster-range": 1,
  "r3f-valid-fog-parameters": 1,
  "r3f-valid-spot-light-properties": 1,
  "r3f-valid-perspective-camera": 1,
  "r3f-valid-orthographic-camera": 1,
  "r3f-valid-texture-color-space": 3,
  "r3f-no-use-frame-dependency-array": 1,
  "r3f-no-normalized-float-buffer-attribute": 1,
  "r3f-webgpu-canvas-prop-compatibility": 1,
  "r3f-webgpu-no-gl-state": 10,
  "r3f-webgpu-no-high-precision-instancing": 1,
  "r3f-limit-shadowed-point-lights": 1,
  "rn-bottom-sheet-use-integrated-scrollable": 1,
  "no-focusable-content-in-aria-hidden": 1,
  "alt-text": 7,
  "anchor-is-valid": 2,
  "anchor-target-exists": 1,
  "aria-proptypes": 1,
  "async-await-in-loop": 3,
  "async-defer-await": 1,
  "async-parallel": 2,
  "autocomplete-valid": 1,
  "button-has-type": 5,
  "checked-requires-onchange-or-readonly": 6,
  "class-component-missing-component-will-unmount-teardown": 3,
  "click-events-have-key-events": 3,
  "control-has-associated-label": 53,
  "display-name": 10,
  "forbid-component-props": 0,
  "forbid-dom-props": 0,
  "forbid-elements": 0,
  "form-control-requires-name": 0,
  "hook-import-rename-loses-use-prefix": 1,
  "html-no-invalid-paragraph-child": 1,
  "html-no-invalid-table-nesting": 1,
  "auth-token-in-web-storage": 1,
  "client-localstorage-no-version": 1,
  "data-table-requires-accessible-name": 3,
  "expo-no-non-inlined-env": 0,
  "html-no-nested-interactive": 0,
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
  "jsx-a11y": {
    attributes: { href: ["href", "to"] },
    components: { ConfiguredControl: "button", NavigationLink: "a" },
  },
  "react-doctor": {
    ...REACT_DOCTOR_SETTINGS["react-doctor"],
    displayName: {
      additionalHoCs: ["withRedux"],
      checkContextObjects: true,
      reactVersion: "18.0-beta",
    },
    forbidComponentProps: {
      forbid: [
        "className",
        { propNamePattern: "data-*", allowedForPatterns: ["Allowed*"] },
        {
          propName: "style",
          disallowedForPatterns: ["Library.*"],
          message: "Use the panel variant.",
        },
      ],
    },
    forbidDomProps: {
      forbid: [
        "id",
        {
          propName: "data-state",
          disallowedFor: ["span"],
          disallowedValues: ["blocked"],
        },
        {
          propName: "className",
          disallowedFor: ["section"],
          message: "Use the section variant.",
        },
      ],
    },
    forbidElements: {
      forbid: [
        "button",
        { element: "ConfiguredModal", message: "Use the approved modal." },
        "Library.Panel",
      ],
    },
    capabilities: ["react", "tailwind"],
    headingHasContent: { components: ["Title"] },
    jsxBooleanValue: { mode: "always", never: ["compact"] },
    jsxCurlyBracePresence: {
      props: "always",
      children: "always",
      propElementValues: "always",
    },
    jsxHandlerNames: {
      checkInlineFunction: true,
      checkLocalVariables: true,
      eventHandlerPrefix: "handle|on",
      eventHandlerPropPrefix: "when|on",
      ignoreComponentNames: ["Ignored*"],
    },
    noStringRefs: { noTemplateLiterals: true },
    stateInConstructor: { mode: "never" },
    ariaRole: { allowedInvalidRoles: ["datepicker"], ignoreNonDOM: false },
    altText: { elements: ["img"], img: ["ConfiguredImage"] },
    imgRedundantAlt: { components: ["ConfiguredImage"], words: ["portrait"] },
    interactiveSupportsFocus: { tabbable: ["slider"] },
    labelHasAssociatedControl: {
      labelComponents: ["ConfiguredLabel"],
      labelAttributes: ["label"],
      controlComponents: ["ConfiguredInput"],
      assert: "both",
      depth: 3,
    },
    mouseEventsHaveKeyEvents: {
      hoverInHandlers: ["onPointerEnter"],
      hoverOutHandlers: ["onPointerLeave"],
    },
    autocompleteValid: { inputComponents: ["ConfiguredInput"] },
    buttonHasType: { reset: false },
    checkedRequiresOnchangeOrReadonly: {
      ignoreExclusiveCheckedAttribute: true,
      ignoreMissingProperties: true,
    },
    anchorIsValid: { specialLink: ["to"] },
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
import React, { Activity as ReactActivity, Children, createContext as makeContext, useEffect, useEffectEvent as useReactEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState, Component, forwardRef as wrapRef, ViewTransition, memo, startTransition as beginRouteTransition, type FunctionComponent as LegacyContextFunctionComponent } from "react";
import ReactDOM, { hydrate as legacyHydrate } from "react-dom";
import { act as legacyAct, Simulate as LegacySimulate } from "react-dom/test-utils";
import type { useMemo as PreactTypeOnlyHook } from "react";
import { createContext as makeTrackedContext } from "react-tracked";
import { create as createZustandStore } from "zustand";
import { useQuery, useQuery as useItemsQuery } from "@tanstack/react-query";
import * as TanstackQuery from "@tanstack/react-query";
import { mergeProps as mergeNativeButtonProps, useFocus as useNativeButtonFocus, useHover as useNativeButtonHover, usePress as useNativeButtonPress } from "react-aria";
import { BrowserRouter as OuterRouter, MemoryRouter as InnerRouter, RouterProvider as RouteProvider, ServerRouter as ServerRouteRouter, createBrowserRouter as makeBrowserRouter, createCookieSessionStorage as makeCookieSessionStorage, createHashRouter as makeHashRouter, redirect as routeRedirect, unstable_useBlocker as useRouteBlocker, useLoaderData as useRouteLoaderData, useMatches as useRouteMatches, useRoutes as useNestedRoutes, useSearchParams as useRouteSearchParams } from "react-router";
import { Link as DomLink, useNavigate as useRouteNavigate } from "react-router-dom";
import { renderToPipeableStream as renderRouteStream } from "react-dom/server";
import { runOnJS as callOnJavaScript, useWorkletCallback as makeLegacyWorklet, withSpring as makeSpring } from "react-native-reanimated";
import * as ReanimatedRuntime from "react-native-reanimated";
import { useFrame as useRenderFrame } from "@react-three/fiber";
import { Canvas as WebgpuCanvas } from "@react-three/fiber/webgpu";
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
import { createStackNavigator } from "@react-navigation/stack";
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
const LegacyReactAlias = React;
const createLegacyButton = (LegacyReactAlias as typeof LegacyReactAlias).createFactory("button");
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
const runDynamicEvaluation = (userInput) => globalThis.eval(userInput);
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
const ignoredR3fLineWidth = <lineBasicMaterial linewidth={4} />;
const unsupportedR3fShadowLight = <ambientLight castShadow />;
const ignoredR3fBasicMaterialProperty = <meshBasicMaterial roughness={0.4} />;
const invalidR3fMaterialOpacity = <meshStandardMaterial opacity={1.2} />;
const invalidR3fPbrMaterialFactor = <meshStandardMaterial roughness={1.2} />;
const invalidR3fPhysicalMaterialProperty = <meshPhysicalMaterial clearcoat={2} />;
const ignoredR3fOpacity = <meshBasicMaterial opacity={0.5} />;
const invalidR3fBufferAttributeItemSize = <bufferAttribute args={[data, 0]} />;
const invalidR3fBufferAttributeArrayLength = <bufferAttribute args={[new Float32Array(8), 3]} />;
const invalidR3fShadowMapSize = <directionalLight castShadow shadow-mapSize={[1000, 1024]} />;
const invalidR3fRaycasterRange = <raycaster near={-1} />;
const invalidR3fFogParameters = <fog args={["white", 10, 5]} />;
const invalidR3fSpotLightAngle = <spotLight angle={2} />;
const invalidR3fPerspectiveCamera = <perspectiveCamera aspect={0} />;
const invalidR3fOrthographicCamera = <orthographicCamera left={2} right={2} />;
useRenderFrame(() => update(), []);
const invalidR3fNormalizedFloatAttribute = <float32BufferAttribute args={[data, 3, true]} />;
const invalidR3fWebgpuCanvas = <WebgpuCanvas gl={{ antialias: true }} />;
const invalidR3fShadowedPointLights = () => <group><pointLight castShadow /><pointLight castShadow /><pointLight castShadow /></group>;
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
const EmptyQueryFunctionFixture = () => useQuery({ queryKey: ["empty"], queryFn: () => {} });
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
const mismatchedBottomSheetScrollable = <GorhomBottomSheet.BottomSheet><FlatList /></GorhomBottomSheet.BottomSheet>;
const hiddenFocusableControl = <div aria-hidden><button type="button">Save</button></div>;
const missingImageAlternative = <img src="/missing-alt.png" />;
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
const configuredInvalidAutocomplete = <ConfiguredInput autoComplete="unknown-configured-token" />;
const configuredInvalidResetButton = <button type="reset">Reset</button>;
const missingNativeButtonType = <form><button>Save</button></form>;
const NativeAriaPressButton = (properties) => { const { pressProps } = useNativeButtonPress(properties); return <form><button {...pressProps}>Press</button></form>; };
function useNativeButtonBag() { const { focusProps } = useNativeButtonFocus({}); const { hoverProps } = useNativeButtonHover({}); return { triggerProps: mergeNativeButtonProps(focusProps, hoverProps) }; }
const NativeMergedAriaButton = () => { const { triggerProps } = useNativeButtonBag(); return <form><button {...triggerProps}>Merge</button></form>; };
const ComputedTypeForwardButton = (properties) => <button type={properties["type"]}>Forward</button>;
const ComputedDestructuredTypeButton = ({ ["type"]: kind }) => <button type={kind}>Forward</button>;
const computedSpreadButton = <form><button {...{ ["onClick"]: () => {} }}>Save</button></form>;
const missingCheckedHandler = <input type="checkbox" checked />;
const exclusiveCheckedDefaults = <input checked defaultChecked readOnly />;
const missingCreateElementCheckedHandler = React.createElement("input", { checked: true });
const ForwardedCheckedInput = ({ checked, defaultChecked }) => <input checked={checked} defaultChecked={defaultChecked} readOnly />;
const spreadCheckedInput = <input checked {...inputProperties} />;
const disabledCheckedInput = <input checked disabled />;
const configuredIgnoredCheckedInput = <input checked defaultChecked />;
/* oxlint-disable react-doctor/prefer-function-component, react-doctor/no-set-state */
class MissingClassListenerCleanup extends React.Component {
  componentDidMount() { window.addEventListener("resize", this.handleResize); }
  render() { return null; }
}
class MissingClassIntervalCleanup extends React.Component {
  componentDidMount() { this.interval = setInterval(this.tick, 1000); }
  render() { return null; }
}
class MissingClassTimeoutCleanup extends React.Component {
  componentDidMount() { this.timeout = setTimeout(() => this.setState({ ready: true }), 1000); }
  render() { return null; }
}
class CleanClassListenerCleanup extends React.Component {
  componentDidMount() { window.addEventListener("resize", this.handleResize); }
  componentWillUnmount() { window.removeEventListener("resize", this.handleResize); }
  render() { return null; }
}
/* oxlint-enable react-doctor/prefer-function-component, react-doctor/no-set-state */
/* oxlint-disable react-doctor/no-static-element-interactions */
const clickableWithoutKeyboardHandler = <div onClick={openDetails}>Details</div>;
const capturedClickWithoutKeyboardHandler = <section onClickCapture={openDetails}>Details</section>;
const spreadClickWithoutKeyboardHandler = <main {...{ onClick: openDetails }}>Details</main>;
const clickableWithKeyboardHandler = <div onClick={openDetails} onKeyDown={openDetails}>Details</div>;
/* oxlint-enable react-doctor/no-static-element-interactions */
/* oxlint-disable react-doctor/button-has-type, react-doctor/no-static-element-interactions */
const unlabeledButtonControl = <button />;
const unlabeledCheckboxControl = <input type="checkbox" />;
const unlabeledRoleControl = <div role="button" />;
const labeledButtonControl = <button type="button">Save</button>;
const bigintOnlyButtonControl = <button type="button">{1n}</button>;
const regexpOnlyButtonControl = <button type="button">{/save/}</button>;
const computedHiddenStyleButtonControl = <button type="button" style={{ ["display"]: "none" }} />;
const coalescedTitleButtonControl = <button type="button" title={undefined ?? "Save"} />;
const undefinedWrapperLabelControl = <Field label={undefined}><input /></Field>;
const numericControlLabel = <label htmlFor={1e21}>Amount</label>;
const numericControl = <input id="1e+21" />;
/* oxlint-enable react-doctor/button-has-type, react-doctor/no-static-element-interactions */
/* oxlint-disable react-doctor/prefer-es6-class, react-doctor/prefer-function-component, react-doctor/react-compiler-no-manual-memoization */
module.exports = memo(function () { return <div />; });
module.exports = memo(forwardRef((props, ref) => <div ref={ref} {...props} />));
export const displayNameFactory = (order) => { return (props) => <Title order={order} {...props} />; };
const legacyDisplayNameComponent = createReactClass({ render() { return <div />; } });
const anonymousDisplayNameClass = class extends React.Component { render() { return <div />; } };
/* oxlint-enable react-doctor/prefer-es6-class, react-doctor/prefer-function-component, react-doctor/react-compiler-no-manual-memoization */
const downloadAnchor = <a href="/report" download>Report</a>;
const protocolRelativeAnchor = <a href="//cdn.example.com/file">File</a>;
const scriptUrlAnchor = <a href="javascript:void(0)">Open</a>;
const obfuscatedScriptUrlAnchor = <a href=" \tJ\na\rv\ta\ns\tc\rr\ni\tp\tt:alert(1)">Open</a>;
const safeJavascriptArticle = <a href="https://example.com/JavaScript:Guide">Read</a>;
const missingFragmentAnchor = <a href="#missing-native-target">Missing</a>;
const existingFragmentAnchor = <><a href="#existing-native-target">Existing</a><section id="existing-native-target" /></>;
const invalidAriaPropType = <div aria-hidden="yes" />;
async function loadNativeAwaitLoop(items) { for (const item of items) { await loadNativeItem(item); } }
async function loadNativeDeferredAwait(shouldSkip) { const rows = await loadNativeRows(); if (shouldSkip) return []; return rows; }
async function loadNativeParallel() { const user = await loadNativeUser(); const orders = await loadNativeOrders(); const invoices = await loadNativeInvoices(); return { user, orders, invoices }; }
const invalidNativeAutocomplete = <input autoComplete="unknown-native-token" />;
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
const redundantImageAlt = <img src="/cat.png" alt="Image of a cat" />;
const redundantExpressionImageAlt = <img src="/cat.png" alt={"Photo of a cat"} />;
const redundantTemplateImageAlt = <img src="/cat.png" alt={\`Picture of \${subject}\`} />;
const NativeImageTag = "img" as const;
const redundantAliasedImageAlt = <NativeImageTag src="/cat.png" alt="Photo of a cat" />;
const joinedImageAlt = <img src="/cat.png" alt="image-left-top" />;
const unfocusableTabbableRole = <div role="button" aria-label="Open" onKeyDown={handle} />;
const unfocusableFocusableRole = <div role="slider" aria-label="Volume" onKeyDown={handle} />;
const conditionalUnfocusableRole = <div role={condition ? "button" : "link"} aria-label="Open" onKeyDown={handle} />;
const focusedInteractiveRole = <div role="button" aria-label="Open" onKeyDown={handle} tabIndex={0} />;
const compositeRoleContainer = <div role="toolbar" aria-label="Tools" onKeyDown={handle} />;
const identifiedCompositeRoleItem = <div role="option" id="selected-option" aria-label="Selected" onMouseEnter={handle} />;
const spreadFocusedInteractiveRole = <div role="button" aria-label="Open" onKeyDown={handle} {...focusProperties} />;
const editableInteractiveRole = <div role="textbox" aria-label="Editor" contentEditable onKeyDown={handle} />;
const unidentifiedEmptyLabel = <label />;
const unassociatedTextLabel = <label>Name</label>;
const unassociatedExpressionLabel = <label>{fieldLabel}</label>;
const emptyAssociationLabel = <label htmlFor="">Name</label>;
const nestedAssociationLabel = <label>Name<input /></label>;
const renderingChildrenLabel = <label>Name {children}</label>;
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
const InvalidParagraphChild = () => <p><div>Block content</div></p>;
const InvalidTableNesting = () => <table><td>Cell</td></table>;
localStorage.setItem("authToken", token);
localStorage.setItem("preferences", JSON.stringify(preferences));
const DataTableWithoutName = () => <table><tr><th>Name</th></tr></table>;
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
const renderBlockingScript = <script src="/app.js" />;
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
  static childContextTypes = { theme: () => null };
  static contextTypes = { locale: () => null };
  getChildContext() { return { theme: "dark" }; }
  render() { return <div />; }
}
const LegacyContextFunction = () => <div />;
LegacyContextFunction.contextTypes = { theme: () => null };
const LegacyContextAlias = LegacyContextFunction;
LegacyContextAlias.childContextTypes = { theme: () => null };
const TypedLegacyContextFunction: LegacyContextFunctionComponent & { contextTypes?: object } = () => null;
TypedLegacyContextFunction.contextTypes = { theme: () => null };
type LegacyContextComponentType = (LegacyContextFunctionComponent) & { childContextTypes?: object };
const OpaqueLegacyContextFunction: LegacyContextComponentType = loadLegacyContextComponent();
OpaqueLegacyContextFunction.childContextTypes = { theme: () => null };
type MaybeLegacyContextComponent = React.FC | (() => string);
const MaybeLegacyContextFunction: MaybeLegacyContextComponent & { contextTypes?: object } = () => "plain";
MaybeLegacyContextFunction.contextTypes = { theme: () => null };
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
const longOpacityTransition = <div style={{ transition: "opacity 2s ease" }} />;
const longMotionTransition = <motion.div animate={{ opacity: 1 }} transition={{ duration: 1.5 }} />;
const lowContrastInlineStyle = <span style={{ color: "#9ca3af", backgroundColor: "#ffffff", fontSize: 16 }}>Balance</span>;
const manufacturedContrastCopy = <main><p>Not just another report. It is a plan.</p><p>No busywork. Just useful diagnostics.</p><p>Review the important changes. No manual sorting.</p></main>;
const repeatingGradientDecoration = <div style={{ backgroundImage: "repeating-linear-gradient(45deg, #fff 0 4px, #eee 4px 8px)" }} />;
const decorativeBlurOrb = <div className="pointer-events-none absolute size-96 rounded-full bg-purple-500 blur-3xl" />;
const repeatedEmojiTiles = <main><span className="size-12 rounded-xl bg-blue-100">🚀</span><span className="size-12 rounded-xl bg-green-100">🔒</span><span className="size-12 rounded-xl bg-amber-100">⚡</span></main>;
const repeatedKickerLabels = <main><section><p className="uppercase tracking-widest">Approach</p><h2>How it works</h2></section><section><p className="uppercase tracking-widest">Benefits</p><h2>Why it helps</h2></section><section><p className="uppercase tracking-widest">Results</p><h2>What changed</h2></section></main>;
const repeatedGlassSurfaces = <main><section className="rounded-xl border bg-white/10 backdrop-blur-xl">A</section><section className="rounded-xl border bg-white/10 backdrop-blur-xl">B</section><section className="rounded-xl border bg-white/10 backdrop-blur-xl">C</section></main>;
const pillNavigationCount = <nav><span className="rounded-full bg-gray-200 px-2">12</span></nav>;
const excessivePillTreatment = <main><span className="rounded-full border px-3">Fast</span><span className="rounded-full bg-blue-100 px-3">Secure</span><span className="rounded-full border px-4">Start</span><span className="rounded-full bg-gray-200 px-4">Docs</span><span className="rounded-full border px-3">New</span></main>;
const emptyCardShell = <section className="rounded-xl border p-6" />;
const dynamicTailwindClassFragment = <div className={\`bg-\${themeColor}-500\`} />;
const easeInMotion = <div style={{ transition: "opacity 200ms ease-in" }} />;
const clippedOverlay = <div className="overflow-hidden"><div role="menu" className="absolute top-full">Menu</div></div>;
const fixedInsideTransformedAncestor = <div className="translate-x-0"><div className="fixed inset-0" /></div>;
const wideLetterSpacing = <p style={{ letterSpacing: 2 }}>Body copy</p>;
const hairlineBorderWideShadow = <div className="border shadow-2xl" />;
const pureBlackShadow = <div className="shadow-xl shadow-black" />;
const absurdZIndex = <div style={{ zIndex: 9999 }} />;
const emojiHeadingDecoration = <h1>🚀 Ship faster</h1>;
const autoScrollingContent = <motion.div animate={{ x: ["0%", "-50%"] }} transition={{ repeat: Infinity }}>Acme Globex</motion.div>;
const darkModeGlow = <div style={{ backgroundColor: "#111", boxShadow: "0 0 60px rgba(139, 92, 246, 0.8)" }} />;
const decorativeGridBackground = <section style={{ backgroundImage: "linear-gradient(to right, #aaa 1px, transparent 1px), linear-gradient(to bottom, #aaa 1px, transparent 1px)", backgroundSize: "24px 24px" }} />;
const decorativePulse = <span className="animate-pulse">New feature</span>;
const decorativeRadialSpotlight = <div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 25%), transparent 70%)" }} />;
const DefaultPropsLink = (props) => <a {...props} />;
DefaultPropsLink.defaultProps = { size: "regular" };
const keyboardRow = <div onKeyDown={(event) => { if (event.keyCode === 75) focusSearch(); }} />;
const excessiveCardPage = <main><section className="rounded-xl border p-6">One</section><section className="rounded-xl border p-6">Two</section><section className="rounded-xl border p-6">Three</section><section className="rounded-xl border p-6">Four</section><section className="rounded-xl border p-6">Five</section><section className="rounded-xl border p-6">Six</section></main>;
const nestedCardSurface = <div className="rounded-xl border p-6"><section className="rounded-lg border bg-white p-4">Inner</section></div>;
const iconTileHeadingStack = <article className="rounded-xl border bg-white p-6"><div className="size-12 rounded-lg bg-blue-100"><SparklesIcon /></div><h3>Automations</h3></article>;
const uniformFeatureCardGrid = <section className="grid grid-cols-3"><article className="rounded-xl border p-6"><h3>Fast</h3><p>Finish sooner.</p></article><article className="rounded-xl border p-6"><h3>Safe</h3><p>Protect changes.</p></article><article className="rounded-xl border p-6"><h3>Simple</h3><p>Stay focused.</p></article></section>;
const currentColorConflict = <svg fill="currentColor" className="fill-zinc-400" />;
const missingFocusIndicator = <button style={{ outline: "none" }}>Save</button>;
const unanchoredScaleReveal = <motion.div role="menu" initial={{ scale: 0.96 }} />;
const genericGradientIcon = <div className="size-8 rounded-lg bg-linear-to-r from-purple-500 to-blue-500 flex" />;
const pointerDisabledControl = <button className="pointer-events-none">Save</button>;
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
const MismatchedMotionKeyframesFixture = () => <><MotionRuntime.motion.div animate={{ opacity: [0, 1, 0] }} transition={{ times: [0, 1] }} /><MotionRuntime.motion.div animate={{ x: [0, 20], transition: { times: [0, 0.5, 1] } }} /></>;
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
const unlitThreeScene = new ThreeRuntime.Scene();
unlitThreeScene.add(
  new ThreeRuntime.Mesh(geometry, new ThreeRuntime.MeshStandardMaterial()),
);
new ThreeRuntime.WebGLRenderer().render(unlitThreeScene, camera);
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
const InertPointerAffordance = () => <div className="cursor-pointer">Open</div>;
const GenericMarketingCopy = () => <main>Supercharge your workflow</main>;
const GradientText = () => <h1 style={{ backgroundImage: "linear-gradient(red, blue)", backgroundClip: "text", color: "transparent" }}>Title</h1>;
const GrayOnColoredBackground = () => <div className="bg-blue-600 text-gray-400">Muted</div>;
const HeroEyebrowChip = () => <header><p className="uppercase tracking-widest">Built for teams</p><h1 className="text-7xl">Work together</h1></header>;
const CrampedContainerPadding = () => <div style={{ border: "1px solid", padding: 4 }}>Status</div>;
const InlineExhaustiveStyle = () => <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }} />;
const StableInlineExhaustiveStyle = <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }} />;
const StableIifeInlineExhaustiveStyle = (() => <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }} />)();
class InlineExhaustiveStyleHolder {
  static accessor stable = <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }} />;
  accessor instance = <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }} />;
}
class InlineExhaustiveStyleOuter { inner = class { static value = <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }} />; }; }
import { ImageResponse as GeneratedImageResponse } from "next/og";
import generatedSatori from "satori";
const GeneratedImageCard = () => <div style={{ display: "flex", width: 1200, height: 630, alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }}><img src="/product.png" alt="Image of a product card" /></div>;
const BuildGeneratedImageResponse = () => new GeneratedImageResponse(<GeneratedImageCard />);
const DirectGeneratedImageResponse = () => generatedSatori(<div style={{ display: "flex", width: 1200, height: 630, alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "black", color: "white" }} />, { width: 1200, height: 630 });
import ReactForFocusCompletion from "react";
const FocusAfterAnimation = () => { const inputRef = ReactForFocusCompletion.useRef(null); return <><input ref={inputRef} /><div onAnimationEnd={() => inputRef.current.focus()} /></>; };
// oxlint-disable-next-line react-doctor/no-invisible-focus-control
const HoverOnlyReveal = () => <><button className="opacity-0 hover:opacity-100">Edit</button><motion.button initial={{ opacity: 0 }} whileHover={{ opacity: 1 }}>Delete</motion.button></>;
const HoverTransformImage = () => <img src="/hover-transform.jpg" className="transition-transform hover:scale-105" />;
const IndeterminateCheckbox = () => <input type="checkbox" indeterminate />;
const indeterminateInputRef = useRef<HTMLInputElement | null>(null);
indeterminateInputRef.current?.toggleAttribute("indeterminate", true);
const markIndeterminateInput = (node: HTMLInputElement) => node.setAttribute("indeterminate", "true");
const markDestructuredIndeterminateInput = ({ node }: { node: HTMLInputElement }) => node.toggleAttribute("indeterminate");
export const MODULE_RANDOM_SAMPLE = Math.random();
const MODULE_RENDERED_AT = Date.now();
const MODULE_CURRENT_DATE = new Date();
const MODULE_BROWSER_MARK = typeof window === "undefined" ? 0 : performance.now();
const MODULE_SERVER_MARK = typeof window === "undefined" ? performance.now() : 0;
const [impureUpdaterCount, setImpureUpdaterCount] = useState(0);
setImpureUpdaterCount((previousCount) => {
  localStorage.setItem("count", String(previousCount));
  return previousCount + 1;
});
const InlineHocCard = withTracking((props) => {
  const theme = useInlineHocTheme();
  return <article className={theme}>{props.title}</article>;
});
// oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization
const MemoizedInlinePropCard = memo(InlinePropCard);
const getCachedUser = React.cache(async (params) => db.user.find(params));
getCachedUser(Object.freeze({ id: 1 }));
const InlinePropCardList = () => <MemoizedInlinePropCard onClick={() => doThing()} />;
const InvisibleFocusSelect = () => <select className="absolute inset-0 opacity-0"><option>UTC</option></select>;
const JsonClone = () => JSON.parse(JSON.stringify(state));
const JsxElementComponent = (): JSX.Element => <div />;
const CurlyBraceLiteral = () => <Widget label={"plain"} />;
const InconsistentHandlerName = () => <Widget onChange={ctx[action]} />;
const LargeAnimatedBlur = () => <motion.div animate={{ filter: "blur(24px)" }} />;
const LayoutPropertyAnimation = () => <motion.div animate={{ width: 200 }} />;
const LayoutShiftingInteractionState = () => <button className="hover:px-6">Save</button>;
const ManyBooleanProps: React.FC = ({ isOpen, isLoading, hasIcon, canEdit }) => <div />;
const MatchMediaState = () => useState(() => matchMedia("(max-width: 768px)").matches);
const MirrorPropEffect = ({ value }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};
const MonotonousPageSpacing = () => <main>
  <div style={{ padding: 16 }} /><div style={{ padding: 16 }} /><div style={{ padding: 16 }} />
  <div style={{ padding: 16 }} /><div style={{ padding: 16 }} /><div style={{ padding: 16 }} />
  <div style={{ padding: 16 }} /><div style={{ padding: 16 }} /><div style={{ padding: 16 }} />
  <div style={{ padding: 16 }} /><div style={{ padding: 16 }} /><div style={{ padding: 16 }} />
</main>;
const MultipleNavigationLandmarks = () => <><nav>Primary</nav><nav>Footer</nav></>;
const MutableDependency = () => {
  useEffect(() => {}, [location.href]);
  return null;
};
const MutatingPropArray = ({ items }) => items.sort();
const MutatingReducerState = () => useReducer((state) => { state.count += 1; return state; }, { count: 0 });
element.matches(location.hash);
const NullishRatio = maybeValue ?? 0 / divisor;
const NumberedSections = () => <main><section><span style={{ fontSize: 12, fontFamily: "monospace" }}>01</span><h2>Principles</h2></section><section><span style={{ fontSize: 12, fontWeight: 600 }}>02</span><h2>Process</h2></section></main>;
const objectCoercionValue = { code: 1 };
const ObjectCoercion = () => \`Error: \${objectCoercionValue}\`;
const PassiveOwnerRef = ({ viewId }) => { const ownerRef = useRef(viewId); const [, setData] = useState([]); useEffect(() => { ownerRef.current = viewId; }, [viewId]); const load = async () => { const data = await fetchData(viewId); if (ownerRef.current !== viewId) return; setData(data); }; return <button onClick={load}>Load</button>; };
import { resolve as resolveContainmentPath } from "node:path";
const containmentRoot = process.cwd();
const containmentCandidate = resolveContainmentPath(containmentRoot, requestedPath);
const HasUnsafePathPrefix = containmentCandidate.startsWith(containmentRoot);
const PlaceholderOnlyField = () => <input placeholder="Email address" />;
const PolymorphicChildren = ({ children }) => typeof children === "string" ? <span>{children}</span> : <div>{children}</div>;
const isPredicateReady = () => true;
if (isPredicateReady) runPredicateReadyTask();
const PreventDefaultLink = () => <a href="https://example.com" onClick={(event) => event.preventDefault()}>Next</a>;
const RandomKeyList = () => <div key={Math.random()} />;
const RefCleanupBeforeReact19 = () => <div ref={(node) => () => node.remove()} />;
const UncontrolledInput = ({ value }) => <input value={value} />;
const UndeferredThirdParty = () => <script src="https://cdn.example.com/widget.js" />;
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
    jsxFilenameMismatchFixturePath,
    'import React from "react";\nexport const JsxFilenameMismatch = () => <div />;\n',
  );
  fs.writeFileSync(jsxFilenameAsNeededFixturePath, "export const value = 1;\n");
  fs.writeFileSync(jsxFilenameIgnoredFixturePath, "// no code\n");
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
  fs.writeFileSync(
    ogImageFixturePath,
    'import React from "react"; export const runtime = "edge"; export default function Image() { return <img src="/product.png" alt="Image of a product card" />; }',
  );
  fs.mkdirSync(path.dirname(routeHandlerFixturePath), { recursive: true });
  fs.writeFileSync(routeHandlerFixturePath, "export default function handler() {}\n");
  fs.writeFileSync(
    asyncClientFixturePath,
    `'use client';\nimport React from "react";\nexport default async function AsyncProfile() { return <div />; }\nconst AsyncSettings = async () => <section />;\nconst FrozenClient = Object.freeze(Object.seal(async () => <main />));\nconst SyncClient = Object.freeze(() => <aside />);\n`,
  );
  fs.writeFileSync(
    r3fLightingFixturePath,
    `import React from "react";\nimport { Canvas } from "@react-three/fiber";\nexport const UnlitScene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;\n`,
  );
  fs.writeFileSync(
    r3fMetalEnvironmentFixturePath,
    `import React from "react";\nimport { Canvas } from "@react-three/fiber";\nexport const MetallicScene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial metalness={0.9} /></mesh><directionalLight /></Canvas>;\n`,
  );
  fs.writeFileSync(
    r3fNoCompileFixturePath,
    `import React from "react";\nimport { useFrame } from "@react-three/fiber";\nexport const CompileScene = () => { useFrame(({ gl, scene, camera }) => gl.compile(scene, camera)); useFrame((state) => state.renderer.compileAsync(state.scene, state.camera)); return null; };\n`,
  );
  fs.writeFileSync(
    r3fClockFixturePath,
    `import React from "react";\nimport { useFrame } from "@react-three/fiber";\nexport const ClockScene = () => { useFrame(({ clock }) => clock.getElapsedTime()); useFrame((state) => { const frameClock = state.clock; frameClock.getDelta(); }); return null; };\n`,
  );
  fs.writeFileSync(
    r3fCapDprFixturePath,
    `import React from "react";\nimport { Canvas, createRoot, useThree } from "@react-three/fiber";\nexport const DprScene = () => {\n  const directRoot = createRoot(canvas);\n  const [{ root }] = React.useState(() => ({ root: createRoot(canvas) }));\n  const selectedSetDpr = useThree((state) => state.setDpr);\n  const { setDpr } = useThree();\n  directRoot.configure({ dpr: window.devicePixelRatio });\n  root.configure({ dpr: globalThis.devicePixelRatio, ...props });\n  selectedSetDpr(window.devicePixelRatio);\n  setDpr(globalThis.devicePixelRatio);\n  return <Canvas dpr={window.devicePixelRatio} pixelRatio={globalThis.devicePixelRatio} />;\n};\n`,
  );
  fs.writeFileSync(
    r3fCloneInFrameFixturePath,
    `import React from "react";\nimport { useFrame, useThree } from "@react-three/fiber";\nexport const CloneScene = ({ enabled }) => {\n  const mesh = React.useRef(null);\n  const camera = useThree((state) => state.camera);\n  const { pointer } = useThree();\n  useFrame((state) => {\n    mesh.current.position.clone();\n    state.scene.clone();\n    camera.position.clone();\n    pointer.clone();\n    if (enabled) state.camera.clone();\n  });\n  return <mesh ref={mesh} />;\n};\n`,
  );
  fs.writeFileSync(
    r3fDeepSelectorFixturePath,
    `import React from "react";\nimport * as Fiber from "@react-three/fiber";\nconst clockSelector = React.useCallback((state) => {\n  const clock = state.clock;\n  return clock.elapsedTime;\n}, []);\nexport const DeepSelectorScene = () => {\n  const zoom = Fiber.useThree((state) => state.camera.zoom);\n  const x = Fiber.useThree(({ camera }) => camera.position.x);\n  const elapsedTime = Fiber.useThree(clockSelector);\n  const position = Fiber.useThree((state) => state.camera.position);\n  return consume(zoom, x, elapsedTime, position);\n};\n`,
  );
  fs.writeFileSync(
    r3fDisposeLoaderCacheFixturePath,
    `import { useGLTF, useTexture } from "@react-three/drei";\nconst texture = useTexture(textureUrl);\nconst model = useGLTF(modelUrl);\nconst clone = model.scene.clone();\ntexture.dispose();\nmodel.scene.dispose();\nmodel.nodes.Mesh.geometry.dispose();\nclone.geometry.dispose();\nclone.children[0].material.dispose();\nmodel.scene.traverse((child) => child.material.dispose());\nObject.values(model.materials).forEach((material) => material.map.dispose());\nclone.traverse((child) => { child.position.dispose(); child.geometry.dispose(); });\nclone.dispose();\nclone.position.dispose();\n`,
  );
  fs.writeFileSync(
    r3fDuplicatePrimitiveFixturePath,
    `import React from "react";\nimport "@react-three/fiber";\nexport const SameBinding = ({ scene }) => <><primitive object={scene} /><primitive object={scene} /></>;\nexport const SameMember = ({ model }) => <><primitive object={model.scene} /><primitive object={model["scene"]} /></>;\nexport const RepeatedMap = ({ scene }) => <>{["left", "right"].map((side) => <primitive key={side} object={scene} />)}</>;\nexport const NamedMap = ({ scene }) => { const renderPrimitive = (side) => <primitive key={side} object={scene} />; return ["left", "right"].map(renderPrimitive); };\nexport const InlineHelper = ({ scene }) => <>{(() => <primitive object={scene} />)()}<primitive object={scene} /></>;\nexport const Complementary = ({ scene, detail }) => <>{detail && <primitive object={scene} />}{!detail && <primitive object={scene} />}</>;\nexport const TrailingSpread = ({ scene, props }) => <><primitive object={scene} {...props} /><primitive object={scene} /></>;\nexport const UnusedLocal = ({ scene }) => { const unused = <primitive object={scene} />; return <primitive object={scene} />; };\nconst sharedScene = loadScene();\nconst renderModulePrimitive = (side) => <primitive key={side} object={sharedScene} />;\n["left", "right"].map(renderModulePrimitive);\n`,
  );
  fs.writeFileSync(
    r3fPointerAllocationFixturePath,
    `import React from "react";\nimport { Canvas } from "@react-three/fiber";\nimport { Vector3 } from "three";\nconst handlePointerMove = (event) => {\n  consume(new Vector3(), event.point.clone(), event.object.position.clone());\n  if (enabled) consume(new Vector3());\n};\nexport const PointerScene = () => <Canvas><mesh onPointerMove={handlePointerMove} /></Canvas>;\n`,
  );
  fs.writeFileSync(
    r3fExtendNamespaceFixturePath,
    `import { extend } from "@react-three/fiber";\nimport * as Fiber from "@react-three/fiber/native";\nimport * as THREE from "three";\nimport Three = require("three");\nextend(THREE);\nextend({ ...THREE });\nFiber.extend(Three);\nconst CommonJsFiber = require("@react-three/fiber");\nCommonJsFiber.extend(require("three"));\n`,
  );
  fs.writeFileSync(
    r3fFreshPortalFixturePath,
    `import React from "react";\nimport { createPortal } from "@react-three/fiber";\nexport const FreshPortalScene = ({ source }) => createPortal(<mesh />, source.clone());\nexport const StablePortalScene = ({ container }) => createPortal(<mesh />, container);\n`,
  );
  fs.writeFileSync(
    r3fFreshSelectorFixturePath,
    `import { useThree } from "@react-three/fiber";\nexport const FreshSelectorScene = () => useThree((state) => ({ camera: state.camera }));\nexport const StableSelectorScene = () => useThree((state) => state.camera);\nexport const OrderedSelectorScene = ({ enabled }) => useThree((state) => enabled ? (() => state.camera) : ({ camera: state.camera }));\n`,
  );
  fs.writeFileSync(
    r3fManagedRefAttachmentFixturePath,
    `import React from "react";\nimport "@react-three/fiber";\nimport { Scene } from "three";\nexport const ManagedRefScene = () => { const meshRef = React.useRef(null); const scene = new Scene(); scene.add(meshRef.current); return <mesh ref={meshRef} />; };\n`,
  );
  fs.writeFileSync(
    r3fInlinePrimitiveFixturePath,
    `import React from "react";\nimport "@react-three/fiber";\nexport const PrimitiveScene = () => <primitive object={scene.clone()} />;\n`,
  );
  fs.writeFileSync(
    r3fInlineResourceFixturePath,
    `import React from "react";\nimport "@react-three/fiber";\nimport { MeshBasicMaterial } from "three";\nexport const ResourceScene = () => <mesh material={new MeshBasicMaterial()} />;\n`,
  );
  fs.writeFileSync(
    r3fManualResizeFixturePath,
    `import { useThree } from "@react-three/fiber";\nexport const ResizeScene = () => { const gl = useThree((state) => state.gl); window.addEventListener("resize", () => gl.setSize(1, 1)); return null; };\n`,
  );
  fs.writeFileSync(
    r3fAnimationMixerFixturePath,
    `import { useFrame } from "@react-three/fiber";\nimport { AnimationMixer } from "three";\nexport const MixerScene = ({ model, clip }) => { const mixer = new AnimationMixer(model); mixer.clipAction(clip).play(); useFrame(() => {}); return null; };\nexport const GeneratorMixerScene = ({ model, clip }) => { const generatorMixer = new AnimationMixer(model); generatorMixer.clipAction(clip).play(); useFrame(function* () { generatorMixer.update(1); }); return null; };\n`,
  );
  fs.writeFileSync(
    r3fMutateLoaderCacheFixturePath,
    `import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { useGLTF as typedUseGLTF } from "@react-three/drei";
import * as Drei from "@react-three/drei";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const { nodes, scene } = useGLTF(url);
nodes.Mesh.geometry.center();
scene.rotation.x = 1;
const root = useThree((state) => state.scene);
root.add(scene);
typedUseGLTF(url).scene.clear();

const clone = scene.clone();
clone.position.set(1, 2, 3);
texture.dispose();
const { scene: fallbackScene = localScene } = useGLTF(url);
fallbackScene.clear();
Drei.useGLTF = localHook;
Drei.useGLTF(url).scene.clear();
SkeletonUtils.clone = localClone;
SkeletonUtils.clone(scene).geometry.center();
`,
  );
  fs.writeFileSync(
    r3fMutateUniformSourceFixturePath,
    `import React from "react";
import * as Fiber from "@react-three/fiber";

export const DirectUniformScene = () => {
  const uniforms = { time: { value: 0 } };
  Fiber.useFrame(() => {
    uniforms.time.value = 1;
  });
  return <shaderMaterial uniforms={uniforms} />;
};

export const AliasUniformScene = () => {
  const source = { color: { value: [1, 0, 0] } };
  const alias = source;
  Fiber.useFrame(() => {
    alias.color.value[0]++;
  });
  return <rawShaderMaterial uniforms={source} />;
};

export const HelperUniformScene = () => {
  const uniforms = { time: { value: 0 } };
  const tick = () => {
    uniforms.time.value += 1;
  };
  Fiber.useFrame(() => tick());
  return <shaderMaterial uniforms={uniforms} />;
};

export const ObscuredUniformScene = () => {
  const uniforms = { time: { value: 0 } };
  Fiber.useFrame(() => {
    uniforms.time.value = 1;
  });
  return <shaderMaterial uniforms={uniforms} {...props} />;
};
`,
  );
  fs.writeFileSync(
    r3fMutatingPointerEventDataFixturePath,
    `import React, { startTransition } from "react";
import { Canvas } from "@react-three/fiber";

const direct = <mesh onPointerMove={(event) => event[\`point\`][\`set\`](1, 2, 3)} />;
const assigned = <mesh onPointerDown={(event) => { const point = event.point; point.x = 1; }} />;
const destructured = <mesh onClick={({ [\`point\`]: hitPoint }) => hitPoint.applyMatrix4(matrix)} />;
const converted = <mesh onPointerUp={(event) => object.worldToLocal(event.ray.origin)} />;
const captured = <mesh onPointerOut={(event) => { const mutate = () => { event.uv.x++; }; mutate(); }} />;
const immediate = <mesh onWheel={(event) => { startTransition(() => event.normal.normalize()); }} />;

const propertyName = "point";
const computed = <mesh onPointerMove={(event) => event[propertyName].set(1, 2, 3)} />;
const obscured = <mesh onPointerMove={(event) => event.point.set(1, 2, 3)} {...props} />;
void Canvas;
`,
  );
  fs.writeFileSync(
    r3fNewInFrameFixturePath,
    `import { startTransition } from "react";
import { useFrame } from "@react-three/fiber";

const allocate = () => new BufferGeometry();
useFrame(() => {
  new Vector3();
  allocate();
  startTransition(() => new Quaternion());
  [event].map(() => new Event());
  scheduler.map(() => new DeferredEvent());
  if (needsResize) new Matrix4();
});
useFrame(function* () {
  yield new Euler();
});
`,
  );
  fs.writeFileSync(
    r3fNullLoaderFixturePath,
    `import { useLoader } from "@react-three/fiber";
import * as NativeFiber from "@react-three/fiber/native";
import { useCubeTexture, useGLTF, useTexture } from "@react-three/drei";
import type { useGLTF as typeOnlyUseGLTF } from "@react-three/drei/native";

useLoader(TextureLoader, null);
NativeFiber.useLoader(TextureLoader, undefined);
useLoader(TextureLoader, void missingUrl);
const modelUrl = enabled ? url : null;
const selectedUrl = modelUrl;
useGLTF(selectedUrl);
useGLTF(asset?.url);
useCubeTexture([px, nx, undefined, ny, pz, nz]);
useTexture({ map: colorUrl, normalMap: enabled ? normalUrl : null });
const { useGLTF: loadRequiredModel } = require("@react-three/drei");
const Drei = require("@react-three/drei");
const loadModel = require("@react-three/drei").useGLTF;
loadRequiredModel(null);
Drei.useGLTF(null);
loadModel(null);
typeOnlyUseGLTF(null);

useLoader(TextureLoader, realUrl);
useGLTF(true ? realUrl : null);
useTexture(realUrl, null);
`,
  );
  fs.writeFileSync(
    r3fObjectPointerCaptureFixturePath,
    `import React from "react";
import { Canvas } from "@react-three/fiber";

const direct = <mesh onPointerDown={(event) => {
  event.object.setPointerCapture(event.pointerId);
  event.eventObject[\`releasePointerCapture\`](event.pointerId);
}} />;
const destructured = <mesh onPointerMove={({ object: hitObject }) => hitObject.hasPointerCapture(1)} />;
const computed = <mesh onPointerUp={(event) => { const { ["eventObject"]: hitObject } = event; hitObject.setPointerCapture(1); }} />;
const CommonReact = require("react");
const callback = CommonReact.useCallback((event) => event.object.setPointerCapture(1), []);
const commonJs = <group onPointerDown={callback} />;
const line = <line onPointerDown={(event) => event.object.setPointerCapture(1)} />;

const reassigned = <mesh onPointerDown={({ object }) => { object = target; object.setPointerCapture(1); }} />;
const domTarget = <mesh onPointerDown={(event) => event.target.setPointerCapture(1)} />;
const dom = <div onPointerDown={(event) => event.object.setPointerCapture(1)} />;
const obscured = <mesh onPointerDown={(event) => event.object.setPointerCapture(1)} {...props} />;
void Canvas;
`,
  );
  fs.writeFileSync(
    r3fRecursiveRafFixturePath,
    `import React from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { importedAnimation } from "./animation-callbacks";

const renderLoop = () => requestAnimationFrame(renderLoop);
const effectLoop = () => requestAnimationFrame(effectLoop);
const helperLoop = () => requestAnimationFrame(helperLoop);
const startHelperLoop = () => requestAnimationFrame(helperLoop);
const loops = { animate() { requestAnimationFrame(loops.animate); } };

export const CompetingLoopScene = () => {
  useFrame(() => {});
  requestAnimationFrame(renderLoop);
  requestAnimationFrame(loops.animate);
  startHelperLoop();
  React.useEffect(() => requestAnimationFrame(effectLoop), []);
  const gl = useThree((state) => state.gl);
  const { renderer } = useThree();
  gl.setAnimationLoop(importedAnimation);
  renderer[\`setAnimationLoop\`](() => renderFrame());
  return null;
};

export const QuietLoopScene = ({ renderer }) => {
  useFrame(() => {});
  requestAnimationFrame(() => renderFrame());
  setTimeout(() => requestAnimationFrame(renderLoop), 0);
  renderer.setAnimationLoop(() => renderFrame());
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fShaderConfigurationFixturePath,
    `import React from "react";
import { useFrame } from "@react-three/fiber";

export const ShaderConfigurationScene = () => {
  const materialRef = React.useRef();
  useFrame(() => {
    materialRef.current.fragmentShader = buildShader();
    (materialRef.current.vertexShader as unknown) = buildVertexShader();
    materialRef.current.defines.MODE = mode;
    materialRef.current.uniforms = makeUniforms();
  });
  return <shaderMaterial ref={materialRef} />;
};

export const StableShaderConfigurationScene = () => {
  const materialRef = React.useRef();
  useFrame(() => {
    materialRef.current.uniforms.time.value += 1;
    if (changed) materialRef.current.defines.MODE = mode;
  });
  return <rawShaderMaterial ref={materialRef} />;
};
`,
  );
  fs.writeFileSync(
    r3fStatePointerMoveFixturePath,
    `import React from "react";
import { flushSync } from "react-dom";
import "@react-three/fiber";

export const PointerStateScene = () => {
  const [point, setPoint] = React.useState(null);
  const [, dispatch] = React.useReducer(reducer, initial);
  const updatePoint = setPoint;
  const pointState = React.useState(null);
  const [, setWorldBucket] = React.useState(0);
  const [, setScreenBucket] = React.useState(0);
  const [, setFace] = React.useState(0);
  return <>
    <mesh onPointerMove={(event) => { setPoint(event.point); dispatch(event); }} />
    <mesh onPointerMove={(event) => updatePoint(event.point)} />
    <mesh onPointerMove={(event) => {
      setWorldBucket(Math.floor(event.point.x / 2));
      setScreenBucket(Math.round(event.clientX / 100));
      setFace(event.faceIndex);
    }} />
    <mesh onPointerMove={(event) => {
      pointState[1](event.point);
      flushSync(() => pointState[1](event.point));
    }} />
    <mesh onPointerMove={(event) => {
      if (point !== event.point) setPoint(event.point);
    }} />
  </>;
};
`,
  );
  fs.writeFileSync(
    r3fSyncReadbackFixturePath,
    `import { startTransition } from "react";
import { useFrame } from "@react-three/fiber";

useFrame(({ gl }) => gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels));
useFrame((state) => state.renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixels));
const pixels = new Uint8Array(4);
const { defaultPixels = new Uint8Array(4) } = buffers;
useFrame(() => {
  const context = canvas.getContext("2d");
  context.getImageData(0, 0, canvas.width, canvas.height);
  const webgl = canvas.getContext("webgl2");
  webgl.readPixels(0, 0, 1, 1, RGBA, UNSIGNED_BYTE, pixels);
  webgl.readPixels(0, 0, 1, 1, RGBA, UNSIGNED_BYTE, defaultPixels);
  const { contextFromDefault = canvas.getContext("2d") } = source;
  contextFromDefault[\`getImageData\`](0, 0, canvas.width, canvas.height);
});
useFrame(({ gl }) => {
  [target].forEach(() => gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels));
  startTransition(() => gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels));
});
useFrame(({ gl }) => {
  if (captureRequested.current) gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels);
});
useFrame(function* ({ gl }) {
  gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels);
});
const Fiber = require("@react-three/fiber");
Fiber.useFrame = runOnce;
Fiber.useFrame(() => canvas.getContext("2d").getImageData(0, 0, 1, 1));
`,
  );
  fs.writeFileSync(
    r3fStateInFrameFixturePath,
    `import React from "react";
import { flushSync } from "react-dom";
import { useFrame } from "@react-three/fiber";

export const FrameStateScene = () => {
  const [active, setActive] = React.useState(false);
  const [, dispatch] = React.useReducer(reducer, initialState);
  const updateActive = setActive;
  const updateFromHelper = () => setActive(false);
  useFrame(() => {
    setActive(true);
    updateActive(false);
    dispatch({ type: "tick" });
    updateFromHelper();
    [1].forEach(() => flushSync(() => setActive(false)));
  });
  return active ? <mesh /> : null;
};

export const GuardedFrameStateScene = () => {
  const [active, setActive] = React.useState(false);
  useFrame(() => {
    if (!active) setActive(true);
  });
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fUnstableArgsFixturePath,
    `import React from "react";
import "@react-three/fiber";
import { Vector3 } from "three";

const stableOrigin = new Vector3();
const stableArgs = [stableOrigin];

export const UnstableArgsScene = ({ wide, inheritedArgs, props }) => {
  const localArgs = [{ width: 1 }];
  const conditionalArgs = wide ? [new Vector3()] : inheritedArgs;
  const spreadArgs = [{ width: 2 }];
  return <>
    <shapeGeometry args={[new Vector3()]} />
    <mesh args={localArgs} />
    <boxGeometry args={conditionalArgs} />
    <boxGeometry args={[...spreadArgs]} />
    <mesh args={[{ width: 4 }]} {...props} />
    <mesh {...props} args={[{ width: 5 }]} />
    <mesh args={[{ width: 6 }]} {...{ visible: true }} />
    <mesh args={[{ width: 7 }]} {...{ args: stableArgs }} />
    <mesh args={[1, 2, 3]} />
    <div args={[{ ignored: true }]} />
  </>;
};
`,
  );
  fs.writeFileSync(
    r3fGpuInstancedAnimationFixturePath,
    `import React from "react";
import { useFrame } from "@react-three/fiber";
import { InstancedMesh } from "three";

const directMesh = new InstancedMesh(geometry, material, 4);

export const InstancedAnimationScene = ({ count }) => {
  const instances = React.useRef(null);
  const ordinaryMesh = React.useRef(null);
  useFrame(() => {
    for (let index = 0; index < count; index += 1) {
      instances.current.setMatrixAt(index, matrix);
    }
    [0, 1].forEach((index) => instances.current.setMatrixAt(index, matrix));
    instances.current.instanceMatrix.needsUpdate = true;
    ordinaryMesh.current.setMatrixAt(0, matrix);
  });
  return <><instancedMesh ref={instances} /><mesh ref={ordinaryMesh} /></>;
};

useFrame(() => {
  for (const index of indices) directMesh.setMatrixAt(index, matrix);
});
`,
  );
  fs.writeFileSync(
    r3fGpuPositionAnimationFixturePath,
    `import React from "react";
import { useFrame } from "@react-three/fiber";

export const PositionAnimationScene = ({ geometry, nextPositions }) => {
  const positions = React.useRef(null);
  useFrame(() => {
    for (let index = 0; index < 100; index += 1) {
      positions.current.setXYZ(index, index, 0, 0);
    }
  });
  useFrame(() => {
    const positionArray = geometry.attributes.position.array;
    for (let index = 0; index < positionArray.length; index += 1) {
      positionArray[index] += 1;
    }
    geometry.getAttribute("position").array.set(nextPositions);
  });
  useFrame(() => {
    [0, 1, 2].forEach((index) => geometry.getAttribute("position").setY(index, index));
  });
  useFrame(() => geometry.attributes.position.array.fill(0));
  useFrame(() => {
    geometry.attributes.position.setX(0, 1);
    geometry.attributes.position.array[0] = 1;
    if (enabled) geometry.attributes.position.array.fill(0);
  });
  return <bufferGeometry><bufferAttribute ref={positions} attach="attributes-position" /></bufferGeometry>;
};
`,
  );
  fs.writeFileSync(
    r3fInstancedMeshFixturePath,
    `import React from "react";
import "@react-three/fiber";

const geometry = createGeometry();
const material = createMaterial();
const renderMesh = (index) => <mesh key={index} geometry={geometry} material={material} />;

export const InstancedMeshScene = () => <>
  {[0, 1].map((index) => <mesh key={index} geometry={geometry} material={material} />)}
  {[0, 1, 2].map(renderMesh)}
  {[0].map((index) => <mesh key={index} geometry={geometry} material={material} />)}
  {[0, 1].map((index) => <mesh key={index} geometry={geometries[index]} material={material} />)}
</>;
`,
  );
  fs.writeFileSync(
    r3fPreferUseLoaderFixturePath,
    `import React from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

export const LoaderScene = () => {
  useFrame(() => {});
  React.useEffect(() => {
    new THREE.CubeTextureLoader().load(["px", "nx"]);
    textureLoader.loadAsync("texture.png");
    const loadModel = () => gltfLoader.load("model.glb");
    loadModel();
    setTimeout(() => textureLoader.load("later.png"), 0);
  }, []);
  return <mesh />;
};
`,
  );
  fs.writeFileSync(
    r3fDataTextureUpdateFixturePath,
    `import React from "react";
import { useFrame } from "@react-three/fiber";
import { DataTexture } from "three";

const pixels = new Uint8Array(16);
const texture = new DataTexture(pixels, 2, 2);

export const DataTextureScene = () => {
  const managedTexture = React.useRef(null);
  useFrame(() => {
    texture.image.data[0] = 255;
  });
  useFrame(() => {
    managedTexture.current.image.data.fill(0);
  });
  useFrame(() => {
    texture.image.data[1] = 255;
    texture.needsUpdate = true;
  });
  return <dataTexture ref={managedTexture} />;
};
`,
  );
  fs.writeFileSync(
    r3fDynamicBufferUsageFixturePath,
    `import React from "react";
import { useFrame } from "@react-three/fiber";
import { DynamicDrawUsage } from "three";

export const DynamicBufferScene = () => {
  const staticBuffer = React.useRef(null);
  const dynamicBuffer = React.useRef(null);
  useFrame(() => {
    staticBuffer.current.needsUpdate = true;
    dynamicBuffer.current.needsUpdate = true;
  });
  return <>
    <bufferAttribute ref={staticBuffer} />
    <bufferAttribute ref={dynamicBuffer} usage={DynamicDrawUsage} />
  </>;
};
`,
  );
  fs.writeFileSync(
    r3fOwnedTextureCleanupFixturePath,
    `import React from "react";
import { CanvasTexture } from "three";

export const MissingTextureCleanup = ({ canvas }) => {
  const [texture] = React.useState(() => new CanvasTexture(canvas));
  return <meshStandardMaterial map={texture} />;
};
export const CompleteTextureCleanup = ({ canvas }) => {
  const [texture] = React.useState(() => new CanvasTexture(canvas));
  React.useEffect(() => () => texture.dispose(), [texture]);
  return <meshStandardMaterial map={texture} />;
};
`,
  );
  fs.writeFileSync(
    r3fPositionBufferUpdateFixturePath,
    `import { useFrame } from "@react-three/fiber";

export const MissingPositionUpload = ({ geometry }) => {
  useFrame(() => {
    for (let index = 0; index < 10; index += 1) geometry.attributes.position.setX(index, index);
  });
  return null;
};
export const CompletePositionUpload = ({ geometry }) => {
  useFrame(() => {
    for (let index = 0; index < 10; index += 1) geometry.attributes.position.setX(index, index);
    geometry.attributes.position.needsUpdate = true;
  });
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fProjectionMatrixUpdateFixturePath,
    `import { useFrame } from "@react-three/fiber";

export const MissingProjectionRefresh = () => {
  useFrame(({ camera }) => {
    camera.aspect = 2;
  });
  return null;
};
export const CompleteProjectionRefresh = () => {
  useFrame(({ camera }) => {
    camera.aspect = 2;
    camera.updateProjectionMatrix();
  });
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fRenderTargetResetFixturePath,
    `import { useFrame } from "@react-three/fiber";
import { WebGLRenderTarget } from "three";

const target = new WebGLRenderTarget(256, 256);
export const MissingTargetReset = ({ scene, camera }) => {
  useFrame(({ gl }) => {
    gl.setRenderTarget(target);
    gl.render(scene, camera);
  });
  return null;
};
export const ConditionalTargetReset = () => {
  useFrame(({ gl }) => {
    gl.setRenderTarget(target);
    if (shouldRestore) gl.setRenderTarget(null);
  });
  return null;
};
export const CompleteTargetReset = () => {
  useFrame(({ gl }) => {
    gl.setRenderTarget(target);
    gl.setRenderTarget(null);
  });
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fRenderWithPositivePriorityFixturePath,
    `import { useFrame as scheduleFrame } from "@react-three/fiber";

const renderPriority = +2 as number;
export const PositiveStaticPriority = () => {
  scheduleFrame(() => update(), 1);
  scheduleFrame(() => updateAgain(), renderPriority);
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fRenderWithPositivePriorityWorkingFixturePath,
    `import { useFrame } from "@react-three/fiber";

export const PositiveWorkingCallbacks = () => {
  useFrame(() => { updateOne(); return null; }, 1);
  useFrame(() => { updateTwo(); return null; }, 2);
  useFrame(() => (updateThree(), null), 3);
  useFrame(() => true, 4);
  useFrame(() => undefined, 5);
  useFrame(() => void updateSix(), 6);
  useFrame(() => {}, 7);
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fRenderWithPositivePriorityNamespaceFixturePath,
    `import * as Fiber from "@react-three/fiber";

export const PositiveNamespaceAlias = () => {
  const updateFrame = () => tick();
  const updateFrameAlias = updateFrame;
  Fiber["useFrame"](updateFrameAlias, 1);
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fRenderWithPositivePriorityTemplateFixturePath,
    `import Mustache from "mustache";
import * as Handlebars from "handlebars";
import { useFrame } from "@react-three/fiber";

const templates = Mustache;
export const PositiveTemplateRender = () => {
  useFrame(() => {
    templates.render(source, view);
    Handlebars.render(source, view);
  }, 1);
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fValidTextureColorSpaceFixturePath,
    `import React from "react";
import { Canvas } from "@react-three/fiber";
import { NoColorSpace, SRGBColorSpace, Texture } from "three";

const color = new Texture();
color.colorSpace = NoColorSpace;
const normal = new Texture();
normal.colorSpace = SRGBColorSpace;
export const InvalidTextureColorSpace = () => <Canvas>
  <meshPhysicalMaterial map={color} emissiveMap={color} normalMap={normal} />
</Canvas>;
`,
  );
  fs.writeFileSync(
    r3fWebgpuNoGlStateFixturePath,
    `import { useFrame, useThree } from "@react-three/fiber/webgpu";
import * as Fiber from "@react-three/fiber/webgpu";

const { useCallback } = require("react");
const selectedRenderer = useThree((state) => state.gl);
const { gl: destructuredRenderer } = useThree();
const selectedState = useThree();
const directRenderer = selectedState["gl"];
Fiber.useFrame(({ gl }) => gl.render(scene, camera));
Fiber.useFrame((state) => state.gl.render(scene, camera));
useThree((state) => { const { gl } = state; return gl; });
useFrame((state) => { const { ["gl"]: renderer } = state; renderer.render(scene, camera); });
useThree((state) => { const { gl = fallbackRenderer } = state; return gl; });
useFrame((state) => {
  const { ["gl"]: renderer = fallbackRenderer } = state;
  renderer.render(scene, camera);
});
const updateFrame = useCallback((state) => state.gl.render(scene, camera), []);
useFrame(updateFrame);
`,
  );
  fs.writeFileSync(
    r3fWebgpuNoHighPrecisionInstancingFixturePath,
    `import React from "react";
import { Canvas } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";

const createHighPrecisionRenderer = async () => {
  const renderer = new WebGPURenderer();
  renderer.highPrecision = true;
  await renderer.init();
  return renderer;
};
export const HighPrecisionInstancing = () => <Canvas gl={createHighPrecisionRenderer}>
  <instancedMesh args={[geometry, material, 10]} />
</Canvas>;
`,
  );
  fs.writeFileSync(
    r3fRootUnmountFixturePath,
    `import React from "react";
import { createRoot } from "@react-three/fiber";
import { createRoot as createNativeRoot } from "@react-three/fiber/native";
import * as Fiber from "@react-three/fiber/webgpu";

export const MissingEffectCleanup = ({ canvas }) => {
  React.useEffect(() => { const root = createRoot(canvas); root.configure({}); }, [canvas]);
  return null;
};
export const MissingProvenanceCleanup = ({ firstCanvas, secondCanvas }) => {
  React.useEffect(() => { const firstRoot = createNativeRoot(firstCanvas); firstRoot.configure({}); }, [firstCanvas]);
  React.useEffect(() => { const secondRoot = Fiber.createRoot(secondCanvas); secondRoot.configure({}); }, [secondCanvas]);
  return null;
};
export const MissingStableCleanup = ({ canvas }) => {
  const root = React.useMemo(() => createRoot(canvas), []);
  root.configure({});
  return null;
};
export const MissingLazyRefCleanup = ({ canvas }) => {
  const rootRef = React.useRef(null);
  if (!rootRef.current) rootRef.current = createRoot(canvas);
  return null;
};
export const MissingReturnedDisposerInvocation = (canvas) => {
  const root = createRoot(canvas);
  return () => root.unmount();
};
export const NestedPromiseIsNotCleanup = ({ canvas, ready }) => {
  React.useEffect(() => { const root = createRoot(canvas); ready.then(() => () => root.unmount()); }, [canvas, ready]);
  return null;
};

export const ExactCleanup = ({ canvas }) => {
  React.useEffect(() => { const root = createRoot(canvas); const alias = root; return () => alias.unmount(); }, [canvas]);
  return null;
};
export const StructuredStableCleanup = ({ canvas }) => {
  const { root } = React.useMemo(() => ({ root: createRoot(canvas) }), []);
  React.useEffect(() => () => root.unmount(), []);
  return null;
};
const moduleRoot = createRoot(document.querySelector("canvas"));
export const TransferredRoots = ({ canvas, manager }) => {
  const returnedRoot = createRoot(canvas);
  const adoptedRoot = createRoot(canvas);
  manager.adopt(adoptedRoot);
  return returnedRoot;
};
void moduleRoot;
`,
  );
  fs.writeFileSync(
    r3fFrameDeltaFixturePath,
    `import React, { createRef } from "react";
import { useRef } from "preact/hooks";
import { useFrame, useThree } from "@react-three/fiber";
import type { useThree as typedUseThree } from "@react-three/fiber";
import { MathUtils } from "three";

export const FrameDeltaScene = () => {
  useFrame(({ scene }) => {
    scene.rotation.y += 0.01;
    scene.position.x++;
    MathUtils.lerp(0, 1, 0.1);
  });
  return null;
};

export const RefFrameDeltaScene = () => {
  const meshRef = useRef(null);
  const createdRef = createRef();
  const colorRef = useRef(null);
  const camera = useThree((state) => state.camera);

  useFrame((_, delta) => {
    const frameDelta = delta;
    meshRef.current.position.x += speed * frameDelta;
    if (meshRef.current) meshRef.current.rotation.y += 0.03;
    if (createdRef.current) createdRef.current.rotation.y += 0.03;
    colorRef.current.lerp(targetColor, 0.1);
    camera.position.lerp(targetPosition, 0.1);
  });

  return (
    <>
      <mesh ref={meshRef} />
      <mesh ref={createdRef} />
      <color ref={colorRef} />
    </>
  );
};

export const LookAtScene = () => {
  const globeRef = useRef(null);

  useFrame(() => {
    if (!globeRef.current) return;
    globeRef.current.lookAt(center);
    globeRef.current.rotation.z += Math.PI / 2;
  });

  return <group ref={globeRef} />;
};

export const DelegatedFrameScene = () => {
  const delegatedRef = useRef(null);
  const advance = () => {
    delegatedRef.current.scale.x += 0.1;
  };
  const delegatedFrame = () => {
    advance();
  };

  useFrame(delegatedFrame);
  return <mesh ref={delegatedRef} />;
};

export const SelectorParityScene = () => {
  const selectors = { camera: (state) => state.camera };
  const memberCamera = useThree(selectors.camera);
  const conditionalCamera = useThree((state) => flag ? state.camera : state.camera);
  const partialCamera = useThree((state) => { if (flag) return state.camera; });
  const typedCamera = typedUseThree((state) => state.camera);
  const typedState = typedUseThree();

  useFrame(() => {
    memberCamera.position.x += 0.1;
    conditionalCamera.position.x += 0.1;
    partialCamera.position.x += 0.1;
    typedCamera.position.x += 0.1;
    typedState.camera.position.x += 0.1;
  });

  return null;
};

export const BindingParityScene = () => {
  useFrame(({ [\`scene\`]: scene }, delta) => {
    const { frameDelta } = { frameDelta: delta };
    const { alpha = 0.2 } = {};
    scene.scale.x += 0.1;
    scene.position.x += speed * frameDelta;
    scene.position.lerp(targetPosition, alpha);
  });
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fLitMaterialNormalsFixturePath,
    `const React = require("react"), Fiber = require("@react-three/fiber");
const { Canvas } = Fiber;

const positionAttachment = "attributes-position";
const Root = Canvas;

export const StandardMaterialScene = ({ texture }) => (
  <Canvas>
    <ambientLight />
    <mesh>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <meshStandardMaterial normalMap={texture} />
    </mesh>
  </Canvas>
);

export const PhongMaterialScene = ({ texture }) => (
  <Root>
    <ambientLight />
    <mesh>
      <bufferGeometry>
        <float32BufferAttribute attach={positionAttachment} args={[positions, 3]} />
      </bufferGeometry>
      <meshPhongMaterial normalMap={texture} />
    </mesh>
  </Root>
);
`,
  );
  fs.writeFileSync(
    r3fRequireUvFixturePath,
    `import React from "react";
import { Canvas } from "@react-three/fiber";

export const StandardMappedScene = ({ alpha, texture }) => (
  <Canvas>
    <ambientLight />
    <mesh>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <meshStandardMaterial map={texture} alphaMap={alpha} />
    </mesh>
  </Canvas>
);

export const PhysicalMappedScene = ({ texture }) => (
  <Canvas>
    <ambientLight />
    <mesh>
      <bufferGeometry>
        <float32BufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <meshPhysicalMaterial anisotropyMap={texture} />
    </mesh>
  </Canvas>
);

export const UvMappedScene = ({ texture }) => (
  <Canvas>
    <mesh>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-uv3" args={[uvs, 2]} />
      </bufferGeometry>
      <meshStandardMaterial map={texture} />
    </mesh>
  </Canvas>
);

export const HiddenMappedScene = ({ texture }) => (
  <Canvas>
    <group visible={false}>
      <mesh>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <meshStandardMaterial map={texture} />
      </mesh>
    </group>
  </Canvas>
);
`,
  );
  fs.writeFileSync(
    r3fGlobalEffectCleanupFixturePath,
    `import React from "react";
import { addAfterEffect, addEffect, addTail, useFrame } from "@react-three/fiber";
import type { startTransition } from "react";

export const GlobalEffectScene = ({ callback }) => {
  React.useEffect(() => {
    const dispose = addEffect(callback);
    const cleanup = () => dispose();
    const getCleanup = () => cleanup;
    return (getCleanup as typeof getCleanup)();
  }, [callback]);
  React.useLayoutEffect(() => {
    addAfterEffect(callback);
    addTail(callback);
  }, [callback]);
  React.useEffect(() => addEffect(callback), [callback]);
  React.useEffect(() => {
    startTransition(() => {
      addEffect(callback);
    });
  }, [callback]);
  React.useEffect(() => {
    (promise.then as typeof promise.then)(() => {
      addEffect(callback);
    });
  }, [callback]);
  React.useEffect = fakeEffect;
  const { useEffect: mutatedUseEffect } = React;
  mutatedUseEffect(() => {
    addEffect(callback);
  }, [callback]);
  addEffect(callback);
  useFrame(() => {
    addTail(callback);
  });
  return null;
};
`,
  );
  fs.writeFileSync(
    r3fInstancedBufferUpdateFixturePath,
    `import React from "react";
import { useRef } from "preact/hooks";
import { useFrame } from "@react-three/fiber";

export const InstancedBufferScene = () => {
  const meshRef = useRef(null);
  useFrame(() => {
    meshRef.current.setMatrixAt(0, matrix);
    meshRef.current.setColorAt(0, color);
  });
  const updateMorph = () => meshRef.current.setMorphAt(0, sourceMesh);
  const updateAndUploadMatrix = () => {
    meshRef.current.setMatrixAt(1, matrix);
    meshRef.current.instanceMatrix.needsUpdate = true;
  };
  const updateWithWrappedArray = () => {
    (Array as typeof Array).from(items, () => {
      meshRef.current.setMatrixAt(2, matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  };
  return <instancedMesh ref={meshRef} />;
};

export const UncertainStaticSpreadScene = () => {
  const uncertainRef = useRef(null);
  useFrame(() => {
    uncertainRef.current.setMatrixAt(0, matrix);
  });
  return <instancedMesh ref={uncertainRef} {...{"": true}} />;
};
`,
  );
  fs.writeFileSync(
    r3fShadowsFixturePath,
    `import React from "react";\nimport { Canvas } from "@react-three/fiber";\nexport const ShadowScene = () => <Canvas><directionalLight castShadow /><mesh receiveShadow /></Canvas>;\n`,
  );
  fs.writeFileSync(
    r3fTextureRepeatFixturePath,
    `import React from "react";\nimport { Canvas } from "@react-three/fiber";\nimport { RepeatWrapping as DirectRepeatWrapping } from "three";\nimport * as Three from "three";\nconst RequiredThree = require("three");\nexport const RepeatedTexture = () => <Canvas><texture repeat={[4, 1]} /><texture repeat={[4, 1]} wrapS={DirectRepeatWrapping} /><texture repeat={[4, 1]} wrapS={Three.RepeatWrapping} /><texture repeat={[4, 1]} wrapS={RequiredThree.RepeatWrapping} /></Canvas>;\n`,
  );
  fs.mkdirSync(path.dirname(safeGlobalErrorFixturePath), { recursive: true });
  fs.writeFileSync(
    safeGlobalErrorFixturePath,
    `'use client';\nimport React from "react";\nexport default function GlobalError() { return <html lang="en"><body /></html>; }\n`,
  );
  fs.writeFileSync(
    safePageFixturePath,
    `'use client';\nexport const runtime = "edge";\nexport default function Page() { useEffect(() => { fetch("/api/data"); }, []); return null; }\n`,
  );
  fs.mkdirSync(path.dirname(safeRouteHandlerFixturePath), { recursive: true });
  fs.writeFileSync(
    safeRouteHandlerFixturePath,
    "export const GET = () => new Response();\nexport default function handler() {}\n",
  );
  fs.writeFileSync(
    nonProductionFixturePath,
    `import { Canvas, useFrame } from "@react-three/fiber"; const ignoredTestLineWidth = <lineBasicMaterial linewidth={4} />; const unsupportedTestShadowLight = <ambientLight castShadow />; const ignoredTestBasicMaterialProperty = <meshBasicMaterial roughness={0.4} />; const invalidTestMaterialOpacity = <meshStandardMaterial opacity={1.2} />; const invalidTestPbrMaterialFactor = <meshStandardMaterial roughness={1.2} />; const invalidTestPhysicalMaterialProperty = <meshPhysicalMaterial clearcoat={2} />; const ignoredTestOpacity = <meshBasicMaterial opacity={0.5} />; const invalidTestBufferAttributeItemSize = <bufferAttribute args={[data, 0]} />; const invalidTestBufferAttributeArrayLength = <bufferAttribute args={[new Float32Array(8), 3]} />; const invalidTestShadowMapSize = <directionalLight castShadow shadow-mapSize={[1000, 1024]} />; const invalidTestRaycasterRange = <raycaster near={-1} />; const invalidTestFogParameters = <fog args={["white", 10, 5]} />; const invalidTestSpotLightAngle = <spotLight angle={2} />; const invalidTestPerspectiveCamera = <perspectiveCamera aspect={0} />; const invalidTestOrthographicCamera = <orthographicCamera left={2} right={2} />; const invalidTestNormalizedFloatAttribute = <float32BufferAttribute args={[data, 3, true]} />; const invalidTestWebgpuCanvas = <Canvas gl={{}} renderer={{}} />; const invalidTestShadowedPointLights = () => <group><pointLight castShadow /><pointLight castShadow /><pointLight castShadow /></group>; const shortcut = <button accessKey="s" />; const classicJsx = <div />; const inlineNextScript = <Script>window.analytics = true;</Script>; const smallTestInput = <input style={{ fontSize: 14 }} />; function nested(first, second, third, fourth) { if (first) { if (second) { if (third) { if (fourth) run(); } } } } items.map((item) => item.value).filter(Boolean); useEffect(() => {}, [{}]); useRef(buildCache()); useState(buildRows()); useState(new Worker("worker.js")); useMemo(() => value + 1, [value]); function TestCounter() { const [count, setCount] = useState(0); setTimeout(() => setCount(count + 1), 0); } function TestEventEffect() { const [payload, setPayload] = useState(null); useEffect(() => { if (payload) post(payload); }, [payload]); return { onClick: () => setPayload({ ok: true }) }; } useFrame(() => update(), []); void Canvas;`,
  );
  fs.writeFileSync(
    deepNonProductionFixturePath,
    `import React from "react"; const deeplyNestedTestJsx = <div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><span /></div></div></div></div></div></div></div></div></div></div></div></div></div></div></div>;`,
  );
  fs.writeFileSync(
    nonReactJsxFixturePath,
    `import { createSignal } from "solid-js";
import { Canvas } from "@react-three/fiber";
const ignoredSolidLineWidth = <lineBasicMaterial linewidth={4} />;
const ignoredSolidShadowLight = <ambientLight castShadow />;
const ignoredSolidBasicMaterialProperty = <meshBasicMaterial roughness={0.4} />;
const ignoredSolidMaterialOpacity = <meshStandardMaterial opacity={1.2} />;
const ignoredSolidPbrMaterialFactor = <meshStandardMaterial roughness={1.2} />;
const ignoredSolidPhysicalMaterialProperty = <meshPhysicalMaterial clearcoat={2} />;
const ignoredSolidOpacity = <meshBasicMaterial opacity={0.5} />;
const ignoredSolidBufferAttributeItemSize = <bufferAttribute args={[data, 0]} />;
const ignoredSolidBufferAttributeArrayLength = <bufferAttribute args={[new Float32Array(8), 3]} />;
const ignoredSolidShadowMapSize = <directionalLight castShadow shadow-mapSize={[1000, 1024]} />;
const ignoredSolidRaycasterRange = <raycaster near={-1} />;
const ignoredSolidFogParameters = <fog args={["white", 10, 5]} />;
const ignoredSolidSpotLightAngle = <spotLight angle={2} />;
const ignoredSolidPerspectiveCamera = <perspectiveCamera aspect={0} />;
const ignoredSolidOrthographicCamera = <orthographicCamera left={2} right={2} />;
const ignoredSolidNormalizedFloatAttribute = <float32BufferAttribute args={[data, 3, true]} />;
const ignoredSolidWebgpuCanvas = <Canvas gl={{}} renderer={{}} />;
const ignoredSolidShadowedPointLights = () => <group><pointLight castShadow /><pointLight castShadow /><pointLight castShadow /></group>;
const ignoredSolidDuplicatePrimitive = ({ scene }) => <><primitive object={scene} /><primitive object={scene} /></>;
void Canvas;
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
import { useConfiguredHook as configuredHook } from "./configured-hooks";
import { test as verify } from "vitest";
import { ProductComponent } from "./product-component";
import { z as configuredZod } from "zod";
configuredHook();
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
const configuredCurlyBracePresence = <Widget title="Hello" panel=<Panel />>Hello</Widget>;
const configuredHandlerNames = <><Widget whenChange={() => takeCareOfChange()} /><Widget value={handleChange} /><IgnoredWidget whenChange={() => takeCareOfChange()} /></>;
const configuredHeading = <Title />;
const configuredAllowedInvalidRole = <div role="datepicker" />;
const configuredImage = <ConfiguredImage />;
const configuredRedundantImageAlt = <ConfiguredImage alt="Portrait of a customer" />;
const configuredUnfocusableRole = <div role="slider" aria-label="Volume" onKeyDown={handle} />;
const configuredUnnestedLabel = <ConfiguredLabel htmlFor="configured-name" label="Name" />;
const configuredMouseOnly = <div onPointerEnter={handle} onPointerLeave={handle} />;
verify("forwards the fixture", () => { void <ProductComponent fixture={<img src="/fixture.png" />} />; });
const configuredInvalidAnchor = <a to="">Destination</a>;
const configuredMissingFragmentAnchor = <NavigationLink to="#configured-missing-target">Missing</NavigationLink>;
const configuredInvalidCustomRole = <Widget role="custom-invalid" />;
const configuredAmbiguousAnchor = <a href="https://example.com/continue">continue</a>;
const configuredUnlabeledMappedControl = <ConfiguredControl />;
const configuredAnonymousContext = createContext(null);
const configuredAnonymousHoc = withRedux(() => <div />);
const configuredComposedDisplayName = memo(forwardRef((props, ref) => <div ref={ref} {...props} />));
const configuredForbiddenExactProp = <ConfiguredWidget className="blocked" />;
const configuredAllowedPatternProp = <AllowedWidget data-state="safe" />;
const configuredForbiddenPatternProp = <BlockedWidget data-state="blocked" />;
const configuredForbiddenMemberProp = <Library.Panel style={{ color: "red" }} />;
const ConfiguredIntrinsic = "article";
const configuredForbiddenDomProp = <div id="blocked" />;
const configuredAllowedDomTag = <div data-state="blocked" />;
const configuredForbiddenDomExpressionValue = <span data-state={"blocked"} />;
const configuredForbiddenDomTemplateValue = <span data-state={\`blocked\`} />;
const configuredForbiddenDomCustomMessage = <section className="blocked" />;
const configuredForbiddenAliasedDomProp = <ConfiguredIntrinsic id="blocked" />;
const configuredForbiddenElement = <button aria-label="Blocked" />;
const configuredForbiddenCustomElement = <ConfiguredModal />;
const configuredForbiddenMemberElement = <Library.Panel />;
const configuredForbiddenCreatedElement = React.createElement("button");
const configuredForbiddenCreatedComponent = createElement(ConfiguredModal);
const configuredForbiddenCreatedMember = React.createElement(Library.Panel);
const configuredUnnamedFormControl = <form><input aria-label="Email" /></form>;
const configuredAllowedInteractiveRole = <button role="article">Save</button>;
const configuredAllowedNoninteractiveRole = <h1 role="button">Open</h1>;
const configuredDeepJsx = <div><section><span><em /></span></section></div>;
const configuredCompetingDeepJsx = <div><section><span><em /></span><Widget render={() => <section><span><em /></span></section>} /></section></div>;
const configuredOversizedLongHeading = <h1 className="text-8xl">Build a better workflow for every team in your growing organization</h1>;
const configuredFlatPageTypeScale = <main><p className="text-sm">A</p><h2 className="text-base">B</h2><h1 className="text-lg">C</h1></main>;
const configuredSmallFormControlText = <><input className="text-sm" /><input className="hidden md:block text-xs" /></>;
const configuredUndersizedIconButton = <button className="size-4 p-0"><svg /></button>;
const configuredUngatedTailwindAnimation = <><span className="animate-spin" /><span className="motion-reduce:animate-spin motion-reduce:hidden" /></>;
const configuredScrollHero = document.querySelector(".hero"); document.addEventListener("scroll", () => { configuredScrollHero.style.transform = "translateY(10px)"; });
const configuredPreactTextInput = <input type="text" onChange={() => {}} />;
const ConfiguredWaapiPanel = () => { document.body.animate({ opacity: [0, 1] }, 200); return <div />; };
const configuredZodError = configuredZod.ZodError.create([]);
const configuredZodErrorCustomization = configuredZod.string("Required");
const configuredZodSchema = configuredZod.object({}).strict();
const configuredZodEmail = configuredZod.string().email();
const configuredCrampedContainerPadding = <div className="border p-1">Status</div>;
const configuredHoverOnlyReveal = <button className="opacity-0 hover:opacity-100">Edit</button>;
const configuredImportantNumberedSections = <main><section><span className="!text-xs font-mono" style={{ fontSize: 16 }}>01</span><h2>Principles</h2></section><section><span className="!text-xs font-mono" style={{ fontSize: 16 }}>02</span><h2>Process</h2></section></main>;
const configuredPrefixedWeightNumberedSections = <main><section><span style={{ fontSize: 12, fontWeight: "600suffix" }}>01</span><h2>Principles</h2></section><section><span style={{ fontSize: 12, fontWeight: "600suffix" }}>02</span><h2>Process</h2></section></main>;
const configuredFloatSpacingNumberedSections = <main><section><span style={{ fontSize: 12, letterSpacing: " +1e-1em" }}>01</span><h2>Principles</h2></section><section><span style={{ fontSize: 12, letterSpacing: " +1e-1em" }}>02</span><h2>Process</h2></section></main>;
`,
  );
  const routerGateFixture =
    'import { createBrowserRouter, Outlet, redirect as routeRedirect, redirectDocument as routeDocument, useNavigate, useOutlet as useChildOutlet } from "react-router-dom"; export function App() { const navigate = useNavigate(); navigate("/next"); createBrowserRouter([{ Component: () => <main />, children: [{ path: "child", element: <span /> }] }, { Component: () => <main>{useChildOutlet()}</main>, children: [{ path: "safe-hook", element: <span /> }] }, { Component: () => <Layout />, children: [{ path: "safe-component", element: <span /> }] }, { element: <main><Layout /></main>, children: [{ path: "safe-element", element: <span /> }] }, { Component: () => <main />, children: null }, { Component: () => { const Unused = () => <Outlet />; return <main />; }, children: [{ path: "nested-helper", element: <span /> }] }, { path: "lazy", lazy: async () => ({ ["path"]: "/changed", Component }) }, { path: "conditional-lazy", lazy: async () => { if (compact) return ({ id: "compact" } as const); const nested = () => ({ children: [] }); return { loader }; } }, { path: "safe-lazy", lazy: async () => ({ Component, loader }) }, { path: "loader-body", loader: async ({ request: routeRequest }) => routeRequest["json"]() }, { path: "safe-action-body", action: async ({ request }) => request.formData() }, { path: "swallowed-redirect", loader: async () => { try { throw routeRedirect("/login"); } catch (error) { return null; } } }, { path: "swallowed-document-redirect", clientLoader: async () => { try { (() => { throw routeDocument("/client"); })(); } catch (error) { return null; } } }, { path: "returned-redirect", action: async () => { try { return routeRedirect("/safe"); } catch (error) { return null; } } }, { path: "rethrown-redirect", clientAction: async () => { try { throw routeRedirect("/safe"); } catch (error) { throw error; } } }, { path: "helper", Component: () => { const helper = { lazy: async () => ({ path: "/ignored" }), loader: async ({ request }) => request.text() }; return <button onClick={helper.lazy} />; } }]); return null; }';
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
    'import { createBrowserRouter } from "react-router";\nimport ClientCard from "./card.client";\nimport NestedSuffixClientCard from "./card.client.clientx";\nimport OrdinaryCard from "./client-card";\nimport { ClientOnly } from "./client-only";\ncreateBrowserRouter([{ path: "/", loader: async ({ request }) => { await fetch("/missing"); await fetch("/direct", { signal: request.signal }); const signalAlias = request.signal; await fetch("/alias", { signal: signalAlias }); const { signal: destructuredSignal } = request; await fetch("/destructured", { signal: destructuredSignal }); await fetch(request); return fetch(new Request("/request", { signal: request.signal })); } }]);\nexport async function loader({ request }) { return request["text"](); }\nexport async function action({ request }) { return request.formData(); }\nexport default function DashboardRoute() { return <><ClientCard /><NestedSuffixClientCard /><OrdinaryCard /><ClientOnly>{() => <ClientCard />}</ClientOnly></>; }\n',
  );
  fs.writeFileSync(
    frameworkClientEntryFixturePath,
    'import ClientCard from "./card.client";\nexport const hydrate = () => <ClientCard />;\n',
  );
  fs.writeFileSync(
    frameworkServerEntryFixturePath,
    'import { captureException } from "@sentry/node";\nimport { createBrowserRouter } from "react-router";\ncreateBrowserRouter([{ handleError: (error, { request }) => { captureException(error); if (!request.signal.aborted) captureException(error); } }]);\n',
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
    "autocomplete-valid",
    "button-has-type",
    "checked-requires-onchange-or-readonly",
    "class-component-missing-component-will-unmount-teardown",
    "click-events-have-key-events",
    "control-has-associated-label",
    "display-name",
    "forbid-component-props",
    "forbid-dom-props",
    "forbid-elements",
    "form-control-requires-name",
    "hook-import-rename-loses-use-prefix",
    "heading-has-content",
    "jsx-boolean-value",
    "jsx-curly-brace-presence",
    "jsx-handler-names",
    "no-string-refs",
    "state-in-constructor",
    "aria-activedescendant-has-tabindex",
    "aria-role",
    "alt-text",
    "img-redundant-alt",
    "interactive-supports-focus",
    "label-has-associated-control",
    "mouse-events-have-key-events",
    "anchor-is-valid",
    "anchor-target-exists",
    "anchor-ambiguous-text",
    "no-interactive-element-to-noninteractive-role",
    "no-noninteractive-element-to-interactive-role",
    "jsx-max-depth",
    "no-unsafe",
    "no-oversized-long-heading",
    "no-flat-page-type-scale",
    "no-small-form-control-text",
    "no-undersized-icon-button",
    "no-ungated-tailwind-animation",
    "no-unthrottled-scroll-mutation",
    "preact-prefer-oninput",
    "waapi-animation-in-render",
    "zod-v4-no-deprecated-error-apis",
    "zod-v4-no-deprecated-error-customization",
    "zod-v4-no-deprecated-schema-apis",
    "zod-v4-prefer-top-level-string-formats",
    "no-cramped-container-padding",
    "no-hover-only-reveal",
    "no-numbered-section-markers",
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
  const jsxFilenameAsNeededSettings = {
    "react-doctor": {
      ...REACT_DOCTOR_SETTINGS["react-doctor"],
      jsxFilenameExtension: { allow: "as-needed", extensions: [".jsx"] },
    },
  };
  const jsxFilenameIgnoredSettings = {
    "react-doctor": {
      ...jsxFilenameAsNeededSettings["react-doctor"],
      jsxFilenameExtension: {
        ...jsxFilenameAsNeededSettings["react-doctor"].jsxFilenameExtension,
        ignoreFilesWithoutCode: true,
      },
    },
  };
  fs.writeFileSync(
    jsxFilenameAsNeededStockConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: false,
        settings: jsxFilenameAsNeededSettings,
        ruleIds: ["jsx-filename-extension"],
      }),
    ),
  );
  fs.writeFileSync(
    jsxFilenameAsNeededNativeConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: true,
        settings: jsxFilenameAsNeededSettings,
        ruleIds: ["jsx-filename-extension"],
      }),
    ),
  );
  fs.writeFileSync(
    jsxFilenameIgnoredStockConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: false,
        settings: jsxFilenameIgnoredSettings,
        ruleIds: ["jsx-filename-extension"],
      }),
    ),
  );
  fs.writeFileSync(
    jsxFilenameIgnoredNativeConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: true,
        settings: jsxFilenameIgnoredSettings,
        ruleIds: ["jsx-filename-extension"],
      }),
    ),
  );
  const routerRuleIds = [
    "react-router-no-navigate-in-render",
    "react-router-no-route-module-environment-suffix",
    "react-router-no-router-in-render",
    "react-router-v8-no-react-router-dom-import",
    "react-router-guard-aborted-handle-error",
    "react-router-loader-fetch-forwards-signal",
    "react-router-loader-parallel-fetch",
    "react-router-nested-route-requires-outlet",
    "react-router-no-client-module-in-server-render",
    "react-router-no-invalid-lazy-route-properties",
    "react-router-no-loader-request-body",
    "react-router-no-redirect-in-try-catch",
  ];
  const routerSettings = {
    "react-doctor": {
      ...REACT_DOCTOR_SETTINGS["react-doctor"],
      capabilities: [
        ...REACT_DOCTOR_SETTINGS["react-doctor"].capabilities,
        "react-router:7",
        "react-router-framework",
      ],
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
  const frameworkServerEntrySettings = {
    "react-doctor": {
      ...routerSettings["react-doctor"],
      rootDirectory: fs.realpathSync(frameworkRouterFixtureDirectory),
    },
  };
  fs.writeFileSync(
    frameworkServerEntryStockConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: false,
        settings: frameworkServerEntrySettings,
        ruleIds: ["react-router-guard-aborted-handle-error"],
      }),
    ),
  );
  fs.writeFileSync(
    frameworkServerEntryNativeConfigPath,
    JSON.stringify(
      buildConfig({
        isNative: true,
        settings: frameworkServerEntrySettings,
        ruleIds: ["react-router-guard-aborted-handle-error"],
      }),
    ),
  );
  const stockDiagnostics = runOxlint(stockConfigPath, process.env, fixtureDirectory).diagnostics;
  const nativeEnvironment = {
    ...process.env,
    NAPI_RS_NATIVE_LIBRARY_PATH: path.resolve(nativeBindingPath),
  };
  const jsxFilenameAsNeededStockDiagnostics = runOxlint(
    jsxFilenameAsNeededStockConfigPath,
    process.env,
    jsxFilenameAsNeededFixturePath,
  ).diagnostics;
  const jsxFilenameAsNeededNativeDiagnostics = runOxlint(
    jsxFilenameAsNeededNativeConfigPath,
    nativeEnvironment,
    jsxFilenameAsNeededFixturePath,
  ).diagnostics;
  const jsxFilenameIgnoredStockDiagnostics = runOxlint(
    jsxFilenameIgnoredStockConfigPath,
    process.env,
    jsxFilenameIgnoredFixturePath,
  ).diagnostics;
  const jsxFilenameIgnoredNativeDiagnostics = runOxlint(
    jsxFilenameIgnoredNativeConfigPath,
    nativeEnvironment,
    jsxFilenameIgnoredFixturePath,
  ).diagnostics;
  if (
    jsxFilenameAsNeededStockDiagnostics.length !== 1 ||
    JSON.stringify(jsxFilenameAsNeededNativeDiagnostics) !==
      JSON.stringify(jsxFilenameAsNeededStockDiagnostics) ||
    jsxFilenameIgnoredStockDiagnostics.length !== 0 ||
    jsxFilenameIgnoredNativeDiagnostics.length !== 0
  ) {
    throw new Error(
      `native JSX filename settings parity failed\nas-needed stock=${JSON.stringify(jsxFilenameAsNeededStockDiagnostics, null, 2)}\nas-needed native=${JSON.stringify(jsxFilenameAsNeededNativeDiagnostics, null, 2)}\nignored stock=${JSON.stringify(jsxFilenameIgnoredStockDiagnostics, null, 2)}\nignored native=${JSON.stringify(jsxFilenameIgnoredNativeDiagnostics, null, 2)}`,
    );
  }
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
    const stockOnlyDiagnostics = stockDiagnostics.filter(
      (diagnostic) => !nativeDiagnosticKeys.has(JSON.stringify(diagnostic)),
    );
    const nativeOnlyDiagnostics = nativeDiagnostics.filter(
      (diagnostic) => !stockDiagnosticKeys.has(JSON.stringify(diagnostic)),
    );
    throw new Error(
      `native parity failed\nstock count=${stockDiagnostics.length}\nnative count=${nativeDiagnostics.length}\nstock only=${JSON.stringify(stockOnlyDiagnostics, null, 2)}\nnative only=${JSON.stringify(nativeOnlyDiagnostics, null, 2)}`,
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
    "react-in-jsx-scope": 25,
    "no-small-form-control-text": 1,
    "hook-use-state": 2,
    "r3f-no-ignored-linewidth": 1,
    "r3f-no-shadows-on-unsupported-light": 1,
    "r3f-no-ignored-basic-material-properties": 1,
    "r3f-valid-material-opacity": 1,
    "r3f-valid-pbr-material-properties": 1,
    "r3f-valid-physical-material-properties": 1,
    "r3f-require-transparent-for-opacity": 1,
    "r3f-valid-buffer-attribute-item-size": 1,
    "r3f-valid-buffer-attribute-array-length": 1,
    "r3f-valid-shadow-map-size": 1,
    "r3f-valid-raycaster-range": 1,
    "r3f-valid-fog-parameters": 1,
    "r3f-valid-spot-light-properties": 1,
    "r3f-valid-perspective-camera": 1,
    "r3f-valid-orthographic-camera": 1,
    "r3f-no-use-frame-dependency-array": 1,
    "r3f-no-normalized-float-buffer-attribute": 1,
    "r3f-webgpu-canvas-prop-compatibility": 1,
    "r3f-limit-shadowed-point-lights": 1,
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
    "jsx-curly-brace-presence": 62,
    "jsx-handler-names": 6,
    "no-string-refs": 1,
    "state-in-constructor": 3,
    "aria-role": 1,
    "alt-text": 1,
    "img-redundant-alt": 1,
    "interactive-supports-focus": 1,
    "label-has-associated-control": 1,
    "mouse-events-have-key-events": 2,
    "anchor-is-valid": 1,
    "anchor-target-exists": 1,
    "anchor-ambiguous-text": 1,
    "control-has-associated-label": 5,
    "display-name": 2,
    "forbid-component-props": 3,
    "forbid-dom-props": 5,
    "forbid-elements": 10,
    "form-control-requires-name": 1,
    "hook-import-rename-loses-use-prefix": 1,
    "jsx-max-depth": 2,
    "no-unsafe": 1,
    "no-oversized-long-heading": 1,
    "no-flat-page-type-scale": 1,
    "no-small-form-control-text": 1,
    "no-undersized-icon-button": 1,
    "no-ungated-tailwind-animation": 1,
    "no-unthrottled-scroll-mutation": 1,
    "preact-prefer-oninput": 1,
    "waapi-animation-in-render": 1,
    "zod-v4-no-deprecated-error-apis": 1,
    "zod-v4-no-deprecated-error-customization": 1,
    "zod-v4-no-deprecated-schema-apis": 1,
    "zod-v4-prefer-top-level-string-formats": 1,
    "no-cramped-container-padding": 1,
    "no-hover-only-reveal": 1,
    "no-numbered-section-markers": 3,
  };
  if (
    JSON.stringify(countDiagnosticsByRule(configuredStockDiagnostics)) !==
      JSON.stringify(expectedConfiguredDiagnosticCounts) ||
    JSON.stringify(configuredNativeDiagnostics) !== JSON.stringify(configuredStockDiagnostics)
  ) {
    const configuredNativeDiagnosticKeys = new Set(configuredNativeDiagnostics.map(JSON.stringify));
    const configuredStockDiagnosticKeys = new Set(configuredStockDiagnostics.map(JSON.stringify));
    const configuredStockOnlyDiagnostic = configuredStockDiagnostics.find(
      (diagnostic) => !configuredNativeDiagnosticKeys.has(JSON.stringify(diagnostic)),
    );
    const configuredNativeOnlyDiagnostic = configuredNativeDiagnostics.find(
      (diagnostic) => !configuredStockDiagnosticKeys.has(JSON.stringify(diagnostic)),
    );
    throw new Error(
      `native configured parity failed\nexpected counts=${JSON.stringify(expectedConfiguredDiagnosticCounts, null, 2)}\nstock counts=${JSON.stringify(countDiagnosticsByRule(configuredStockDiagnostics), null, 2)}\nstock only=${JSON.stringify(configuredStockOnlyDiagnostic, null, 2)}\nnative only=${JSON.stringify(configuredNativeOnlyDiagnostic, null, 2)}`,
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
    activeRouterStockDiagnostics.length !== 9 ||
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
  const stableFrameworkEnvironmentRouteStockDiagnostics =
    frameworkEnvironmentRouteStockDiagnostics.filter(
      (diagnostic) => !diagnostic.code.includes("(react-router-no-loader-request-body)"),
    );
  const platformSpecificFrameworkEnvironmentRouteStockDiagnostics =
    frameworkEnvironmentRouteStockDiagnostics.filter((diagnostic) =>
      diagnostic.code.includes("(react-router-no-loader-request-body)"),
    );
  if (
    stableFrameworkEnvironmentRouteStockDiagnostics.length !== 5 ||
    platformSpecificFrameworkEnvironmentRouteStockDiagnostics.length > 1 ||
    JSON.stringify(frameworkEnvironmentRouteNativeDiagnostics) !==
      JSON.stringify(frameworkEnvironmentRouteStockDiagnostics)
  ) {
    throw new Error(
      `native React Router framework route module parity failed\nstock=${JSON.stringify(frameworkEnvironmentRouteStockDiagnostics, null, 2)}\nnative=${JSON.stringify(frameworkEnvironmentRouteNativeDiagnostics, null, 2)}`,
    );
  }
  const frameworkClientEntryStockDiagnostics = runOxlint(
    routerStockConfigPath,
    process.env,
    frameworkClientEntryFixturePath,
  ).diagnostics;
  const frameworkClientEntryNativeDiagnostics = runOxlint(
    routerNativeConfigPath,
    nativeEnvironment,
    frameworkClientEntryFixturePath,
  ).diagnostics;
  if (
    frameworkClientEntryStockDiagnostics.length !== 0 ||
    JSON.stringify(frameworkClientEntryNativeDiagnostics) !==
      JSON.stringify(frameworkClientEntryStockDiagnostics)
  ) {
    throw new Error(
      `native React Router framework client entry parity failed\nstock=${JSON.stringify(frameworkClientEntryStockDiagnostics, null, 2)}\nnative=${JSON.stringify(frameworkClientEntryNativeDiagnostics, null, 2)}`,
    );
  }
  const frameworkServerEntryStockDiagnostics = runOxlint(
    frameworkServerEntryStockConfigPath,
    process.env,
    frameworkServerEntryFixturePath,
  ).diagnostics;
  const frameworkServerEntryNativeDiagnostics = runOxlint(
    frameworkServerEntryNativeConfigPath,
    nativeEnvironment,
    frameworkServerEntryFixturePath,
  ).diagnostics;
  if (
    frameworkServerEntryStockDiagnostics.length !== 1 ||
    JSON.stringify(frameworkServerEntryNativeDiagnostics) !==
      JSON.stringify(frameworkServerEntryStockDiagnostics)
  ) {
    throw new Error(
      `native React Router framework server entry parity failed\nstock=${JSON.stringify(frameworkServerEntryStockDiagnostics, null, 2)}\nnative=${JSON.stringify(frameworkServerEntryNativeDiagnostics, null, 2)}`,
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
