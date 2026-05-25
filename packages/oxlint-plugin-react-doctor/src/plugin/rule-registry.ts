// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.
// Source of truth: every `export const <name> = defineRule({ id: "...", ... })`
// under `src/plugin/rules/<bucket>/<name>.ts`. The rule's `framework` and
// default `category` come from the bucket directory (see
// `scripts/generate-rule-registry.mjs`) — rule files only override
// `category` when needed. Adding a rule is a single-file operation:
// create the rule file, set its `id`, re-run codegen.

import type { Rule } from "./utils/rule.js";

import { advancedEventHandlerRefs } from "./rules/state-and-effects/advanced-event-handler-refs.js";
import { altText } from "./rules/a11y/alt-text.js";
import { anchorAmbiguousText } from "./rules/a11y/anchor-ambiguous-text.js";
import { anchorHasContent } from "./rules/a11y/anchor-has-content.js";
import { anchorIsValid } from "./rules/a11y/anchor-is-valid.js";
import { ariaActivedescendantHasTabindex } from "./rules/a11y/aria-activedescendant-has-tabindex.js";
import { ariaProps } from "./rules/a11y/aria-props.js";
import { ariaProptypes } from "./rules/a11y/aria-proptypes.js";
import { ariaRole } from "./rules/a11y/aria-role.js";
import { ariaUnsupportedElements } from "./rules/a11y/aria-unsupported-elements.js";
import { asyncAwaitInLoop } from "./rules/js-performance/async-await-in-loop.js";
import { asyncDeferAwait } from "./rules/performance/async-defer-await.js";
import { asyncParallel } from "./rules/js-performance/async-parallel.js";
import { autocompleteValid } from "./rules/a11y/autocomplete-valid.js";
import { buttonHasType } from "./rules/react-builtins/button-has-type.js";
import { checkedRequiresOnchangeOrReadonly } from "./rules/react-builtins/checked-requires-onchange-or-readonly.js";
import { clickEventsHaveKeyEvents } from "./rules/a11y/click-events-have-key-events.js";
import { clientLocalstorageNoVersion } from "./rules/client/client-localstorage-no-version.js";
import { clientPassiveEventListeners } from "./rules/client/client-passive-event-listeners.js";
import { controlHasAssociatedLabel } from "./rules/a11y/control-has-associated-label.js";
import { noEmDashInJsxText } from "./rules/react-ui/no-em-dash-in-jsx-text.js";
import { noRedundantPaddingAxes } from "./rules/react-ui/no-redundant-padding-axes.js";
import { noRedundantSizeAxes } from "./rules/react-ui/no-redundant-size-axes.js";
import { noSpaceOnFlexChildren } from "./rules/react-ui/no-space-on-flex-children.js";
import { noThreePeriodEllipsis } from "./rules/react-ui/no-three-period-ellipsis.js";
import { noVagueButtonLabel } from "./rules/react-ui/no-vague-button-label.js";
import { displayName } from "./rules/react-builtins/display-name.js";
import { effectNeedsCleanup } from "./rules/state-and-effects/effect-needs-cleanup.js";
import { exhaustiveDeps } from "./rules/react-builtins/exhaustive-deps.js";
import { forbidComponentProps } from "./rules/react-builtins/forbid-component-props.js";
import { forbidDomProps } from "./rules/react-builtins/forbid-dom-props.js";
import { forbidElements } from "./rules/react-builtins/forbid-elements.js";
import { forwardRefUsesRef } from "./rules/react-builtins/forward-ref-uses-ref.js";
import { headingHasContent } from "./rules/a11y/heading-has-content.js";
import { hookUseState } from "./rules/react-builtins/hook-use-state.js";
import { htmlHasLang } from "./rules/a11y/html-has-lang.js";
import { iframeHasTitle } from "./rules/a11y/iframe-has-title.js";
import { iframeMissingSandbox } from "./rules/react-builtins/iframe-missing-sandbox.js";
import { imgRedundantAlt } from "./rules/a11y/img-redundant-alt.js";
import { interactiveSupportsFocus } from "./rules/a11y/interactive-supports-focus.js";
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
import { jsxBooleanValue } from "./rules/react-builtins/jsx-boolean-value.js";
import { jsxCurlyBracePresence } from "./rules/react-builtins/jsx-curly-brace-presence.js";
import { jsxFilenameExtension } from "./rules/react-builtins/jsx-filename-extension.js";
import { jsxFragments } from "./rules/react-builtins/jsx-fragments.js";
import { jsxHandlerNames } from "./rules/react-builtins/jsx-handler-names.js";
import { jsxKey } from "./rules/react-builtins/jsx-key.js";
import { jsxMaxDepth } from "./rules/react-builtins/jsx-max-depth.js";
import { jsxNoCommentTextnodes } from "./rules/react-builtins/jsx-no-comment-textnodes.js";
import { jsxNoConstructedContextValues } from "./rules/react-builtins/jsx-no-constructed-context-values.js";
import { jsxNoDuplicateProps } from "./rules/react-builtins/jsx-no-duplicate-props.js";
import { jsxNoJsxAsProp } from "./rules/react-builtins/jsx-no-jsx-as-prop.js";
import { jsxNoNewArrayAsProp } from "./rules/react-builtins/jsx-no-new-array-as-prop.js";
import { jsxNoNewFunctionAsProp } from "./rules/react-builtins/jsx-no-new-function-as-prop.js";
import { jsxNoNewObjectAsProp } from "./rules/react-builtins/jsx-no-new-object-as-prop.js";
import { jsxNoScriptUrl } from "./rules/react-builtins/jsx-no-script-url.js";
import { jsxNoTargetBlank } from "./rules/react-builtins/jsx-no-target-blank.js";
import { jsxNoUndef } from "./rules/react-builtins/jsx-no-undef.js";
import { jsxNoUselessFragment } from "./rules/react-builtins/jsx-no-useless-fragment.js";
import { jsxPascalCase } from "./rules/react-builtins/jsx-pascal-case.js";
import { jsxPropsNoSpreadMulti } from "./rules/react-builtins/jsx-props-no-spread-multi.js";
import { jsxPropsNoSpreading } from "./rules/react-builtins/jsx-props-no-spreading.js";
import { labelHasAssociatedControl } from "./rules/a11y/label-has-associated-control.js";
import { lang } from "./rules/a11y/lang.js";
import { mediaHasCaption } from "./rules/a11y/media-has-caption.js";
import { mouseEventsHaveKeyEvents } from "./rules/a11y/mouse-events-have-key-events.js";
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
import { noAccessKey } from "./rules/a11y/no-access-key.js";
import { noAdjustStateOnPropChange } from "./rules/state-and-effects/no-adjust-state-on-prop-change.js";
import { noAriaHiddenOnFocusable } from "./rules/a11y/no-aria-hidden-on-focusable.js";
import { noArrayIndexAsKey } from "./rules/correctness/no-array-index-as-key.js";
import { noArrayIndexKey } from "./rules/react-builtins/no-array-index-key.js";
import { noAutofocus } from "./rules/a11y/no-autofocus.js";
import { noBarrelImport } from "./rules/bundle-size/no-barrel-import.js";
import { noCascadingSetState } from "./rules/state-and-effects/no-cascading-set-state.js";
import { noChainStateUpdates } from "./rules/state-and-effects/no-chain-state-updates.js";
import { noChildrenProp } from "./rules/react-builtins/no-children-prop.js";
import { noCloneElement } from "./rules/react-builtins/no-clone-element.js";
import { noDanger } from "./rules/react-builtins/no-danger.js";
import { noDangerWithChildren } from "./rules/react-builtins/no-danger-with-children.js";
import { noDarkModeGlow } from "./rules/design/no-dark-mode-glow.js";
import { noDefaultProps } from "./rules/architecture/no-default-props.js";
import { noDerivedState } from "./rules/state-and-effects/no-derived-state.js";
import { noDerivedStateEffect } from "./rules/state-and-effects/no-derived-state-effect.js";
import { noDerivedUseState } from "./rules/state-and-effects/no-derived-use-state.js";
import { noDidMountSetState } from "./rules/react-builtins/no-did-mount-set-state.js";
import { noDidUpdateSetState } from "./rules/react-builtins/no-did-update-set-state.js";
import { noDirectMutationState } from "./rules/react-builtins/no-direct-mutation-state.js";
import { noDirectStateMutation } from "./rules/state-and-effects/no-direct-state-mutation.js";
import { noDisabledZoom } from "./rules/design/no-disabled-zoom.js";
import { noDistractingElements } from "./rules/a11y/no-distracting-elements.js";
import { noDocumentStartViewTransition } from "./rules/view-transitions/no-document-start-view-transition.js";
import { noDynamicImportPath } from "./rules/bundle-size/no-dynamic-import-path.js";
import { noEffectChain } from "./rules/state-and-effects/no-effect-chain.js";
import { noEffectEventHandler } from "./rules/state-and-effects/no-effect-event-handler.js";
import { noEffectEventInDeps } from "./rules/state-and-effects/no-effect-event-in-deps.js";
import { noEval } from "./rules/security/no-eval.js";
import { noEventHandler } from "./rules/state-and-effects/no-event-handler.js";
import { noEventTriggerState } from "./rules/state-and-effects/no-event-trigger-state.js";
import { noFetchInEffect } from "./rules/state-and-effects/no-fetch-in-effect.js";
import { noFindDomNode } from "./rules/react-builtins/no-find-dom-node.js";
import { noFlushSync } from "./rules/view-transitions/no-flush-sync.js";
import { noFullLodashImport } from "./rules/bundle-size/no-full-lodash-import.js";
import { noGenericHandlerNames } from "./rules/architecture/no-generic-handler-names.js";
import { noGiantComponent } from "./rules/architecture/no-giant-component.js";
import { noGlobalCssVariableAnimation } from "./rules/performance/no-global-css-variable-animation.js";
import { noGradientText } from "./rules/design/no-gradient-text.js";
import { noGrayOnColoredBackground } from "./rules/design/no-gray-on-colored-background.js";
import { noInitializeState } from "./rules/state-and-effects/no-initialize-state.js";
import { noInlineBounceEasing } from "./rules/design/no-inline-bounce-easing.js";
import { noInlineExhaustiveStyle } from "./rules/design/no-inline-exhaustive-style.js";
import { noInlinePropOnMemoComponent } from "./rules/performance/no-inline-prop-on-memo-component.js";
import { noInteractiveElementToNoninteractiveRole } from "./rules/a11y/no-interactive-element-to-noninteractive-role.js";
import { noIsMounted } from "./rules/react-builtins/no-is-mounted.js";
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
import { noMultiComp } from "./rules/react-builtins/no-multi-comp.js";
import { noMutableInDeps } from "./rules/state-and-effects/no-mutable-in-deps.js";
import { noNamespace } from "./rules/react-builtins/no-namespace.js";
import { noNestedComponentDefinition } from "./rules/architecture/no-nested-component-definition.js";
import { noNoninteractiveElementInteractions } from "./rules/a11y/no-noninteractive-element-interactions.js";
import { noNoninteractiveElementToInteractiveRole } from "./rules/a11y/no-noninteractive-element-to-interactive-role.js";
import { noNoninteractiveTabindex } from "./rules/a11y/no-noninteractive-tabindex.js";
import { noOutlineNone } from "./rules/design/no-outline-none.js";
import { noPassDataToParent } from "./rules/state-and-effects/no-pass-data-to-parent.js";
import { noPassLiveStateToParent } from "./rules/state-and-effects/no-pass-live-state-to-parent.js";
import { noPermanentWillChange } from "./rules/performance/no-permanent-will-change.js";
import { noPolymorphicChildren } from "./rules/correctness/no-polymorphic-children.js";
import { noPreventDefault } from "./rules/correctness/no-prevent-default.js";
import { noPropCallbackInEffect } from "./rules/state-and-effects/no-prop-callback-in-effect.js";
import { noPureBlackBackground } from "./rules/design/no-pure-black-background.js";
import { noReactChildren } from "./rules/react-builtins/no-react-children.js";
import { noReactDomDeprecatedApis } from "./rules/architecture/no-react-dom-deprecated-apis.js";
import { noReact19DeprecatedApis } from "./rules/architecture/no-react19-deprecated-apis.js";
import { noRedundantRoles } from "./rules/a11y/no-redundant-roles.js";
import { noRedundantShouldComponentUpdate } from "./rules/react-builtins/no-redundant-should-component-update.js";
import { noRenderInRender } from "./rules/architecture/no-render-in-render.js";
import { noRenderPropChildren } from "./rules/architecture/no-render-prop-children.js";
import { noRenderReturnValue } from "./rules/react-builtins/no-render-return-value.js";
import { noResetAllStateOnPropChange } from "./rules/state-and-effects/no-reset-all-state-on-prop-change.js";
import { noScaleFromZero } from "./rules/performance/no-scale-from-zero.js";
import { noSecretsInClientCode } from "./rules/security/no-secrets-in-client-code.js";
import { noSetState } from "./rules/react-builtins/no-set-state.js";
import { noSetStateInRender } from "./rules/state-and-effects/no-set-state-in-render.js";
import { noSideTabBorder } from "./rules/design/no-side-tab-border.js";
import { noStaticElementInteractions } from "./rules/a11y/no-static-element-interactions.js";
import { noStringRefs } from "./rules/react-builtins/no-string-refs.js";
import { noThisInSfc } from "./rules/react-builtins/no-this-in-sfc.js";
import { noTinyText } from "./rules/design/no-tiny-text.js";
import { noTransitionAll } from "./rules/performance/no-transition-all.js";
import { noUncontrolledInput } from "./rules/correctness/no-uncontrolled-input.js";
import { noUndeferredThirdParty } from "./rules/bundle-size/no-undeferred-third-party.js";
import { noUnescapedEntities } from "./rules/react-builtins/no-unescaped-entities.js";
import { noUnknownProperty } from "./rules/react-builtins/no-unknown-property.js";
import { noUnsafe } from "./rules/react-builtins/no-unsafe.js";
import { noUnstableNestedComponents } from "./rules/react-builtins/no-unstable-nested-components.js";
import { noUsememoSimpleExpression } from "./rules/performance/no-usememo-simple-expression.js";
import { noWideLetterSpacing } from "./rules/design/no-wide-letter-spacing.js";
import { noWillUpdateSetState } from "./rules/react-builtins/no-will-update-set-state.js";
import { noZIndex9999 } from "./rules/design/no-z-index9999.js";
import { onlyExportComponents } from "./rules/react-builtins/only-export-components.js";
import { preferDynamicImport } from "./rules/bundle-size/prefer-dynamic-import.js";
import { preferEs6Class } from "./rules/react-builtins/prefer-es6-class.js";
import { preferFunctionComponent } from "./rules/react-builtins/prefer-function-component.js";
import { preferTagOverRole } from "./rules/a11y/prefer-tag-over-role.js";
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
import { reactInJsxScope } from "./rules/react-builtins/react-in-jsx-scope.js";
import { renderingAnimateSvgWrapper } from "./rules/performance/rendering-animate-svg-wrapper.js";
import { renderingConditionalRender } from "./rules/correctness/rendering-conditional-render.js";
import { renderingHoistJsx } from "./rules/performance/rendering-hoist-jsx.js";
import { renderingHydrationMismatchTime } from "./rules/performance/rendering-hydration-mismatch-time.js";
import { renderingHydrationNoFlicker } from "./rules/performance/rendering-hydration-no-flicker.js";
import { renderingScriptDeferAsync } from "./rules/performance/rendering-script-defer-async.js";
import { renderingSvgPrecision } from "./rules/correctness/rendering-svg-precision.js";
import { renderingUsetransitionLoading } from "./rules/performance/rendering-usetransition-loading.js";
import { requireRenderReturn } from "./rules/react-builtins/require-render-return.js";
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
import { roleHasRequiredAriaProps } from "./rules/a11y/role-has-required-aria-props.js";
import { roleSupportsAriaProps } from "./rules/a11y/role-supports-aria-props.js";
import { rulesOfHooks } from "./rules/react-builtins/rules-of-hooks.js";
import { scope } from "./rules/a11y/scope.js";
import { selfClosingComp } from "./rules/react-builtins/self-closing-comp.js";
import { serverAfterNonblocking } from "./rules/server/server-after-nonblocking.js";
import { serverAuthActions } from "./rules/server/server-auth-actions.js";
import { serverCacheWithObjectLiteral } from "./rules/server/server-cache-with-object-literal.js";
import { serverDedupProps } from "./rules/server/server-dedup-props.js";
import { serverFetchWithoutRevalidate } from "./rules/server/server-fetch-without-revalidate.js";
import { serverHoistStaticIo } from "./rules/server/server-hoist-static-io.js";
import { serverNoMutableModuleState } from "./rules/server/server-no-mutable-module-state.js";
import { serverSequentialIndependentAwait } from "./rules/server/server-sequential-independent-await.js";
import { stateInConstructor } from "./rules/react-builtins/state-in-constructor.js";
import { stylePropObject } from "./rules/react-builtins/style-prop-object.js";
import { tabindexNoPositive } from "./rules/a11y/tabindex-no-positive.js";
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
import { voidDomElementsNoChildren } from "./rules/react-builtins/void-dom-elements-no-children.js";

