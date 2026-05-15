// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.
// Source of truth: every `export const <name> = defineRule({ id: "...", ... })`
// under `src/plugin/rules/<bucket>/<name>.ts`. The rule's `framework` and
// default `category` come from the bucket directory (see
// `scripts/generate-rule-registry.mjs`) — rule files only override
// `category` when needed. Adding a rule is a single-file operation:
// create the rule file, set its `id`, re-run codegen.

import type { Rule } from "./utils/rule.js";

import { advancedEventHandlerRefs } from "./rules/state-and-effects/advanced-event-handler-refs.js";
import { asyncAwaitInLoop } from "./rules/js-performance/async-await-in-loop.js";
import { asyncDeferAwait } from "./rules/performance/async-defer-await.js";
import { asyncParallel } from "./rules/js-performance/async-parallel.js";
import { clientLocalstorageNoVersion } from "./rules/client/client-localstorage-no-version.js";
import { clientPassiveEventListeners } from "./rules/client/client-passive-event-listeners.js";
import { noBoldHeading } from "./rules/react-ui/no-bold-heading.js";
import { noDefaultTailwindPalette } from "./rules/react-ui/no-default-tailwind-palette.js";
import { noRedundantPaddingAxes } from "./rules/react-ui/no-redundant-padding-axes.js";
import { noRedundantSizeAxes } from "./rules/react-ui/no-redundant-size-axes.js";
import { noSpaceOnFlexChildren } from "./rules/react-ui/no-space-on-flex-children.js";
import { noThreePeriodEllipsis } from "./rules/react-ui/no-three-period-ellipsis.js";
import { noVagueButtonLabel } from "./rules/react-ui/no-vague-button-label.js";
import { effectNeedsCleanup } from "./rules/state-and-effects/effect-needs-cleanup.js";
import { jsBatchDomCss } from "./rules/js-performance/js-batch-dom-css.js";
import { jsCachePropertyAccess } from "./rules/js-performance/js-cache-property-access.js";
import { jsCacheStorage } from "./rules/js-performance/js-cache-storage.js";
import { jsCombineIterations } from "./rules/js-performance/js-combine-iterations.js";
import { jsEarlyExit } from "./rules/js-performance/js-early-exit.js";
import { jsFlatmapFilter } from "./rules/js-performance/js-flatmap-filter.js";
import { jsHoistIntl } from "./rules/js-performance/js-hoist-intl.js";
import { jsHoistRegexp } from "./rules/js-performance/js-hoist-regexp.js";
import { jsIndexMaps } from "./rules/js-performance/js-index-maps.js";
import { jsLengthCheckFirst } from "./rules/js-performance/js-length-check-first.js";
import { jsMinMaxLoop } from "./rules/js-performance/js-min-max-loop.js";
import { jsSetMapLookups } from "./rules/js-performance/js-set-map-lookups.js";
import { jsTosortedImmutable } from "./rules/js-performance/js-tosorted-immutable.js";
import { nextjsAsyncClientComponent } from "./rules/nextjs/nextjs-async-client-component.js";
import { nextjsImageMissingSizes } from "./rules/nextjs/nextjs-image-missing-sizes.js";
import { nextjsInlineScriptMissingId } from "./rules/nextjs/nextjs-inline-script-missing-id.js";
import { nextjsMissingMetadata } from "./rules/nextjs/nextjs-missing-metadata.js";
import { nextjsNoAElement } from "./rules/nextjs/nextjs-no-a-element.js";
import { nextjsNoClientFetchForServerData } from "./rules/nextjs/nextjs-no-client-fetch-for-server-data.js";
import { nextjsNoClientSideRedirect } from "./rules/nextjs/nextjs-no-client-side-redirect.js";
import { nextjsNoCssLink } from "./rules/nextjs/nextjs-no-css-link.js";
import { nextjsNoFontLink } from "./rules/nextjs/nextjs-no-font-link.js";
import { nextjsNoHeadImport } from "./rules/nextjs/nextjs-no-head-import.js";
import { nextjsNoImgElement } from "./rules/nextjs/nextjs-no-img-element.js";
import { nextjsNoNativeScript } from "./rules/nextjs/nextjs-no-native-script.js";
import { nextjsNoPolyfillScript } from "./rules/nextjs/nextjs-no-polyfill-script.js";
import { nextjsNoRedirectInTryCatch } from "./rules/nextjs/nextjs-no-redirect-in-try-catch.js";
import { nextjsNoSideEffectInGetHandler } from "./rules/nextjs/nextjs-no-side-effect-in-get-handler.js";
import { nextjsNoUseSearchParamsWithoutSuspense } from "./rules/nextjs/nextjs-no-use-search-params-without-suspense.js";
import { noArrayIndexAsKey } from "./rules/correctness/no-array-index-as-key.js";
import { noBarrelImport } from "./rules/bundle-size/no-barrel-import.js";
import { noCascadingSetState } from "./rules/state-and-effects/no-cascading-set-state.js";
import { noDarkModeGlow } from "./rules/design/no-dark-mode-glow.js";
import { noDefaultProps } from "./rules/architecture/no-default-props.js";
import { noDerivedStateEffect } from "./rules/state-and-effects/no-derived-state-effect.js";
import { noDerivedUseState } from "./rules/state-and-effects/no-derived-use-state.js";
import { noDirectStateMutation } from "./rules/state-and-effects/no-direct-state-mutation.js";
import { noDisabledZoom } from "./rules/design/no-disabled-zoom.js";
import { noDocumentStartViewTransition } from "./rules/view-transitions/no-document-start-view-transition.js";
import { noDynamicImportPath } from "./rules/bundle-size/no-dynamic-import-path.js";
import { noEffectChain } from "./rules/state-and-effects/no-effect-chain.js";
import { noEffectEventHandler } from "./rules/state-and-effects/no-effect-event-handler.js";
import { noEffectEventInDeps } from "./rules/state-and-effects/no-effect-event-in-deps.js";
import { noEval } from "./rules/security/no-eval.js";
import { noEventTriggerState } from "./rules/state-and-effects/no-event-trigger-state.js";
import { noFetchInEffect } from "./rules/state-and-effects/no-fetch-in-effect.js";
import { noFlushSync } from "./rules/view-transitions/no-flush-sync.js";
import { noFullLodashImport } from "./rules/bundle-size/no-full-lodash-import.js";
import { noGenericHandlerNames } from "./rules/architecture/no-generic-handler-names.js";
import { noGiantComponent } from "./rules/architecture/no-giant-component.js";
import { noGlobalCssVariableAnimation } from "./rules/performance/no-global-css-variable-animation.js";
import { noGradientText } from "./rules/design/no-gradient-text.js";
import { noGrayOnColoredBackground } from "./rules/design/no-gray-on-colored-background.js";
import { noInlineBounceEasing } from "./rules/design/no-inline-bounce-easing.js";
import { noInlineExhaustiveStyle } from "./rules/design/no-inline-exhaustive-style.js";
import { noInlinePropOnMemoComponent } from "./rules/performance/no-inline-prop-on-memo-component.js";
import { noJustifiedText } from "./rules/design/no-justified-text.js";
import { noLargeAnimatedBlur } from "./rules/performance/no-large-animated-blur.js";
import { noLayoutPropertyAnimation } from "./rules/performance/no-layout-property-animation.js";
import { noLayoutTransitionInline } from "./rules/design/no-layout-transition-inline.js";
import { noLegacyClassLifecycles } from "./rules/architecture/no-legacy-class-lifecycles.js";
import { noLegacyContextApi } from "./rules/architecture/no-legacy-context-api.js";
import { noLongTransitionDuration } from "./rules/design/no-long-transition-duration.js";
import { noManyBooleanProps } from "./rules/architecture/no-many-boolean-props.js";
import { noMirrorPropEffect } from "./rules/state-and-effects/no-mirror-prop-effect.js";
import { noMoment } from "./rules/bundle-size/no-moment.js";
import { noMutableInDeps } from "./rules/state-and-effects/no-mutable-in-deps.js";
import { noNestedComponentDefinition } from "./rules/architecture/no-nested-component-definition.js";
import { noOutlineNone } from "./rules/design/no-outline-none.js";
import { noPermanentWillChange } from "./rules/performance/no-permanent-will-change.js";
import { noPolymorphicChildren } from "./rules/correctness/no-polymorphic-children.js";
import { noPreventDefault } from "./rules/correctness/no-prevent-default.js";
import { noPropCallbackInEffect } from "./rules/state-and-effects/no-prop-callback-in-effect.js";
import { noPureBlackBackground } from "./rules/design/no-pure-black-background.js";
import { noReactDomDeprecatedApis } from "./rules/architecture/no-react-dom-deprecated-apis.js";
import { noReact19DeprecatedApis } from "./rules/architecture/no-react19-deprecated-apis.js";
import { noRenderInRender } from "./rules/architecture/no-render-in-render.js";
import { noRenderPropChildren } from "./rules/architecture/no-render-prop-children.js";
import { noScaleFromZero } from "./rules/performance/no-scale-from-zero.js";
import { noSecretsInClientCode } from "./rules/security/no-secrets-in-client-code.js";
import { noSetStateInRender } from "./rules/state-and-effects/no-set-state-in-render.js";
import { noSideTabBorder } from "./rules/design/no-side-tab-border.js";
import { noTinyText } from "./rules/design/no-tiny-text.js";
import { noTransitionAll } from "./rules/performance/no-transition-all.js";
import { noUncontrolledInput } from "./rules/correctness/no-uncontrolled-input.js";
import { noUndeferredThirdParty } from "./rules/bundle-size/no-undeferred-third-party.js";
import { noUsememoSimpleExpression } from "./rules/performance/no-usememo-simple-expression.js";
import { noWideLetterSpacing } from "./rules/design/no-wide-letter-spacing.js";
import { noZIndex9999 } from "./rules/design/no-z-index9999.js";
import { preferDynamicImport } from "./rules/bundle-size/prefer-dynamic-import.js";
import { preferUseEffectEvent } from "./rules/state-and-effects/prefer-use-effect-event.js";
import { preferUseSyncExternalStore } from "./rules/state-and-effects/prefer-use-sync-external-store.js";
import { preferUseReducer } from "./rules/state-and-effects/prefer-use-reducer.js";
import { queryMutationMissingInvalidation } from "./rules/tanstack-query/query-mutation-missing-invalidation.js";
import { queryNoQueryInEffect } from "./rules/tanstack-query/query-no-query-in-effect.js";
import { queryNoRestDestructuring } from "./rules/tanstack-query/query-no-rest-destructuring.js";
import { queryNoUseQueryForMutation } from "./rules/tanstack-query/query-no-use-query-for-mutation.js";
import { queryNoVoidQueryFn } from "./rules/tanstack-query/query-no-void-query-fn.js";
import { queryStableQueryClient } from "./rules/tanstack-query/query-stable-query-client.js";
import { reactCompilerDestructureMethod } from "./rules/architecture/react-compiler-destructure-method.js";
import { renderingAnimateSvgWrapper } from "./rules/performance/rendering-animate-svg-wrapper.js";
import { renderingConditionalRender } from "./rules/correctness/rendering-conditional-render.js";
import { renderingHoistJsx } from "./rules/performance/rendering-hoist-jsx.js";
import { renderingHydrationMismatchTime } from "./rules/performance/rendering-hydration-mismatch-time.js";
import { renderingHydrationNoFlicker } from "./rules/performance/rendering-hydration-no-flicker.js";
import { renderingScriptDeferAsync } from "./rules/performance/rendering-script-defer-async.js";
import { renderingSvgPrecision } from "./rules/correctness/rendering-svg-precision.js";
import { renderingUsetransitionLoading } from "./rules/performance/rendering-usetransition-loading.js";
import { rerenderDeferReadsHook } from "./rules/state-and-effects/rerender-defer-reads-hook.js";
import { rerenderDependencies } from "./rules/state-and-effects/rerender-dependencies.js";
import { rerenderDerivedStateFromHook } from "./rules/performance/rerender-derived-state-from-hook.js";
import { rerenderFunctionalSetstate } from "./rules/state-and-effects/rerender-functional-setstate.js";
import { rerenderLazyStateInit } from "./rules/state-and-effects/rerender-lazy-state-init.js";
import { rerenderMemoBeforeEarlyReturn } from "./rules/performance/rerender-memo-before-early-return.js";
import { rerenderMemoWithDefaultValue } from "./rules/performance/rerender-memo-with-default-value.js";
import { rerenderStateOnlyInHandlers } from "./rules/state-and-effects/rerender-state-only-in-handlers.js";
import { rerenderTransitionsScroll } from "./rules/performance/rerender-transitions-scroll.js";
import { rnAnimateLayoutProperty } from "./rules/react-native/rn-animate-layout-property.js";
import { rnAnimationReactionAsDerived } from "./rules/react-native/rn-animation-reaction-as-derived.js";
import { rnBottomSheetPreferNative } from "./rules/react-native/rn-bottom-sheet-prefer-native.js";
import { rnListCallbackPerRow } from "./rules/react-native/rn-list-callback-per-row.js";
import { rnListDataMapped } from "./rules/react-native/rn-list-data-mapped.js";
import { rnListRecyclableWithoutTypes } from "./rules/react-native/rn-list-recyclable-without-types.js";
import { rnNoDeprecatedModules } from "./rules/react-native/rn-no-deprecated-modules.js";
import { rnNoDimensionsGet } from "./rules/react-native/rn-no-dimensions-get.js";
import { rnNoInlineFlatlistRenderitem } from "./rules/react-native/rn-no-inline-flatlist-renderitem.js";
import { rnNoInlineObjectInListItem } from "./rules/react-native/rn-no-inline-object-in-list-item.js";
import { rnNoLegacyExpoPackages } from "./rules/react-native/rn-no-legacy-expo-packages.js";
import { rnNoLegacyShadowStyles } from "./rules/react-native/rn-no-legacy-shadow-styles.js";
import { rnNoNonNativeNavigator } from "./rules/react-native/rn-no-non-native-navigator.js";
import { rnNoRawText } from "./rules/react-native/rn-no-raw-text.js";
import { rnNoScrollState } from "./rules/react-native/rn-no-scroll-state.js";
import { rnNoScrollviewMappedList } from "./rules/react-native/rn-no-scrollview-mapped-list.js";
import { rnNoSingleElementStyleArray } from "./rules/react-native/rn-no-single-element-style-array.js";
import { rnPreferContentInsetAdjustment } from "./rules/react-native/rn-prefer-content-inset-adjustment.js";
import { rnPreferExpoImage } from "./rules/react-native/rn-prefer-expo-image.js";
import { rnPreferPressable } from "./rules/react-native/rn-prefer-pressable.js";
import { rnPreferReanimated } from "./rules/react-native/rn-prefer-reanimated.js";
import { rnPressableSharedValueMutation } from "./rules/react-native/rn-pressable-shared-value-mutation.js";
import { rnScrollviewDynamicPadding } from "./rules/react-native/rn-scrollview-dynamic-padding.js";
import { rnStylePreferBoxShadow } from "./rules/react-native/rn-style-prefer-box-shadow.js";
import { serverAfterNonblocking } from "./rules/server/server-after-nonblocking.js";
import { serverAuthActions } from "./rules/server/server-auth-actions.js";
import { serverCacheWithObjectLiteral } from "./rules/server/server-cache-with-object-literal.js";
import { serverDedupProps } from "./rules/server/server-dedup-props.js";
import { serverFetchWithoutRevalidate } from "./rules/server/server-fetch-without-revalidate.js";
import { serverHoistStaticIo } from "./rules/server/server-hoist-static-io.js";
import { serverNoMutableModuleState } from "./rules/server/server-no-mutable-module-state.js";
import { serverSequentialIndependentAwait } from "./rules/server/server-sequential-independent-await.js";
import { tanstackStartGetMutation } from "./rules/tanstack-start/tanstack-start-get-mutation.js";
import { tanstackStartLoaderParallelFetch } from "./rules/tanstack-start/tanstack-start-loader-parallel-fetch.js";
import { tanstackStartMissingHeadContent } from "./rules/tanstack-start/tanstack-start-missing-head-content.js";
import { tanstackStartNoAnchorElement } from "./rules/tanstack-start/tanstack-start-no-anchor-element.js";
import { tanstackStartNoDirectFetchInLoader } from "./rules/tanstack-start/tanstack-start-no-direct-fetch-in-loader.js";
import { tanstackStartNoDynamicServerFnImport } from "./rules/tanstack-start/tanstack-start-no-dynamic-server-fn-import.js";
import { tanstackStartNoNavigateInRender } from "./rules/tanstack-start/tanstack-start-no-navigate-in-render.js";
import { tanstackStartNoSecretsInLoader } from "./rules/tanstack-start/tanstack-start-no-secrets-in-loader.js";
import { tanstackStartNoUseServerInHandler } from "./rules/tanstack-start/tanstack-start-no-use-server-in-handler.js";
import { tanstackStartNoUseEffectFetch } from "./rules/tanstack-start/tanstack-start-no-use-effect-fetch.js";
import { tanstackStartRedirectInTryCatch } from "./rules/tanstack-start/tanstack-start-redirect-in-try-catch.js";
import { tanstackStartRoutePropertyOrder } from "./rules/tanstack-start/tanstack-start-route-property-order.js";
import { tanstackStartServerFnMethodOrder } from "./rules/tanstack-start/tanstack-start-server-fn-method-order.js";
import { tanstackStartServerFnValidateInput } from "./rules/tanstack-start/tanstack-start-server-fn-validate-input.js";
import { useLazyMotion } from "./rules/bundle-size/use-lazy-motion.js";

