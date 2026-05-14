// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.
// Source of truth: every `export const <name> = defineRule({ id: "...", ... })`
// under `src/plugin/rules/<bucket>/<name>.ts`. Adding a rule is a single-file
// operation: create the rule file, set its `id`, re-run codegen.

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
  "advanced-event-handler-refs": advancedEventHandlerRefs,
  "async-await-in-loop": asyncAwaitInLoop,
  "async-defer-await": asyncDeferAwait,
  "async-parallel": asyncParallel,
  "client-localstorage-no-version": clientLocalstorageNoVersion,
  "client-passive-event-listeners": clientPassiveEventListeners,
  "design-no-bold-heading": noBoldHeading,
  "design-no-default-tailwind-palette": noDefaultTailwindPalette,
  "design-no-redundant-padding-axes": noRedundantPaddingAxes,
  "design-no-redundant-size-axes": noRedundantSizeAxes,
  "design-no-space-on-flex-children": noSpaceOnFlexChildren,
  "design-no-three-period-ellipsis": noThreePeriodEllipsis,
  "design-no-vague-button-label": noVagueButtonLabel,
  "effect-needs-cleanup": effectNeedsCleanup,
  "js-batch-dom-css": jsBatchDomCss,
  "js-cache-property-access": jsCachePropertyAccess,
  "js-cache-storage": jsCacheStorage,
  "js-combine-iterations": jsCombineIterations,
  "js-early-exit": jsEarlyExit,
  "js-flatmap-filter": jsFlatmapFilter,
  "js-hoist-intl": jsHoistIntl,
  "js-hoist-regexp": jsHoistRegexp,
  "js-index-maps": jsIndexMaps,
  "js-length-check-first": jsLengthCheckFirst,
  "js-min-max-loop": jsMinMaxLoop,
  "js-set-map-lookups": jsSetMapLookups,
  "js-tosorted-immutable": jsTosortedImmutable,
  "nextjs-async-client-component": nextjsAsyncClientComponent,
  "nextjs-image-missing-sizes": nextjsImageMissingSizes,
  "nextjs-inline-script-missing-id": nextjsInlineScriptMissingId,
  "nextjs-missing-metadata": nextjsMissingMetadata,
  "nextjs-no-a-element": nextjsNoAElement,
  "nextjs-no-client-fetch-for-server-data": nextjsNoClientFetchForServerData,
  "nextjs-no-client-side-redirect": nextjsNoClientSideRedirect,
  "nextjs-no-css-link": nextjsNoCssLink,
  "nextjs-no-font-link": nextjsNoFontLink,
  "nextjs-no-head-import": nextjsNoHeadImport,
  "nextjs-no-img-element": nextjsNoImgElement,
  "nextjs-no-native-script": nextjsNoNativeScript,
  "nextjs-no-polyfill-script": nextjsNoPolyfillScript,
  "nextjs-no-redirect-in-try-catch": nextjsNoRedirectInTryCatch,
  "nextjs-no-side-effect-in-get-handler": nextjsNoSideEffectInGetHandler,
  "nextjs-no-use-search-params-without-suspense": nextjsNoUseSearchParamsWithoutSuspense,
  "no-array-index-as-key": noArrayIndexAsKey,
  "no-barrel-import": noBarrelImport,
  "no-cascading-set-state": noCascadingSetState,
  "no-dark-mode-glow": noDarkModeGlow,
  "no-default-props": noDefaultProps,
  "no-derived-state-effect": noDerivedStateEffect,
  "no-derived-useState": noDerivedUseState,
  "no-direct-state-mutation": noDirectStateMutation,
  "no-disabled-zoom": noDisabledZoom,
  "no-document-start-view-transition": noDocumentStartViewTransition,
  "no-dynamic-import-path": noDynamicImportPath,
  "no-effect-chain": noEffectChain,
  "no-effect-event-handler": noEffectEventHandler,
  "no-effect-event-in-deps": noEffectEventInDeps,
  "no-eval": noEval,
  "no-event-trigger-state": noEventTriggerState,
  "no-fetch-in-effect": noFetchInEffect,
  "no-flush-sync": noFlushSync,
  "no-full-lodash-import": noFullLodashImport,
  "no-generic-handler-names": noGenericHandlerNames,
  "no-giant-component": noGiantComponent,
  "no-global-css-variable-animation": noGlobalCssVariableAnimation,
  "no-gradient-text": noGradientText,
  "no-gray-on-colored-background": noGrayOnColoredBackground,
  "no-inline-bounce-easing": noInlineBounceEasing,
  "no-inline-exhaustive-style": noInlineExhaustiveStyle,
  "no-inline-prop-on-memo-component": noInlinePropOnMemoComponent,
  "no-justified-text": noJustifiedText,
  "no-large-animated-blur": noLargeAnimatedBlur,
  "no-layout-property-animation": noLayoutPropertyAnimation,
  "no-layout-transition-inline": noLayoutTransitionInline,
  "no-legacy-class-lifecycles": noLegacyClassLifecycles,
  "no-legacy-context-api": noLegacyContextApi,
  "no-long-transition-duration": noLongTransitionDuration,
  "no-many-boolean-props": noManyBooleanProps,
  "no-mirror-prop-effect": noMirrorPropEffect,
  "no-moment": noMoment,
  "no-mutable-in-deps": noMutableInDeps,
  "no-nested-component-definition": noNestedComponentDefinition,
  "no-outline-none": noOutlineNone,
  "no-permanent-will-change": noPermanentWillChange,
  "no-polymorphic-children": noPolymorphicChildren,
  "no-prevent-default": noPreventDefault,
  "no-prop-callback-in-effect": noPropCallbackInEffect,
  "no-pure-black-background": noPureBlackBackground,
  "no-react-dom-deprecated-apis": noReactDomDeprecatedApis,
  "no-react19-deprecated-apis": noReact19DeprecatedApis,
  "no-render-in-render": noRenderInRender,
  "no-render-prop-children": noRenderPropChildren,
  "no-scale-from-zero": noScaleFromZero,
  "no-secrets-in-client-code": noSecretsInClientCode,
  "no-set-state-in-render": noSetStateInRender,
  "no-side-tab-border": noSideTabBorder,
  "no-tiny-text": noTinyText,
  "no-transition-all": noTransitionAll,
  "no-uncontrolled-input": noUncontrolledInput,
  "no-undeferred-third-party": noUndeferredThirdParty,
  "no-usememo-simple-expression": noUsememoSimpleExpression,
  "no-wide-letter-spacing": noWideLetterSpacing,
  "no-z-index-9999": noZIndex9999,
  "prefer-dynamic-import": preferDynamicImport,
  "prefer-use-effect-event": preferUseEffectEvent,
  "prefer-use-sync-external-store": preferUseSyncExternalStore,
  "prefer-useReducer": preferUseReducer,
  "query-mutation-missing-invalidation": queryMutationMissingInvalidation,
  "query-no-query-in-effect": queryNoQueryInEffect,
  "query-no-rest-destructuring": queryNoRestDestructuring,
  "query-no-usequery-for-mutation": queryNoUseQueryForMutation,
  "query-no-void-query-fn": queryNoVoidQueryFn,
  "query-stable-query-client": queryStableQueryClient,
  "react-compiler-destructure-method": reactCompilerDestructureMethod,
  "rendering-animate-svg-wrapper": renderingAnimateSvgWrapper,
  "rendering-conditional-render": renderingConditionalRender,
  "rendering-hoist-jsx": renderingHoistJsx,
  "rendering-hydration-mismatch-time": renderingHydrationMismatchTime,
  "rendering-hydration-no-flicker": renderingHydrationNoFlicker,
  "rendering-script-defer-async": renderingScriptDeferAsync,
  "rendering-svg-precision": renderingSvgPrecision,
  "rendering-usetransition-loading": renderingUsetransitionLoading,
  "rerender-defer-reads-hook": rerenderDeferReadsHook,
  "rerender-dependencies": rerenderDependencies,
  "rerender-derived-state-from-hook": rerenderDerivedStateFromHook,
  "rerender-functional-setstate": rerenderFunctionalSetstate,
  "rerender-lazy-state-init": rerenderLazyStateInit,
  "rerender-memo-before-early-return": rerenderMemoBeforeEarlyReturn,
  "rerender-memo-with-default-value": rerenderMemoWithDefaultValue,
  "rerender-state-only-in-handlers": rerenderStateOnlyInHandlers,
  "rerender-transitions-scroll": rerenderTransitionsScroll,
  "rn-animate-layout-property": rnAnimateLayoutProperty,
  "rn-animation-reaction-as-derived": rnAnimationReactionAsDerived,
  "rn-bottom-sheet-prefer-native": rnBottomSheetPreferNative,
  "rn-list-callback-per-row": rnListCallbackPerRow,
  "rn-list-data-mapped": rnListDataMapped,
  "rn-list-recyclable-without-types": rnListRecyclableWithoutTypes,
  "rn-no-deprecated-modules": rnNoDeprecatedModules,
  "rn-no-dimensions-get": rnNoDimensionsGet,
  "rn-no-inline-flatlist-renderitem": rnNoInlineFlatlistRenderitem,
  "rn-no-inline-object-in-list-item": rnNoInlineObjectInListItem,
  "rn-no-legacy-expo-packages": rnNoLegacyExpoPackages,
  "rn-no-legacy-shadow-styles": rnNoLegacyShadowStyles,
  "rn-no-non-native-navigator": rnNoNonNativeNavigator,
  "rn-no-raw-text": rnNoRawText,
  "rn-no-scroll-state": rnNoScrollState,
  "rn-no-scrollview-mapped-list": rnNoScrollviewMappedList,
  "rn-no-single-element-style-array": rnNoSingleElementStyleArray,
  "rn-prefer-content-inset-adjustment": rnPreferContentInsetAdjustment,
  "rn-prefer-expo-image": rnPreferExpoImage,
  "rn-prefer-pressable": rnPreferPressable,
  "rn-prefer-reanimated": rnPreferReanimated,
  "rn-pressable-shared-value-mutation": rnPressableSharedValueMutation,
  "rn-scrollview-dynamic-padding": rnScrollviewDynamicPadding,
  "rn-style-prefer-boxshadow": rnStylePreferBoxShadow,
  "server-after-nonblocking": serverAfterNonblocking,
  "server-auth-actions": serverAuthActions,
  "server-cache-with-object-literal": serverCacheWithObjectLiteral,
  "server-dedup-props": serverDedupProps,
  "server-fetch-without-revalidate": serverFetchWithoutRevalidate,
  "server-hoist-static-io": serverHoistStaticIo,
  "server-no-mutable-module-state": serverNoMutableModuleState,
  "server-sequential-independent-await": serverSequentialIndependentAwait,
  "tanstack-start-get-mutation": tanstackStartGetMutation,
  "tanstack-start-loader-parallel-fetch": tanstackStartLoaderParallelFetch,
  "tanstack-start-missing-head-content": tanstackStartMissingHeadContent,
  "tanstack-start-no-anchor-element": tanstackStartNoAnchorElement,
  "tanstack-start-no-direct-fetch-in-loader": tanstackStartNoDirectFetchInLoader,
  "tanstack-start-no-dynamic-server-fn-import": tanstackStartNoDynamicServerFnImport,
  "tanstack-start-no-navigate-in-render": tanstackStartNoNavigateInRender,
  "tanstack-start-no-secrets-in-loader": tanstackStartNoSecretsInLoader,
  "tanstack-start-no-use-server-in-handler": tanstackStartNoUseServerInHandler,
  "tanstack-start-no-useeffect-fetch": tanstackStartNoUseEffectFetch,
  "tanstack-start-redirect-in-try-catch": tanstackStartRedirectInTryCatch,
  "tanstack-start-route-property-order": tanstackStartRoutePropertyOrder,
  "tanstack-start-server-fn-method-order": tanstackStartServerFnMethodOrder,
  "tanstack-start-server-fn-validate-input": tanstackStartServerFnValidateInput,
  "use-lazy-motion": useLazyMotion,
};