export const reactDoctorRules = [
  {
    key: "react-doctor/advanced-event-handler-refs",
    id: "advanced-event-handler-refs",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...advancedEventHandlerRefs,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/alt-text",
    id: "alt-text",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...altText,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/anchor-ambiguous-text",
    id: "anchor-ambiguous-text",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...anchorAmbiguousText,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/anchor-has-content",
    id: "anchor-has-content",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...anchorHasContent,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/anchor-is-valid",
    id: "anchor-is-valid",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...anchorIsValid,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-activedescendant-has-tabindex",
    id: "aria-activedescendant-has-tabindex",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...ariaActivedescendantHasTabindex,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-props",
    id: "aria-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...ariaProps,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-proptypes",
    id: "aria-proptypes",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...ariaProptypes,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-role",
    id: "aria-role",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...ariaRole,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-unsupported-elements",
    id: "aria-unsupported-elements",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...ariaUnsupportedElements,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/async-await-in-loop",
    id: "async-await-in-loop",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...asyncAwaitInLoop,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/async-defer-await",
    id: "async-defer-await",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...asyncDeferAwait,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/async-parallel",
    id: "async-parallel",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...asyncParallel,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/autocomplete-valid",
    id: "autocomplete-valid",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...autocompleteValid,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/button-has-type",
    id: "button-has-type",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...buttonHasType,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/checked-requires-onchange-or-readonly",
    id: "checked-requires-onchange-or-readonly",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...checkedRequiresOnchangeOrReadonly,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/click-events-have-key-events",
    id: "click-events-have-key-events",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...clickEventsHaveKeyEvents,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/client-localstorage-no-version",
    id: "client-localstorage-no-version",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...clientLocalstorageNoVersion,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/client-passive-event-listeners",
    id: "client-passive-event-listeners",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...clientPassiveEventListeners,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/control-has-associated-label",
    id: "control-has-associated-label",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...controlHasAssociatedLabel,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/design-no-em-dash-in-jsx-text",
    id: "design-no-em-dash-in-jsx-text",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noEmDashInJsxText,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-redundant-padding-axes",
    id: "design-no-redundant-padding-axes",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRedundantPaddingAxes,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-redundant-size-axes",
    id: "design-no-redundant-size-axes",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRedundantSizeAxes,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-space-on-flex-children",
    id: "design-no-space-on-flex-children",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noSpaceOnFlexChildren,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-three-period-ellipsis",
    id: "design-no-three-period-ellipsis",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noThreePeriodEllipsis,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-vague-button-label",
    id: "design-no-vague-button-label",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noVagueButtonLabel,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/display-name",
    id: "display-name",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...displayName,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/effect-needs-cleanup",
    id: "effect-needs-cleanup",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "error",
    rule: {
      ...effectNeedsCleanup,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/exhaustive-deps",
    id: "exhaustive-deps",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...exhaustiveDeps,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/forbid-component-props",
    id: "forbid-component-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...forbidComponentProps,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/forbid-dom-props",
    id: "forbid-dom-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...forbidDomProps,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/forbid-elements",
    id: "forbid-elements",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...forbidElements,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/forward-ref-uses-ref",
    id: "forward-ref-uses-ref",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...forwardRefUsesRef,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/heading-has-content",
    id: "heading-has-content",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...headingHasContent,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/hook-use-state",
    id: "hook-use-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...hookUseState,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/html-has-lang",
    id: "html-has-lang",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...htmlHasLang,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/iframe-has-title",
    id: "iframe-has-title",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...iframeHasTitle,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/iframe-missing-sandbox",
    id: "iframe-missing-sandbox",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Security",
    severity: "warn",
    rule: {
      ...iframeMissingSandbox,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/img-redundant-alt",
    id: "img-redundant-alt",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...imgRedundantAlt,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/interactive-supports-focus",
    id: "interactive-supports-focus",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...interactiveSupportsFocus,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/js-batch-dom-css",
    id: "js-batch-dom-css",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsBatchDomCss,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-cache-property-access",
    id: "js-cache-property-access",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsCachePropertyAccess,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-cache-storage",
    id: "js-cache-storage",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsCacheStorage,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-combine-iterations",
    id: "js-combine-iterations",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsCombineIterations,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-early-exit",
    id: "js-early-exit",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsEarlyExit,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-flatmap-filter",
    id: "js-flatmap-filter",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsFlatmapFilter,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-hoist-intl",
    id: "js-hoist-intl",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsHoistIntl,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-hoist-regexp",
    id: "js-hoist-regexp",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsHoistRegexp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-index-maps",
    id: "js-index-maps",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsIndexMaps,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-length-check-first",
    id: "js-length-check-first",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsLengthCheckFirst,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-min-max-loop",
    id: "js-min-max-loop",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsMinMaxLoop,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-set-map-lookups",
    id: "js-set-map-lookups",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsSetMapLookups,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-tosorted-immutable",
    id: "js-tosorted-immutable",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsTosortedImmutable,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-boolean-value",
    id: "jsx-boolean-value",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxBooleanValue,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-curly-brace-presence",
    id: "jsx-curly-brace-presence",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxCurlyBracePresence,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-filename-extension",
    id: "jsx-filename-extension",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxFilenameExtension,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-fragments",
    id: "jsx-fragments",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxFragments,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-handler-names",
    id: "jsx-handler-names",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxHandlerNames,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-key",
    id: "jsx-key",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...jsxKey,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-max-depth",
    id: "jsx-max-depth",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxMaxDepth,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-no-comment-textnodes",
    id: "jsx-no-comment-textnodes",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...jsxNoCommentTextnodes,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-no-constructed-context-values",
    id: "jsx-no-constructed-context-values",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoConstructedContextValues,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-duplicate-props",
    id: "jsx-no-duplicate-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...jsxNoDuplicateProps,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-no-jsx-as-prop",
    id: "jsx-no-jsx-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoJsxAsProp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-new-array-as-prop",
    id: "jsx-no-new-array-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoNewArrayAsProp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-new-function-as-prop",
    id: "jsx-no-new-function-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoNewFunctionAsProp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-new-object-as-prop",
    id: "jsx-no-new-object-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoNewObjectAsProp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-script-url",
    id: "jsx-no-script-url",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Security",
    severity: "error",
    rule: {
      ...jsxNoScriptUrl,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/jsx-no-target-blank",
    id: "jsx-no-target-blank",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Security",
    severity: "warn",
    rule: {
      ...jsxNoTargetBlank,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/jsx-no-undef",
    id: "jsx-no-undef",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...jsxNoUndef,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-no-useless-fragment",
    id: "jsx-no-useless-fragment",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxNoUselessFragment,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-pascal-case",
    id: "jsx-pascal-case",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxPascalCase,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-props-no-spread-multi",
    id: "jsx-props-no-spread-multi",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...jsxPropsNoSpreadMulti,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-props-no-spreading",
    id: "jsx-props-no-spreading",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxPropsNoSpreading,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/label-has-associated-control",
    id: "label-has-associated-control",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...labelHasAssociatedControl,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/lang",
    id: "lang",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...lang,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/media-has-caption",
    id: "media-has-caption",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...mediaHasCaption,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/mouse-events-have-key-events",
    id: "mouse-events-have-key-events",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...mouseEventsHaveKeyEvents,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/nextjs-async-client-component",
    id: "nextjs-async-client-component",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "error",
    rule: {
      ...nextjsAsyncClientComponent,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-image-missing-sizes",
    id: "nextjs-image-missing-sizes",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsImageMissingSizes,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-inline-script-missing-id",
    id: "nextjs-inline-script-missing-id",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsInlineScriptMissingId,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-missing-metadata",
    id: "nextjs-missing-metadata",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsMissingMetadata,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-a-element",
    id: "nextjs-no-a-element",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoAElement,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-client-fetch-for-server-data",
    id: "nextjs-no-client-fetch-for-server-data",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoClientFetchForServerData,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-client-side-redirect",
    id: "nextjs-no-client-side-redirect",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoClientSideRedirect,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-css-link",
    id: "nextjs-no-css-link",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoCssLink,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-font-link",
    id: "nextjs-no-font-link",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoFontLink,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-head-import",
    id: "nextjs-no-head-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "error",
    rule: {
      ...nextjsNoHeadImport,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-img-element",
    id: "nextjs-no-img-element",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoImgElement,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-native-script",
    id: "nextjs-no-native-script",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoNativeScript,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-polyfill-script",
    id: "nextjs-no-polyfill-script",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoPolyfillScript,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-redirect-in-try-catch",
    id: "nextjs-no-redirect-in-try-catch",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoRedirectInTryCatch,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/nextjs-no-side-effect-in-get-handler",
    id: "nextjs-no-side-effect-in-get-handler",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Security",
    severity: "error",
    rule: {
      ...nextjsNoSideEffectInGetHandler,
      framework: "nextjs",
      category: "Security",
    },
  },
  {
    key: "react-doctor/nextjs-no-use-search-params-without-suspense",
    id: "nextjs-no-use-search-params-without-suspense",
    source: "react-doctor",
    originallyExternal: false,
    framework: "nextjs",
    category: "Next.js",
    severity: "warn",
    rule: {
      ...nextjsNoUseSearchParamsWithoutSuspense,
      framework: "nextjs",
      category: "Next.js",
    },
  },
  {
    key: "react-doctor/no-access-key",
    id: "no-access-key",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noAccessKey,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-adjust-state-on-prop-change",
    id: "no-adjust-state-on-prop-change",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noAdjustStateOnPropChange,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-aria-hidden-on-focusable",
    id: "no-aria-hidden-on-focusable",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noAriaHiddenOnFocusable,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-array-index-as-key",
    id: "no-array-index-as-key",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noArrayIndexAsKey,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-array-index-key",
    id: "no-array-index-key",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noArrayIndexKey,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-autofocus",
    id: "no-autofocus",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noAutofocus,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-barrel-import",
    id: "no-barrel-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noBarrelImport,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-cascading-set-state",
    id: "no-cascading-set-state",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noCascadingSetState,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-chain-state-updates",
    id: "no-chain-state-updates",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noChainStateUpdates,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-children-prop",
    id: "no-children-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noChildrenProp,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-clone-element",
    id: "no-clone-element",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noCloneElement,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-danger",
    id: "no-danger",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noDanger,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-danger-with-children",
    id: "no-danger-with-children",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noDangerWithChildren,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-dark-mode-glow",
    id: "no-dark-mode-glow",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noDarkModeGlow,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-default-props",
    id: "no-default-props",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noDefaultProps,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-derived-state",
    id: "no-derived-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noDerivedState,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-derived-state-effect",
    id: "no-derived-state-effect",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noDerivedStateEffect,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-derived-useState",
    id: "no-derived-useState",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noDerivedUseState,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-did-mount-set-state",
    id: "no-did-mount-set-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noDidMountSetState,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-did-update-set-state",
    id: "no-did-update-set-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noDidUpdateSetState,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-direct-mutation-state",
    id: "no-direct-mutation-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noDirectMutationState,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-direct-state-mutation",
    id: "no-direct-state-mutation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noDirectStateMutation,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-disabled-zoom",
    id: "no-disabled-zoom",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...noDisabledZoom,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-distracting-elements",
    id: "no-distracting-elements",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...noDistractingElements,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-document-start-view-transition",
    id: "no-document-start-view-transition",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noDocumentStartViewTransition,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-dynamic-import-path",
    id: "no-dynamic-import-path",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noDynamicImportPath,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-effect-chain",
    id: "no-effect-chain",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noEffectChain,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-effect-event-handler",
    id: "no-effect-event-handler",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noEffectEventHandler,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-effect-event-in-deps",
    id: "no-effect-event-in-deps",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "error",
    rule: {
      ...noEffectEventInDeps,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-eval",
    id: "no-eval",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Security",
    severity: "error",
    rule: {
      ...noEval,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/no-event-handler",
    id: "no-event-handler",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noEventHandler,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-event-trigger-state",
    id: "no-event-trigger-state",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noEventTriggerState,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-fetch-in-effect",
    id: "no-fetch-in-effect",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noFetchInEffect,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-find-dom-node",
    id: "no-find-dom-node",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noFindDomNode,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-flush-sync",
    id: "no-flush-sync",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noFlushSync,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-full-lodash-import",
    id: "no-full-lodash-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noFullLodashImport,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-generic-handler-names",
    id: "no-generic-handler-names",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noGenericHandlerNames,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-giant-component",
    id: "no-giant-component",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noGiantComponent,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-global-css-variable-animation",
    id: "no-global-css-variable-animation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "error",
    rule: {
      ...noGlobalCssVariableAnimation,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-gradient-text",
    id: "no-gradient-text",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noGradientText,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-gray-on-colored-background",
    id: "no-gray-on-colored-background",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noGrayOnColoredBackground,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-initialize-state",
    id: "no-initialize-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noInitializeState,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-inline-bounce-easing",
    id: "no-inline-bounce-easing",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noInlineBounceEasing,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-inline-exhaustive-style",
    id: "no-inline-exhaustive-style",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noInlineExhaustiveStyle,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-inline-prop-on-memo-component",
    id: "no-inline-prop-on-memo-component",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noInlinePropOnMemoComponent,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-interactive-element-to-noninteractive-role",
    id: "no-interactive-element-to-noninteractive-role",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noInteractiveElementToNoninteractiveRole,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-is-mounted",
    id: "no-is-mounted",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noIsMounted,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-justified-text",
    id: "no-justified-text",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noJustifiedText,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-large-animated-blur",
    id: "no-large-animated-blur",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noLargeAnimatedBlur,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-layout-property-animation",
    id: "no-layout-property-animation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "error",
    rule: {
      ...noLayoutPropertyAnimation,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-layout-transition-inline",
    id: "no-layout-transition-inline",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noLayoutTransitionInline,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-legacy-class-lifecycles",
    id: "no-legacy-class-lifecycles",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noLegacyClassLifecycles,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-legacy-context-api",
    id: "no-legacy-context-api",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noLegacyContextApi,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-long-transition-duration",
    id: "no-long-transition-duration",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noLongTransitionDuration,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-many-boolean-props",
    id: "no-many-boolean-props",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noManyBooleanProps,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-mirror-prop-effect",
    id: "no-mirror-prop-effect",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noMirrorPropEffect,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-moment",
    id: "no-moment",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noMoment,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-multi-comp",
    id: "no-multi-comp",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noMultiComp,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-mutable-in-deps",
    id: "no-mutable-in-deps",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "error",
    rule: {
      ...noMutableInDeps,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-namespace",
    id: "no-namespace",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noNamespace,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-nested-component-definition",
    id: "no-nested-component-definition",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noNestedComponentDefinition,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-noninteractive-element-interactions",
    id: "no-noninteractive-element-interactions",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noNoninteractiveElementInteractions,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-noninteractive-element-to-interactive-role",
    id: "no-noninteractive-element-to-interactive-role",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noNoninteractiveElementToInteractiveRole,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-noninteractive-tabindex",
    id: "no-noninteractive-tabindex",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noNoninteractiveTabindex,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-outline-none",
    id: "no-outline-none",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noOutlineNone,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-pass-data-to-parent",
    id: "no-pass-data-to-parent",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noPassDataToParent,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-pass-live-state-to-parent",
    id: "no-pass-live-state-to-parent",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noPassLiveStateToParent,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-permanent-will-change",
    id: "no-permanent-will-change",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noPermanentWillChange,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-polymorphic-children",
    id: "no-polymorphic-children",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noPolymorphicChildren,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-prevent-default",
    id: "no-prevent-default",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noPreventDefault,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-prop-callback-in-effect",
    id: "no-prop-callback-in-effect",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noPropCallbackInEffect,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-pure-black-background",
    id: "no-pure-black-background",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noPureBlackBackground,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-react-children",
    id: "no-react-children",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noReactChildren,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-react-dom-deprecated-apis",
    id: "no-react-dom-deprecated-apis",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noReactDomDeprecatedApis,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-react19-deprecated-apis",
    id: "no-react19-deprecated-apis",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noReact19DeprecatedApis,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-redundant-roles",
    id: "no-redundant-roles",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noRedundantRoles,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-redundant-should-component-update",
    id: "no-redundant-should-component-update",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRedundantShouldComponentUpdate,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-render-in-render",
    id: "no-render-in-render",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRenderInRender,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-render-prop-children",
    id: "no-render-prop-children",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRenderPropChildren,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-render-return-value",
    id: "no-render-return-value",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noRenderReturnValue,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-reset-all-state-on-prop-change",
    id: "no-reset-all-state-on-prop-change",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noResetAllStateOnPropChange,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-scale-from-zero",
    id: "no-scale-from-zero",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noScaleFromZero,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-secrets-in-client-code",
    id: "no-secrets-in-client-code",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Security",
    severity: "warn",
    rule: {
      ...noSecretsInClientCode,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/no-set-state",
    id: "no-set-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noSetState,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-set-state-in-render",
    id: "no-set-state-in-render",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...noSetStateInRender,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/no-side-tab-border",
    id: "no-side-tab-border",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noSideTabBorder,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-static-element-interactions",
    id: "no-static-element-interactions",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noStaticElementInteractions,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-string-refs",
    id: "no-string-refs",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noStringRefs,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-this-in-sfc",
    id: "no-this-in-sfc",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noThisInSfc,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-tiny-text",
    id: "no-tiny-text",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noTinyText,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-transition-all",
    id: "no-transition-all",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noTransitionAll,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-uncontrolled-input",
    id: "no-uncontrolled-input",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noUncontrolledInput,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-undeferred-third-party",
    id: "no-undeferred-third-party",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noUndeferredThirdParty,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-unescaped-entities",
    id: "no-unescaped-entities",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noUnescapedEntities,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-unknown-property",
    id: "no-unknown-property",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noUnknownProperty,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-unsafe",
    id: "no-unsafe",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noUnsafe,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-unstable-nested-components",
    id: "no-unstable-nested-components",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noUnstableNestedComponents,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-usememo-simple-expression",
    id: "no-usememo-simple-expression",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noUsememoSimpleExpression,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-wide-letter-spacing",
    id: "no-wide-letter-spacing",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noWideLetterSpacing,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-will-update-set-state",
    id: "no-will-update-set-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noWillUpdateSetState,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-z-index-9999",
    id: "no-z-index-9999",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noZIndex9999,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/only-export-components",
    id: "only-export-components",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "error",
    rule: {
      ...onlyExportComponents,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/prefer-dynamic-import",
    id: "prefer-dynamic-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...preferDynamicImport,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/prefer-es6-class",
    id: "prefer-es6-class",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...preferEs6Class,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/prefer-function-component",
    id: "prefer-function-component",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...preferFunctionComponent,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/prefer-tag-over-role",
    id: "prefer-tag-over-role",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...preferTagOverRole,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/prefer-use-effect-event",
    id: "prefer-use-effect-event",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...preferUseEffectEvent,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/prefer-use-sync-external-store",
    id: "prefer-use-sync-external-store",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...preferUseSyncExternalStore,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/prefer-useReducer",
    id: "prefer-useReducer",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "warn",
    rule: {
      ...preferUseReducer,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/query-mutation-missing-invalidation",
    id: "query-mutation-missing-invalidation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryMutationMissingInvalidation,
      framework: "tanstack-query",
      category: "TanStack Query",
    },
  },
  {
    key: "react-doctor/query-no-query-in-effect",
    id: "query-no-query-in-effect",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryNoQueryInEffect,
      framework: "tanstack-query",
      category: "TanStack Query",
    },
  },
  {
    key: "react-doctor/query-no-rest-destructuring",
    id: "query-no-rest-destructuring",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryNoRestDestructuring,
      framework: "tanstack-query",
      category: "TanStack Query",
    },
  },
  {
    key: "react-doctor/query-no-usequery-for-mutation",
    id: "query-no-usequery-for-mutation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryNoUseQueryForMutation,
      framework: "tanstack-query",
      category: "TanStack Query",
    },
  },
  {
    key: "react-doctor/query-no-void-query-fn",
    id: "query-no-void-query-fn",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryNoVoidQueryFn,
      framework: "tanstack-query",
      category: "TanStack Query",
    },
  },
  {
    key: "react-doctor/query-stable-query-client",
    id: "query-stable-query-client",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryStableQueryClient,
      framework: "tanstack-query",
      category: "TanStack Query",
    },
  },
  {
    key: "react-doctor/react-compiler-destructure-method",
    id: "react-compiler-destructure-method",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...reactCompilerDestructureMethod,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/react-in-jsx-scope",
    id: "react-in-jsx-scope",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...reactInJsxScope,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/rendering-animate-svg-wrapper",
    id: "rendering-animate-svg-wrapper",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...renderingAnimateSvgWrapper,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rendering-conditional-render",
    id: "rendering-conditional-render",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...renderingConditionalRender,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/rendering-hoist-jsx",
    id: "rendering-hoist-jsx",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...renderingHoistJsx,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rendering-hydration-mismatch-time",
    id: "rendering-hydration-mismatch-time",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...renderingHydrationMismatchTime,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/rendering-hydration-no-flicker",
    id: "rendering-hydration-no-flicker",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...renderingHydrationNoFlicker,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rendering-script-defer-async",
    id: "rendering-script-defer-async",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...renderingScriptDeferAsync,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rendering-svg-precision",
    id: "rendering-svg-precision",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...renderingSvgPrecision,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rendering-usetransition-loading",
    id: "rendering-usetransition-loading",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...renderingUsetransitionLoading,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/require-render-return",
    id: "require-render-return",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...requireRenderReturn,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/rerender-defer-reads-hook",
    id: "rerender-defer-reads-hook",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...rerenderDeferReadsHook,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rerender-dependencies",
    id: "rerender-dependencies",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "State & Effects",
    severity: "error",
    rule: {
      ...rerenderDependencies,
      framework: "global",
      category: "State & Effects",
    },
  },
  {
    key: "react-doctor/rerender-derived-state-from-hook",
    id: "rerender-derived-state-from-hook",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...rerenderDerivedStateFromHook,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rerender-functional-setstate",
    id: "rerender-functional-setstate",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...rerenderFunctionalSetstate,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rerender-lazy-state-init",
    id: "rerender-lazy-state-init",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...rerenderLazyStateInit,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rerender-memo-before-early-return",
    id: "rerender-memo-before-early-return",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...rerenderMemoBeforeEarlyReturn,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rerender-memo-with-default-value",
    id: "rerender-memo-with-default-value",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...rerenderMemoWithDefaultValue,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rerender-state-only-in-handlers",
    id: "rerender-state-only-in-handlers",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...rerenderStateOnlyInHandlers,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rerender-transitions-scroll",
    id: "rerender-transitions-scroll",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...rerenderTransitionsScroll,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/rn-animate-layout-property",
    id: "rn-animate-layout-property",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "error",
    rule: {
      ...rnAnimateLayoutProperty,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnAnimateLayoutProperty.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-animation-reaction-as-derived",
    id: "rn-animation-reaction-as-derived",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnAnimationReactionAsDerived,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnAnimationReactionAsDerived.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-bottom-sheet-prefer-native",
    id: "rn-bottom-sheet-prefer-native",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnBottomSheetPreferNative,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnBottomSheetPreferNative.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-list-callback-per-row",
    id: "rn-list-callback-per-row",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnListCallbackPerRow,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnListCallbackPerRow.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-list-data-mapped",
    id: "rn-list-data-mapped",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnListDataMapped,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnListDataMapped.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-list-recyclable-without-types",
    id: "rn-list-recyclable-without-types",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnListRecyclableWithoutTypes,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnListRecyclableWithoutTypes.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-deprecated-modules",
    id: "rn-no-deprecated-modules",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "error",
    rule: {
      ...rnNoDeprecatedModules,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoDeprecatedModules.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-dimensions-get",
    id: "rn-no-dimensions-get",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnNoDimensionsGet,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoDimensionsGet.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-inline-flatlist-renderitem",
    id: "rn-no-inline-flatlist-renderitem",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnNoInlineFlatlistRenderitem,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoInlineFlatlistRenderitem.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-inline-object-in-list-item",
    id: "rn-no-inline-object-in-list-item",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnNoInlineObjectInListItem,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoInlineObjectInListItem.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-legacy-expo-packages",
    id: "rn-no-legacy-expo-packages",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnNoLegacyExpoPackages,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoLegacyExpoPackages.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-legacy-shadow-styles",
    id: "rn-no-legacy-shadow-styles",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnNoLegacyShadowStyles,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoLegacyShadowStyles.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-non-native-navigator",
    id: "rn-no-non-native-navigator",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnNoNonNativeNavigator,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoNonNativeNavigator.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-raw-text",
    id: "rn-no-raw-text",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "error",
    rule: {
      ...rnNoRawText,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoRawText.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-scroll-state",
    id: "rn-no-scroll-state",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "error",
    rule: {
      ...rnNoScrollState,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoScrollState.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-scrollview-mapped-list",
    id: "rn-no-scrollview-mapped-list",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnNoScrollviewMappedList,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoScrollviewMappedList.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-single-element-style-array",
    id: "rn-no-single-element-style-array",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnNoSingleElementStyleArray,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnNoSingleElementStyleArray.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-content-inset-adjustment",
    id: "rn-prefer-content-inset-adjustment",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnPreferContentInsetAdjustment,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnPreferContentInsetAdjustment.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-expo-image",
    id: "rn-prefer-expo-image",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnPreferExpoImage,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnPreferExpoImage.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-pressable",
    id: "rn-prefer-pressable",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnPreferPressable,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnPreferPressable.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-reanimated",
    id: "rn-prefer-reanimated",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnPreferReanimated,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnPreferReanimated.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-pressable-shared-value-mutation",
    id: "rn-pressable-shared-value-mutation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnPressableSharedValueMutation,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnPressableSharedValueMutation.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-scrollview-dynamic-padding",
    id: "rn-scrollview-dynamic-padding",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnScrollviewDynamicPadding,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnScrollviewDynamicPadding.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-style-prefer-boxshadow",
    id: "rn-style-prefer-boxshadow",
    source: "react-doctor",
    originallyExternal: false,
    framework: "react-native",
    category: "React Native",
    severity: "warn",
    rule: {
      ...rnStylePreferBoxShadow,
      framework: "react-native",
      category: "React Native",
      tags: [...new Set(["react-native", ...(rnStylePreferBoxShadow.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/role-has-required-aria-props",
    id: "role-has-required-aria-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...roleHasRequiredAriaProps,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/role-supports-aria-props",
    id: "role-supports-aria-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...roleSupportsAriaProps,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/rules-of-hooks",
    id: "rules-of-hooks",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...rulesOfHooks,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/scope",
    id: "scope",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...scope,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/self-closing-comp",
    id: "self-closing-comp",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...selfClosingComp,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/server-after-nonblocking",
    id: "server-after-nonblocking",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverAfterNonblocking,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverAfterNonblocking.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-auth-actions",
    id: "server-auth-actions",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "error",
    rule: {
      ...serverAuthActions,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverAuthActions.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-cache-with-object-literal",
    id: "server-cache-with-object-literal",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverCacheWithObjectLiteral,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverCacheWithObjectLiteral.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-dedup-props",
    id: "server-dedup-props",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverDedupProps,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverDedupProps.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-fetch-without-revalidate",
    id: "server-fetch-without-revalidate",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverFetchWithoutRevalidate,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverFetchWithoutRevalidate.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-hoist-static-io",
    id: "server-hoist-static-io",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverHoistStaticIo,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverHoistStaticIo.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-no-mutable-module-state",
    id: "server-no-mutable-module-state",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "error",
    rule: {
      ...serverNoMutableModuleState,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverNoMutableModuleState.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-sequential-independent-await",
    id: "server-sequential-independent-await",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverSequentialIndependentAwait,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverSequentialIndependentAwait.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/state-in-constructor",
    id: "state-in-constructor",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...stateInConstructor,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/style-prop-object",
    id: "style-prop-object",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...stylePropObject,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/tabindex-no-positive",
    id: "tabindex-no-positive",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...tabindexNoPositive,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/tanstack-start-get-mutation",
    id: "tanstack-start-get-mutation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "Security",
    severity: "warn",
    rule: {
      ...tanstackStartGetMutation,
      framework: "tanstack-start",
      category: "Security",
    },
  },
  {
    key: "react-doctor/tanstack-start-loader-parallel-fetch",
    id: "tanstack-start-loader-parallel-fetch",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "Performance",
    severity: "warn",
    rule: {
      ...tanstackStartLoaderParallelFetch,
      framework: "tanstack-start",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/tanstack-start-missing-head-content",
    id: "tanstack-start-missing-head-content",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartMissingHeadContent,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-anchor-element",
    id: "tanstack-start-no-anchor-element",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartNoAnchorElement,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-direct-fetch-in-loader",
    id: "tanstack-start-no-direct-fetch-in-loader",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartNoDirectFetchInLoader,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-dynamic-server-fn-import",
    id: "tanstack-start-no-dynamic-server-fn-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "error",
    rule: {
      ...tanstackStartNoDynamicServerFnImport,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-navigate-in-render",
    id: "tanstack-start-no-navigate-in-render",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartNoNavigateInRender,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-secrets-in-loader",
    id: "tanstack-start-no-secrets-in-loader",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "Security",
    severity: "error",
    rule: {
      ...tanstackStartNoSecretsInLoader,
      framework: "tanstack-start",
      category: "Security",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-use-server-in-handler",
    id: "tanstack-start-no-use-server-in-handler",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "error",
    rule: {
      ...tanstackStartNoUseServerInHandler,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-useeffect-fetch",
    id: "tanstack-start-no-useeffect-fetch",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartNoUseEffectFetch,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-redirect-in-try-catch",
    id: "tanstack-start-redirect-in-try-catch",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartRedirectInTryCatch,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-route-property-order",
    id: "tanstack-start-route-property-order",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "error",
    rule: {
      ...tanstackStartRoutePropertyOrder,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-server-fn-method-order",
    id: "tanstack-start-server-fn-method-order",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "error",
    rule: {
      ...tanstackStartServerFnMethodOrder,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/tanstack-start-server-fn-validate-input",
    id: "tanstack-start-server-fn-validate-input",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartServerFnValidateInput,
      framework: "tanstack-start",
      category: "TanStack Start",
    },
  },
  {
    key: "react-doctor/use-lazy-motion",
    id: "use-lazy-motion",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...useLazyMotion,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/void-dom-elements-no-children",
    id: "void-dom-elements-no-children",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...voidDomElementsNoChildren,
      framework: "global",
      category: "Correctness",
    },
  },
] as const;

export const ruleRegistry: Record<string, Rule> = Object.fromEntries(
  reactDoctorRules.map((rule) => [rule.id, rule.rule]),
);