export const ruleRegistry: Record<string, Rule> = {
  "advanced-event-handler-refs": {
    ...advancedEventHandlerRefs,
    framework: "global",
    category: "Performance",
  },
  "async-await-in-loop": {
    ...asyncAwaitInLoop,
    framework: "global",
    category: "Performance",
  },
  "async-defer-await": {
    ...asyncDeferAwait,
    framework: "global",
    category: "Performance",
  },
  "async-parallel": {
    ...asyncParallel,
    framework: "global",
    category: "Performance",
  },
  "client-localstorage-no-version": {
    ...clientLocalstorageNoVersion,
    framework: "global",
    category: "Correctness",
  },
  "client-passive-event-listeners": {
    ...clientPassiveEventListeners,
    framework: "global",
    category: "Performance",
  },
  "design-no-bold-heading": {
    ...noBoldHeading,
    framework: "global",
    category: "Architecture",
  },
  "design-no-default-tailwind-palette": {
    ...noDefaultTailwindPalette,
    framework: "global",
    category: "Architecture",
  },
  "design-no-redundant-padding-axes": {
    ...noRedundantPaddingAxes,
    framework: "global",
    category: "Architecture",
  },
  "design-no-redundant-size-axes": {
    ...noRedundantSizeAxes,
    framework: "global",
    category: "Architecture",
  },
  "design-no-space-on-flex-children": {
    ...noSpaceOnFlexChildren,
    framework: "global",
    category: "Architecture",
  },
  "design-no-three-period-ellipsis": {
    ...noThreePeriodEllipsis,
    framework: "global",
    category: "Architecture",
  },
  "design-no-vague-button-label": {
    ...noVagueButtonLabel,
    framework: "global",
    category: "Accessibility",
  },
  "effect-needs-cleanup": {
    ...effectNeedsCleanup,
    framework: "global",
    category: "State & Effects",
  },
  "js-batch-dom-css": {
    ...jsBatchDomCss,
    framework: "global",
    category: "Performance",
  },
  "js-cache-property-access": {
    ...jsCachePropertyAccess,
    framework: "global",
    category: "Performance",
  },
  "js-cache-storage": {
    ...jsCacheStorage,
    framework: "global",
    category: "Performance",
  },
  "js-combine-iterations": {
    ...jsCombineIterations,
    framework: "global",
    category: "Performance",
  },
  "js-early-exit": {
    ...jsEarlyExit,
    framework: "global",
    category: "Performance",
  },
  "js-flatmap-filter": {
    ...jsFlatmapFilter,
    framework: "global",
    category: "Performance",
  },
  "js-hoist-intl": {
    ...jsHoistIntl,
    framework: "global",
    category: "Performance",
  },
  "js-hoist-regexp": {
    ...jsHoistRegexp,
    framework: "global",
    category: "Performance",
  },
  "js-index-maps": {
    ...jsIndexMaps,
    framework: "global",
    category: "Performance",
  },
  "js-length-check-first": {
    ...jsLengthCheckFirst,
    framework: "global",
    category: "Performance",
  },
  "js-min-max-loop": {
    ...jsMinMaxLoop,
    framework: "global",
    category: "Performance",
  },
  "js-set-map-lookups": {
    ...jsSetMapLookups,
    framework: "global",
    category: "Performance",
  },
  "js-tosorted-immutable": {
    ...jsTosortedImmutable,
    framework: "global",
    category: "Performance",
  },
  "nextjs-async-client-component": {
    ...nextjsAsyncClientComponent,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-image-missing-sizes": {
    ...nextjsImageMissingSizes,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-inline-script-missing-id": {
    ...nextjsInlineScriptMissingId,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-missing-metadata": {
    ...nextjsMissingMetadata,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-a-element": {
    ...nextjsNoAElement,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-client-fetch-for-server-data": {
    ...nextjsNoClientFetchForServerData,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-client-side-redirect": {
    ...nextjsNoClientSideRedirect,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-css-link": {
    ...nextjsNoCssLink,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-font-link": {
    ...nextjsNoFontLink,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-head-import": {
    ...nextjsNoHeadImport,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-img-element": {
    ...nextjsNoImgElement,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-native-script": {
    ...nextjsNoNativeScript,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-polyfill-script": {
    ...nextjsNoPolyfillScript,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-redirect-in-try-catch": {
    ...nextjsNoRedirectInTryCatch,
    framework: "nextjs",
    category: "Next.js",
  },
  "nextjs-no-side-effect-in-get-handler": {
    ...nextjsNoSideEffectInGetHandler,
    framework: "nextjs",
    category: "Security",
  },
  "nextjs-no-use-search-params-without-suspense": {
    ...nextjsNoUseSearchParamsWithoutSuspense,
    framework: "nextjs",
    category: "Next.js",
  },
  "no-array-index-as-key": {
    ...noArrayIndexAsKey,
    framework: "global",
    category: "Correctness",
  },
  "no-barrel-import": {
    ...noBarrelImport,
    framework: "global",
    category: "Bundle Size",
  },
  "no-cascading-set-state": {
    ...noCascadingSetState,
    framework: "global",
    category: "State & Effects",
  },
  "no-dark-mode-glow": {
    ...noDarkModeGlow,
    framework: "global",
    category: "Architecture",
  },
  "no-default-props": {
    ...noDefaultProps,
    framework: "global",
    category: "Architecture",
  },
  "no-derived-state-effect": {
    ...noDerivedStateEffect,
    framework: "global",
    category: "State & Effects",
  },
  "no-derived-useState": {
    ...noDerivedUseState,
    framework: "global",
    category: "State & Effects",
  },
  "no-direct-state-mutation": {
    ...noDirectStateMutation,
    framework: "global",
    category: "State & Effects",
  },
  "no-disabled-zoom": {
    ...noDisabledZoom,
    framework: "global",
    category: "Accessibility",
  },
  "no-document-start-view-transition": {
    ...noDocumentStartViewTransition,
    framework: "global",
    category: "Correctness",
  },
  "no-dynamic-import-path": {
    ...noDynamicImportPath,
    framework: "global",
    category: "Bundle Size",
  },
  "no-effect-chain": {
    ...noEffectChain,
    framework: "global",
    category: "State & Effects",
  },
  "no-effect-event-handler": {
    ...noEffectEventHandler,
    framework: "global",
    category: "State & Effects",
  },
  "no-effect-event-in-deps": {
    ...noEffectEventInDeps,
    framework: "global",
    category: "State & Effects",
  },
  "no-eval": {
    ...noEval,
    framework: "global",
    category: "Security",
  },
  "no-event-trigger-state": {
    ...noEventTriggerState,
    framework: "global",
    category: "State & Effects",
  },
  "no-fetch-in-effect": {
    ...noFetchInEffect,
    framework: "global",
    category: "State & Effects",
  },
  "no-flush-sync": {
    ...noFlushSync,
    framework: "global",
    category: "Performance",
  },
  "no-full-lodash-import": {
    ...noFullLodashImport,
    framework: "global",
    category: "Bundle Size",
  },
  "no-generic-handler-names": {
    ...noGenericHandlerNames,
    framework: "global",
    category: "Architecture",
  },
  "no-giant-component": {
    ...noGiantComponent,
    framework: "global",
    category: "Architecture",
  },
  "no-global-css-variable-animation": {
    ...noGlobalCssVariableAnimation,
    framework: "global",
    category: "Performance",
  },
  "no-gradient-text": {
    ...noGradientText,
    framework: "global",
    category: "Architecture",
  },
  "no-gray-on-colored-background": {
    ...noGrayOnColoredBackground,
    framework: "global",
    category: "Accessibility",
  },
  "no-inline-bounce-easing": {
    ...noInlineBounceEasing,
    framework: "global",
    category: "Performance",
  },
  "no-inline-exhaustive-style": {
    ...noInlineExhaustiveStyle,
    framework: "global",
    category: "Architecture",
  },
  "no-inline-prop-on-memo-component": {
    ...noInlinePropOnMemoComponent,
    framework: "global",
    category: "Performance",
  },
  "no-justified-text": {
    ...noJustifiedText,
    framework: "global",
    category: "Accessibility",
  },
  "no-large-animated-blur": {
    ...noLargeAnimatedBlur,
    framework: "global",
    category: "Performance",
  },
  "no-layout-property-animation": {
    ...noLayoutPropertyAnimation,
    framework: "global",
    category: "Performance",
  },
  "no-layout-transition-inline": {
    ...noLayoutTransitionInline,
    framework: "global",
    category: "Performance",
  },
  "no-legacy-class-lifecycles": {
    ...noLegacyClassLifecycles,
    framework: "global",
    category: "Correctness",
  },
  "no-legacy-context-api": {
    ...noLegacyContextApi,
    framework: "global",
    category: "Correctness",
  },
  "no-long-transition-duration": {
    ...noLongTransitionDuration,
    framework: "global",
    category: "Performance",
  },
  "no-many-boolean-props": {
    ...noManyBooleanProps,
    framework: "global",
    category: "Architecture",
  },
  "no-mirror-prop-effect": {
    ...noMirrorPropEffect,
    framework: "global",
    category: "State & Effects",
  },
  "no-moment": {
    ...noMoment,
    framework: "global",
    category: "Bundle Size",
  },
  "no-mutable-in-deps": {
    ...noMutableInDeps,
    framework: "global",
    category: "State & Effects",
  },
  "no-nested-component-definition": {
    ...noNestedComponentDefinition,
    framework: "global",
    category: "Correctness",
  },
  "no-outline-none": {
    ...noOutlineNone,
    framework: "global",
    category: "Accessibility",
  },
  "no-permanent-will-change": {
    ...noPermanentWillChange,
    framework: "global",
    category: "Performance",
  },
  "no-polymorphic-children": {
    ...noPolymorphicChildren,
    framework: "global",
    category: "Architecture",
  },
  "no-prevent-default": {
    ...noPreventDefault,
    framework: "global",
    category: "Correctness",
  },
  "no-prop-callback-in-effect": {
    ...noPropCallbackInEffect,
    framework: "global",
    category: "State & Effects",
  },
  "no-pure-black-background": {
    ...noPureBlackBackground,
    framework: "global",
    category: "Architecture",
  },
  "no-react-dom-deprecated-apis": {
    ...noReactDomDeprecatedApis,
    framework: "global",
    category: "Architecture",
  },
  "no-react19-deprecated-apis": {
    ...noReact19DeprecatedApis,
    framework: "global",
    category: "Architecture",
  },
  "no-render-in-render": {
    ...noRenderInRender,
    framework: "global",
    category: "Architecture",
  },
  "no-render-prop-children": {
    ...noRenderPropChildren,
    framework: "global",
    category: "Architecture",
  },
  "no-scale-from-zero": {
    ...noScaleFromZero,
    framework: "global",
    category: "Performance",
  },
  "no-secrets-in-client-code": {
    ...noSecretsInClientCode,
    framework: "global",
    category: "Security",
  },
  "no-set-state-in-render": {
    ...noSetStateInRender,
    framework: "global",
    category: "State & Effects",
  },
  "no-side-tab-border": {
    ...noSideTabBorder,
    framework: "global",
    category: "Architecture",
  },
  "no-tiny-text": {
    ...noTinyText,
    framework: "global",
    category: "Accessibility",
  },
  "no-transition-all": {
    ...noTransitionAll,
    framework: "global",
    category: "Performance",
  },
  "no-uncontrolled-input": {
    ...noUncontrolledInput,
    framework: "global",
    category: "Correctness",
  },
  "no-undeferred-third-party": {
    ...noUndeferredThirdParty,
    framework: "global",
    category: "Bundle Size",
  },
  "no-usememo-simple-expression": {
    ...noUsememoSimpleExpression,
    framework: "global",
    category: "Performance",
  },
  "no-wide-letter-spacing": {
    ...noWideLetterSpacing,
    framework: "global",
    category: "Architecture",
  },
  "no-z-index-9999": {
    ...noZIndex9999,
    framework: "global",
    category: "Architecture",
  },
  "prefer-dynamic-import": {
    ...preferDynamicImport,
    framework: "global",
    category: "Bundle Size",
  },
  "prefer-use-effect-event": {
    ...preferUseEffectEvent,
    framework: "global",
    category: "State & Effects",
  },
  "prefer-use-sync-external-store": {
    ...preferUseSyncExternalStore,
    framework: "global",
    category: "State & Effects",
  },
  "prefer-useReducer": {
    ...preferUseReducer,
    framework: "global",
    category: "State & Effects",
  },
  "query-mutation-missing-invalidation": {
    ...queryMutationMissingInvalidation,
    framework: "tanstack-query",
    category: "TanStack Query",
  },
  "query-no-query-in-effect": {
    ...queryNoQueryInEffect,
    framework: "tanstack-query",
    category: "TanStack Query",
  },
  "query-no-rest-destructuring": {
    ...queryNoRestDestructuring,
    framework: "tanstack-query",
    category: "TanStack Query",
  },
  "query-no-usequery-for-mutation": {
    ...queryNoUseQueryForMutation,
    framework: "tanstack-query",
    category: "TanStack Query",
  },
  "query-no-void-query-fn": {
    ...queryNoVoidQueryFn,
    framework: "tanstack-query",
    category: "TanStack Query",
  },
  "query-stable-query-client": {
    ...queryStableQueryClient,
    framework: "tanstack-query",
    category: "TanStack Query",
  },
  "react-compiler-destructure-method": {
    ...reactCompilerDestructureMethod,
    framework: "global",
    category: "Architecture",
  },
  "rendering-animate-svg-wrapper": {
    ...renderingAnimateSvgWrapper,
    framework: "global",
    category: "Performance",
  },
  "rendering-conditional-render": {
    ...renderingConditionalRender,
    framework: "global",
    category: "Correctness",
  },
  "rendering-hoist-jsx": {
    ...renderingHoistJsx,
    framework: "global",
    category: "Performance",
  },
  "rendering-hydration-mismatch-time": {
    ...renderingHydrationMismatchTime,
    framework: "global",
    category: "Correctness",
  },
  "rendering-hydration-no-flicker": {
    ...renderingHydrationNoFlicker,
    framework: "global",
    category: "Performance",
  },
  "rendering-script-defer-async": {
    ...renderingScriptDeferAsync,
    framework: "global",
    category: "Performance",
  },
  "rendering-svg-precision": {
    ...renderingSvgPrecision,
    framework: "global",
    category: "Performance",
  },
  "rendering-usetransition-loading": {
    ...renderingUsetransitionLoading,
    framework: "global",
    category: "Performance",
  },
  "rerender-defer-reads-hook": {
    ...rerenderDeferReadsHook,
    framework: "global",
    category: "Performance",
  },
  "rerender-dependencies": {
    ...rerenderDependencies,
    framework: "global",
    category: "State & Effects",
  },
  "rerender-derived-state-from-hook": {
    ...rerenderDerivedStateFromHook,
    framework: "global",
    category: "Performance",
  },
  "rerender-functional-setstate": {
    ...rerenderFunctionalSetstate,
    framework: "global",
    category: "Performance",
  },
  "rerender-lazy-state-init": {
    ...rerenderLazyStateInit,
    framework: "global",
    category: "Performance",
  },
  "rerender-memo-before-early-return": {
    ...rerenderMemoBeforeEarlyReturn,
    framework: "global",
    category: "Performance",
  },
  "rerender-memo-with-default-value": {
    ...rerenderMemoWithDefaultValue,
    framework: "global",
    category: "Performance",
  },
  "rerender-state-only-in-handlers": {
    ...rerenderStateOnlyInHandlers,
    framework: "global",
    category: "Performance",
  },
  "rerender-transitions-scroll": {
    ...rerenderTransitionsScroll,
    framework: "global",
    category: "Performance",
  },
  "rn-animate-layout-property": {
    ...rnAnimateLayoutProperty,
    framework: "react-native",
    category: "React Native",
  },
  "rn-animation-reaction-as-derived": {
    ...rnAnimationReactionAsDerived,
    framework: "react-native",
    category: "React Native",
  },
  "rn-bottom-sheet-prefer-native": {
    ...rnBottomSheetPreferNative,
    framework: "react-native",
    category: "React Native",
  },
  "rn-list-callback-per-row": {
    ...rnListCallbackPerRow,
    framework: "react-native",
    category: "React Native",
  },
  "rn-list-data-mapped": {
    ...rnListDataMapped,
    framework: "react-native",
    category: "React Native",
  },
  "rn-list-recyclable-without-types": {
    ...rnListRecyclableWithoutTypes,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-deprecated-modules": {
    ...rnNoDeprecatedModules,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-dimensions-get": {
    ...rnNoDimensionsGet,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-inline-flatlist-renderitem": {
    ...rnNoInlineFlatlistRenderitem,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-inline-object-in-list-item": {
    ...rnNoInlineObjectInListItem,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-legacy-expo-packages": {
    ...rnNoLegacyExpoPackages,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-legacy-shadow-styles": {
    ...rnNoLegacyShadowStyles,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-non-native-navigator": {
    ...rnNoNonNativeNavigator,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-raw-text": {
    ...rnNoRawText,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-scroll-state": {
    ...rnNoScrollState,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-scrollview-mapped-list": {
    ...rnNoScrollviewMappedList,
    framework: "react-native",
    category: "React Native",
  },
  "rn-no-single-element-style-array": {
    ...rnNoSingleElementStyleArray,
    framework: "react-native",
    category: "React Native",
  },
  "rn-prefer-content-inset-adjustment": {
    ...rnPreferContentInsetAdjustment,
    framework: "react-native",
    category: "React Native",
  },
  "rn-prefer-expo-image": {
    ...rnPreferExpoImage,
    framework: "react-native",
    category: "React Native",
  },
  "rn-prefer-pressable": {
    ...rnPreferPressable,
    framework: "react-native",
    category: "React Native",
  },
  "rn-prefer-reanimated": {
    ...rnPreferReanimated,
    framework: "react-native",
    category: "React Native",
  },
  "rn-pressable-shared-value-mutation": {
    ...rnPressableSharedValueMutation,
    framework: "react-native",
    category: "React Native",
  },
  "rn-scrollview-dynamic-padding": {
    ...rnScrollviewDynamicPadding,
    framework: "react-native",
    category: "React Native",
  },
  "rn-style-prefer-boxshadow": {
    ...rnStylePreferBoxShadow,
    framework: "react-native",
    category: "React Native",
  },
  "server-after-nonblocking": {
    ...serverAfterNonblocking,
    framework: "global",
    category: "Server",
  },
  "server-auth-actions": {
    ...serverAuthActions,
    framework: "global",
    category: "Server",
  },
  "server-cache-with-object-literal": {
    ...serverCacheWithObjectLiteral,
    framework: "global",
    category: "Server",
  },
  "server-dedup-props": {
    ...serverDedupProps,
    framework: "global",
    category: "Server",
  },
  "server-fetch-without-revalidate": {
    ...serverFetchWithoutRevalidate,
    framework: "global",
    category: "Server",
  },
  "server-hoist-static-io": {
    ...serverHoistStaticIo,
    framework: "global",
    category: "Server",
  },
  "server-no-mutable-module-state": {
    ...serverNoMutableModuleState,
    framework: "global",
    category: "Server",
  },
  "server-sequential-independent-await": {
    ...serverSequentialIndependentAwait,
    framework: "global",
    category: "Server",
  },
  "tanstack-start-get-mutation": {
    ...tanstackStartGetMutation,
    framework: "tanstack-start",
    category: "Security",
  },
  "tanstack-start-loader-parallel-fetch": {
    ...tanstackStartLoaderParallelFetch,
    framework: "tanstack-start",
    category: "Performance",
  },
  "tanstack-start-missing-head-content": {
    ...tanstackStartMissingHeadContent,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-no-anchor-element": {
    ...tanstackStartNoAnchorElement,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-no-direct-fetch-in-loader": {
    ...tanstackStartNoDirectFetchInLoader,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-no-dynamic-server-fn-import": {
    ...tanstackStartNoDynamicServerFnImport,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-no-navigate-in-render": {
    ...tanstackStartNoNavigateInRender,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-no-secrets-in-loader": {
    ...tanstackStartNoSecretsInLoader,
    framework: "tanstack-start",
    category: "Security",
  },
  "tanstack-start-no-use-server-in-handler": {
    ...tanstackStartNoUseServerInHandler,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-no-useeffect-fetch": {
    ...tanstackStartNoUseEffectFetch,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-redirect-in-try-catch": {
    ...tanstackStartRedirectInTryCatch,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-route-property-order": {
    ...tanstackStartRoutePropertyOrder,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-server-fn-method-order": {
    ...tanstackStartServerFnMethodOrder,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "tanstack-start-server-fn-validate-input": {
    ...tanstackStartServerFnValidateInput,
    framework: "tanstack-start",
    category: "TanStack Start",
  },
  "use-lazy-motion": {
    ...useLazyMotion,
    framework: "global",
    category: "Bundle Size",
  },
};
