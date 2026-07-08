// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.
// Source of truth: every `export const <name> = defineRule({ id: "...", ... })`
// under `src/plugin/rules/<bucket>/<name>.ts`. The rule's `framework` and
// default `category` come from the bucket directory (see
// `scripts/generate-rule-registry.mjs`) — rule files only override
// `category` when needed. Adding a rule is a single-file operation:
// create the rule file, set its `id`, re-run codegen.

import type { Capability } from "./utils/capability.js";
import type { Rule } from "./utils/rule.js";

import { activeStaticAsset } from "./rules/security-scan/active-static-asset.js";
import { activityWrapsEffectHeavySubtree } from "./rules/state-and-effects/activity-wraps-effect-heavy-subtree.js";
import { advancedEventHandlerRefs } from "./rules/state-and-effects/advanced-event-handler-refs.js";
import { agentToolCapabilityRisk } from "./rules/security-scan/agent-tool-capability-risk.js";
import { altText } from "./rules/a11y/alt-text.js";
import { anchorAmbiguousText } from "./rules/a11y/anchor-ambiguous-text.js";
import { anchorHasContent } from "./rules/a11y/anchor-has-content.js";
import { anchorIsValid } from "./rules/a11y/anchor-is-valid.js";
import { ariaActivedescendantHasTabindex } from "./rules/a11y/aria-activedescendant-has-tabindex.js";
import { ariaProps } from "./rules/a11y/aria-props.js";
import { ariaProptypes } from "./rules/a11y/aria-proptypes.js";
import { ariaRole } from "./rules/a11y/aria-role.js";
import { ariaUnsupportedElements } from "./rules/a11y/aria-unsupported-elements.js";
import { artifactBaasAuthoritySurface } from "./rules/security-scan/artifact-baas-authority-surface.js";
import { artifactEnvLeak } from "./rules/security-scan/artifact-env-leak.js";
import { artifactSecretLeak } from "./rules/security-scan/artifact-secret-leak.js";
import { asyncAwaitInLoop } from "./rules/js-performance/async-await-in-loop.js";
import { asyncDeferAwait } from "./rules/performance/async-defer-await.js";
import { asyncParallel } from "./rules/js-performance/async-parallel.js";
import { authTokenInWebStorage } from "./rules/security/auth-token-in-web-storage.js";
import { autocompleteValid } from "./rules/a11y/autocomplete-valid.js";
import { buildPipelineSecretBoundary } from "./rules/security-scan/build-pipeline-secret-boundary.js";
import { buttonHasType } from "./rules/react-builtins/button-has-type.js";
import { checkedRequiresOnchangeOrReadonly } from "./rules/react-builtins/checked-requires-onchange-or-readonly.js";
import { clickEventsHaveKeyEvents } from "./rules/a11y/click-events-have-key-events.js";
import { clickjackingRedirectRisk } from "./rules/security-scan/clickjacking-redirect-risk.js";
import { clientLocalstorageNoVersion } from "./rules/client/client-localstorage-no-version.js";
import { clientPassiveEventListeners } from "./rules/client/client-passive-event-listeners.js";
import { commandExecutionInputRisk } from "./rules/security-scan/command-execution-input-risk.js";
import { controlHasAssociatedLabel } from "./rules/a11y/control-has-associated-label.js";
import { corsCookieTrustRisk } from "./rules/security-scan/cors-cookie-trust-risk.js";
import { dangerousHtmlSink } from "./rules/security-scan/dangerous-html-sink.js";
import { noEmDashInJsxText } from "./rules/react-ui/no-em-dash-in-jsx-text.js";
import { noRedundantPaddingAxes } from "./rules/react-ui/no-redundant-padding-axes.js";
import { noRedundantSizeAxes } from "./rules/react-ui/no-redundant-size-axes.js";
import { noSpaceOnFlexChildren } from "./rules/react-ui/no-space-on-flex-children.js";
import { noThreePeriodEllipsis } from "./rules/react-ui/no-three-period-ellipsis.js";
import { noVagueButtonLabel } from "./rules/react-ui/no-vague-button-label.js";
import { dialogHasAccessibleName } from "./rules/a11y/dialog-has-accessible-name.js";
import { displayName } from "./rules/react-builtins/display-name.js";
import { effectNeedsCleanup } from "./rules/state-and-effects/effect-needs-cleanup.js";
import { exhaustiveDeps } from "./rules/react-builtins/exhaustive-deps.js";
import { expoNoNonInlinedEnv } from "./rules/react-native/expo-no-non-inlined-env.js";
import { firebaseClientOwnedAuthzField } from "./rules/security-scan/firebase-client-owned-authz-field.js";
import { firebasePermissiveRules } from "./rules/security-scan/firebase-permissive-rules.js";
import { firebaseQueryFilterAsAuth } from "./rules/security-scan/firebase-query-filter-as-auth.js";
import { forbidComponentProps } from "./rules/react-builtins/forbid-component-props.js";
import { forbidDomProps } from "./rules/react-builtins/forbid-dom-props.js";
import { forbidElements } from "./rules/react-builtins/forbid-elements.js";
import { forwardRefUsesRef } from "./rules/react-builtins/forward-ref-uses-ref.js";
import { gitProviderUrlInjectionRisk } from "./rules/security-scan/git-provider-url-injection-risk.js";
import { headingHasContent } from "./rules/a11y/heading-has-content.js";
import { hookUseState } from "./rules/react-builtins/hook-use-state.js";
import { hooksNoNanInDeps } from "./rules/state-and-effects/hooks-no-nan-in-deps.js";
import { htmlHasLang } from "./rules/a11y/html-has-lang.js";
import { htmlNoInvalidParagraphChild } from "./rules/correctness/html-no-invalid-paragraph-child.js";
import { htmlNoInvalidTableNesting } from "./rules/correctness/html-no-invalid-table-nesting.js";
import { htmlNoNestedInteractive } from "./rules/correctness/html-no-nested-interactive.js";
import { iframeHasTitle } from "./rules/a11y/iframe-has-title.js";
import { iframeMissingSandbox } from "./rules/react-builtins/iframe-missing-sandbox.js";
import { imgRedundantAlt } from "./rules/a11y/img-redundant-alt.js";
import { importMetadataExecutionRisk } from "./rules/security-scan/import-metadata-execution-risk.js";
import { insecureCryptoRisk } from "./rules/security-scan/insecure-crypto-risk.js";
import { insecureSessionCookie } from "./rules/security-scan/insecure-session-cookie.js";
import { interactiveSupportsFocus } from "./rules/a11y/interactive-supports-focus.js";
import { jotaiDerivedAtomReturnsFreshObject } from "./rules/jotai/jotai-derived-atom-returns-fresh-object.js";
import { jotaiSelectAtomInRenderBody } from "./rules/jotai/jotai-select-atom-in-render-body.js";
import { jotaiTqUseRawQueryAtom } from "./rules/jotai/jotai-tq-use-raw-query-atom.js";
import { jsAsyncReduceWithoutAwaitedAcc } from "./rules/js-performance/js-async-reduce-without-awaited-acc.js";
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
import { jwtInsecureVerification } from "./rules/security-scan/jwt-insecure-verification.js";
import { keyLifecycleRisk } from "./rules/security-scan/key-lifecycle-risk.js";
import { labelHasAssociatedControl } from "./rules/a11y/label-has-associated-control.js";
import { lang } from "./rules/a11y/lang.js";
import { localRpcNativeBridgeRisk } from "./rules/security-scan/local-rpc-native-bridge-risk.js";
import { mcpToolCapabilityRisk } from "./rules/security-scan/mcp-tool-capability-risk.js";
import { mdxSsrExecutionRisk } from "./rules/security-scan/mdx-ssr-execution-risk.js";
import { mediaHasCaption } from "./rules/a11y/media-has-caption.js";
import { mouseEventsHaveKeyEvents } from "./rules/a11y/mouse-events-have-key-events.js";
import { nextjsAsyncClientComponent } from "./rules/nextjs/nextjs-async-client-component.js";
import { nextjsErrorBoundaryMissingUseClient } from "./rules/nextjs/nextjs-error-boundary-missing-use-client.js";
import { nextjsGlobalErrorMissingHtmlBody } from "./rules/nextjs/nextjs-global-error-missing-html-body.js";
import { nextjsImageMissingSizes } from "./rules/nextjs/nextjs-image-missing-sizes.js";
import { nextjsInlineScriptMissingId } from "./rules/nextjs/nextjs-inline-script-missing-id.js";
import { nextjsMissingMetadata } from "./rules/nextjs/nextjs-missing-metadata.js";
import { nextjsNoAElement } from "./rules/nextjs/nextjs-no-a-element.js";
import { nextjsNoClientFetchForServerData } from "./rules/nextjs/nextjs-no-client-fetch-for-server-data.js";
import { nextjsNoClientSideRedirect } from "./rules/nextjs/nextjs-no-client-side-redirect.js";
import { nextjsNoCssLink } from "./rules/nextjs/nextjs-no-css-link.js";
import { nextjsNoDefaultExportInRouteHandler } from "./rules/nextjs/nextjs-no-default-export-in-route-handler.js";
import { nextjsNoEdgeOgRuntime } from "./rules/nextjs/nextjs-no-edge-og-runtime.js";
import { nextjsNoFontLink } from "./rules/nextjs/nextjs-no-font-link.js";
import { nextjsNoGoogleAnalyticsScript } from "./rules/nextjs/nextjs-no-google-analytics-script.js";
import { nextjsNoHeadImport } from "./rules/nextjs/nextjs-no-head-import.js";
import { nextjsNoImgElement } from "./rules/nextjs/nextjs-no-img-element.js";
import { nextjsNoNativeScript } from "./rules/nextjs/nextjs-no-native-script.js";
import { nextjsNoPolyfillScript } from "./rules/nextjs/nextjs-no-polyfill-script.js";
import { nextjsNoRedirectInTryCatch } from "./rules/nextjs/nextjs-no-redirect-in-try-catch.js";
import { nextjsNoScriptInHead } from "./rules/nextjs/nextjs-no-script-in-head.js";
import { nextjsNoSideEffectInGetHandler } from "./rules/nextjs/nextjs-no-side-effect-in-get-handler.js";
import { nextjsNoUseSearchParamsWithoutSuspense } from "./rules/nextjs/nextjs-no-use-search-params-without-suspense.js";
import { nextjsNoVercelOgImport } from "./rules/nextjs/nextjs-no-vercel-og-import.js";
import { noAccessKey } from "./rules/a11y/no-access-key.js";
import { noAdjustStateOnPropChange } from "./rules/state-and-effects/no-adjust-state-on-prop-change.js";
import { noAriaHiddenOnFocusable } from "./rules/a11y/no-aria-hidden-on-focusable.js";
import { noArrayIndexAsKey } from "./rules/correctness/no-array-index-as-key.js";
import { noArrayIndexKey } from "./rules/react-builtins/no-array-index-key.js";
import { noAsyncEffectCallback } from "./rules/state-and-effects/no-async-effect-callback.js";
import { noAutofocus } from "./rules/a11y/no-autofocus.js";
import { noBarrelImport } from "./rules/bundle-size/no-barrel-import.js";
import { noCallComponentAsFunction } from "./rules/react-builtins/no-call-component-as-function.js";
import { noCascadingSetState } from "./rules/state-and-effects/no-cascading-set-state.js";
import { noChainStateUpdates } from "./rules/state-and-effects/no-chain-state-updates.js";
import { noChildrenProp } from "./rules/react-builtins/no-children-prop.js";
import { noCloneElement } from "./rules/react-builtins/no-clone-element.js";
import { noCreateContextInRender } from "./rules/state-and-effects/no-create-context-in-render.js";
import { noCreateRefInFunctionComponent } from "./rules/react-builtins/no-create-ref-in-function-component.js";
import { noCreateStoreInRender } from "./rules/state-and-effects/no-create-store-in-render.js";
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
import { noDocumentWrite } from "./rules/js-performance/no-document-write.js";
import { noDynamicImportPath } from "./rules/bundle-size/no-dynamic-import-path.js";
import { noEffectChain } from "./rules/state-and-effects/no-effect-chain.js";
import { noEffectEventHandler } from "./rules/state-and-effects/no-effect-event-handler.js";
import { noEffectEventInDeps } from "./rules/state-and-effects/no-effect-event-in-deps.js";
import { noEffectWithFreshDeps } from "./rules/state-and-effects/no-effect-with-fresh-deps.js";
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
import { noImgLazyWithHighFetchpriority } from "./rules/performance/no-img-lazy-with-high-fetchpriority.js";
import { noInitializeState } from "./rules/state-and-effects/no-initialize-state.js";
import { noInlineBounceEasing } from "./rules/design/no-inline-bounce-easing.js";
import { noInlineExhaustiveStyle } from "./rules/design/no-inline-exhaustive-style.js";
import { noInlinePropOnMemoComponent } from "./rules/performance/no-inline-prop-on-memo-component.js";
import { noInteractiveElementToNoninteractiveRole } from "./rules/a11y/no-interactive-element-to-noninteractive-role.js";
import { noIsMounted } from "./rules/react-builtins/no-is-mounted.js";
import { noJsonParseStringifyClone } from "./rules/js-performance/no-json-parse-stringify-clone.js";
import { noJsxElementType } from "./rules/correctness/no-jsx-element-type.js";
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
import { noMutatingReducerState } from "./rules/state-and-effects/no-mutating-reducer-state.js";
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
import { noPropTypes } from "./rules/architecture/no-prop-types.js";
import { noPureBlackBackground } from "./rules/design/no-pure-black-background.js";
import { noRandomKey } from "./rules/correctness/no-random-key.js";
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
import { noSelfUpdatingEffect } from "./rules/state-and-effects/no-self-updating-effect.js";
import { noSetState } from "./rules/react-builtins/no-set-state.js";
import { noSetStateInRender } from "./rules/state-and-effects/no-set-state-in-render.js";
import { noSideTabBorder } from "./rules/design/no-side-tab-border.js";
import { noStaticElementInteractions } from "./rules/a11y/no-static-element-interactions.js";
import { noStringFalseOnBooleanAttribute } from "./rules/react-builtins/no-string-false-on-boolean-attribute.js";
import { noStringRefs } from "./rules/react-builtins/no-string-refs.js";
import { noSyncXhr } from "./rules/js-performance/no-sync-xhr.js";
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
import { nosqlInjectionRisk } from "./rules/security-scan/nosql-injection-risk.js";
import { onlyExportComponents } from "./rules/react-builtins/only-export-components.js";
import { packageMetadataSecret } from "./rules/security-scan/package-metadata-secret.js";
import { pathTraversalRisk } from "./rules/security-scan/path-traversal-risk.js";
import { pluginUpdateTrustRisk } from "./rules/security-scan/plugin-update-trust-risk.js";
import { postmessageOriginRisk } from "./rules/security-scan/postmessage-origin-risk.js";
import { preactNoChildrenLength } from "./rules/preact/preact-no-children-length.js";
import { preactNoReactHooksImport } from "./rules/preact/preact-no-react-hooks-import.js";
import { preactNoRenderArguments } from "./rules/preact/preact-no-render-arguments.js";
import { preactPreferOndblclick } from "./rules/preact/preact-prefer-ondblclick.js";
import { preactPreferOninput } from "./rules/preact/preact-prefer-oninput.js";
import { preferDynamicImport } from "./rules/bundle-size/prefer-dynamic-import.js";
import { preferEs6Class } from "./rules/react-builtins/prefer-es6-class.js";
import { preferExplicitVariants } from "./rules/architecture/prefer-explicit-variants.js";
import { preferFunctionComponent } from "./rules/react-builtins/prefer-function-component.js";
import { preferHtmlDialog } from "./rules/a11y/prefer-html-dialog.js";
import { preferModuleScopePureFunction } from "./rules/architecture/prefer-module-scope-pure-function.js";
import { preferModuleScopeStaticValue } from "./rules/architecture/prefer-module-scope-static-value.js";
import { preferStableEmptyFallback } from "./rules/performance/prefer-stable-empty-fallback.js";
import { preferTagOverRole } from "./rules/a11y/prefer-tag-over-role.js";
import { preferUseEffectEvent } from "./rules/state-and-effects/prefer-use-effect-event.js";
import { preferUseSyncExternalStore } from "./rules/state-and-effects/prefer-use-sync-external-store.js";
import { preferUseReducer } from "./rules/state-and-effects/prefer-use-reducer.js";
import { publicDebugArtifact } from "./rules/security-scan/public-debug-artifact.js";
import { publicEnvSecretName } from "./rules/security-scan/public-env-secret-name.js";
import { queryDestructureResult } from "./rules/tanstack-query/query-destructure-result.js";
import { queryMutationMissingInvalidation } from "./rules/tanstack-query/query-mutation-missing-invalidation.js";
import { queryNoQueryInEffect } from "./rules/tanstack-query/query-no-query-in-effect.js";
import { queryNoRestDestructuring } from "./rules/tanstack-query/query-no-rest-destructuring.js";
import { queryNoUseQueryForMutation } from "./rules/tanstack-query/query-no-use-query-for-mutation.js";
import { queryNoVoidQueryFn } from "./rules/tanstack-query/query-no-void-query-fn.js";
import { queryStableQueryClient } from "./rules/tanstack-query/query-stable-query-client.js";
import { rawSqlInjectionRisk } from "./rules/security-scan/raw-sql-injection-risk.js";
import { reactCompilerNoManualMemoization } from "./rules/architecture/react-compiler-no-manual-memoization.js";
import { reactInJsxScope } from "./rules/react-builtins/react-in-jsx-scope.js";
import { reduxUseselectorInlineDerivation } from "./rules/state-and-effects/redux-useselector-inline-derivation.js";
import { reduxUseselectorReturnsNewCollection } from "./rules/state-and-effects/redux-useselector-returns-new-collection.js";
import { renderingAnimateSvgWrapper } from "./rules/performance/rendering-animate-svg-wrapper.js";
import { renderingConditionalRender } from "./rules/correctness/rendering-conditional-render.js";
import { renderingHoistJsx } from "./rules/performance/rendering-hoist-jsx.js";
import { renderingHydrationMismatchTime } from "./rules/performance/rendering-hydration-mismatch-time.js";
import { renderingHydrationNoFlicker } from "./rules/performance/rendering-hydration-no-flicker.js";
import { renderingScriptDeferAsync } from "./rules/performance/rendering-script-defer-async.js";
import { renderingSvgPrecision } from "./rules/correctness/rendering-svg-precision.js";
import { renderingUsetransitionLoading } from "./rules/performance/rendering-usetransition-loading.js";
import { repositorySecretFile } from "./rules/security-scan/repository-secret-file.js";
import { requestBodyMassAssignment } from "./rules/security-scan/request-body-mass-assignment.js";
import { requireRenderReturn } from "./rules/react-builtins/require-render-return.js";
import { rerenderDeferReadsHook } from "./rules/state-and-effects/rerender-defer-reads-hook.js";
import { rerenderDependencies } from "./rules/state-and-effects/rerender-dependencies.js";
import { rerenderDerivedStateFromHook } from "./rules/performance/rerender-derived-state-from-hook.js";
import { rerenderFunctionalSetstate } from "./rules/state-and-effects/rerender-functional-setstate.js";
import { rerenderLazyRefInit } from "./rules/state-and-effects/rerender-lazy-ref-init.js";
import { rerenderLazyStateInit } from "./rules/state-and-effects/rerender-lazy-state-init.js";
import { rerenderMemoBeforeEarlyReturn } from "./rules/performance/rerender-memo-before-early-return.js";
import { rerenderMemoWithDefaultValue } from "./rules/performance/rerender-memo-with-default-value.js";
import { rerenderStateOnlyInHandlers } from "./rules/state-and-effects/rerender-state-only-in-handlers.js";
import { rerenderTransitionsScroll } from "./rules/performance/rerender-transitions-scroll.js";
import { rnAnimateLayoutProperty } from "./rules/react-native/rn-animate-layout-property.js";
import { rnAnimationReactionAsDerived } from "./rules/react-native/rn-animation-reaction-as-derived.js";
import { rnBottomSheetPreferNative } from "./rules/react-native/rn-bottom-sheet-prefer-native.js";
import { rnDetoxMissingAwait } from "./rules/react-native/rn-detox-missing-await.js";
import { rnListCallbackPerRow } from "./rules/react-native/rn-list-callback-per-row.js";
import { rnListDataMapped } from "./rules/react-native/rn-list-data-mapped.js";
import { rnListMissingEstimatedItemSize } from "./rules/react-native/rn-list-missing-estimated-item-size.js";
import { rnListRecyclableWithoutTypes } from "./rules/react-native/rn-list-recyclable-without-types.js";
import { rnNoDeepImports } from "./rules/react-native/rn-no-deep-imports.js";
import { rnNoDeprecatedModules } from "./rules/react-native/rn-no-deprecated-modules.js";
import { rnNoDimensionsGet } from "./rules/react-native/rn-no-dimensions-get.js";
import { rnNoFalsyAndRender } from "./rules/react-native/rn-no-falsy-and-render.js";
import { rnNoImageChildren } from "./rules/react-native/rn-no-image-children.js";
import { rnNoInlineFlatlistRenderitem } from "./rules/react-native/rn-no-inline-flatlist-renderitem.js";
import { rnNoInlineObjectInListItem } from "./rules/react-native/rn-no-inline-object-in-list-item.js";
import { rnNoLegacyExpoPackages } from "./rules/react-native/rn-no-legacy-expo-packages.js";
import { rnNoLegacyShadowStyles } from "./rules/react-native/rn-no-legacy-shadow-styles.js";
import { rnNoNonNativeNavigator } from "./rules/react-native/rn-no-non-native-navigator.js";
import { rnNoPanresponder } from "./rules/react-native/rn-no-panresponder.js";
import { rnNoRawText } from "./rules/react-native/rn-no-raw-text.js";
import { rnNoRenderitemKey } from "./rules/react-native/rn-no-renderitem-key.js";
import { rnNoScrollState } from "./rules/react-native/rn-no-scroll-state.js";
import { rnNoScrollviewMappedList } from "./rules/react-native/rn-no-scrollview-mapped-list.js";
import { rnNoSetNativeProps } from "./rules/react-native/rn-no-set-native-props.js";
import { rnNoSingleElementStyleArray } from "./rules/react-native/rn-no-single-element-style-array.js";
import { rnPreferContentInsetAdjustment } from "./rules/react-native/rn-prefer-content-inset-adjustment.js";
import { rnPreferExpoImage } from "./rules/react-native/rn-prefer-expo-image.js";
import { rnPreferPressable } from "./rules/react-native/rn-prefer-pressable.js";
import { rnPreferPressableOverGestureDetector } from "./rules/react-native/rn-prefer-pressable-over-gesture-detector.js";
import { rnPreferReanimated } from "./rules/react-native/rn-prefer-reanimated.js";
import { rnPressableSharedValueMutation } from "./rules/react-native/rn-pressable-shared-value-mutation.js";
import { rnScrollviewDynamicPadding } from "./rules/react-native/rn-scrollview-dynamic-padding.js";
import { rnScrollviewFlexInContentContainer } from "./rules/react-native/rn-scrollview-flex-in-content-container.js";
import { rnStylePreferBoxShadow } from "./rules/react-native/rn-style-prefer-box-shadow.js";
import { roleHasRequiredAriaProps } from "./rules/a11y/role-has-required-aria-props.js";
import { roleSupportsAriaProps } from "./rules/a11y/role-supports-aria-props.js";
import { rulesOfHooks } from "./rules/react-builtins/rules-of-hooks.js";
import { scope } from "./rules/a11y/scope.js";
import { secretInFallback } from "./rules/security-scan/secret-in-fallback.js";
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
import { supabaseClientOwnedAuthzField } from "./rules/security-scan/supabase-client-owned-authz-field.js";
import { supabaseRlsPolicyRisk } from "./rules/security-scan/supabase-rls-policy-risk.js";
import { supabaseTableMissingRls } from "./rules/security-scan/supabase-table-missing-rls.js";
import { svgFilterClickjackingRisk } from "./rules/security-scan/svg-filter-clickjacking-risk.js";
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
import { tenantStaticProxyRisk } from "./rules/security-scan/tenant-static-proxy-risk.js";
import { unsafeJsonInHtml } from "./rules/security-scan/unsafe-json-in-html.js";
import { untrustedRedirectFollowing } from "./rules/security-scan/untrusted-redirect-following.js";
import { urlPrefilledPrivilegedAction } from "./rules/security-scan/url-prefilled-privileged-action.js";
import { useLazyMotion } from "./rules/bundle-size/use-lazy-motion.js";
import { voidDomElementsNoChildren } from "./rules/react-builtins/void-dom-elements-no-children.js";
import { webhookSignatureRisk } from "./rules/security-scan/webhook-signature-risk.js";
import { zodV4NoDeprecatedErrorApis } from "./rules/zod/zod-v4-no-deprecated-error-apis.js";
import { zodV4NoDeprecatedErrorCustomization } from "./rules/zod/zod-v4-no-deprecated-error-customization.js";
import { zodV4NoDeprecatedSchemaApis } from "./rules/zod/zod-v4-no-deprecated-schema-apis.js";
import { zodV4PreferTopLevelStringFormats } from "./rules/zod/zod-v4-prefer-top-level-string-formats.js";

export const reactDoctorRules = [
  {
    key: "react-doctor/active-static-asset",
    id: "active-static-asset",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...activeStaticAsset,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(activeStaticAsset.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/activity-wraps-effect-heavy-subtree",
    id: "activity-wraps-effect-heavy-subtree",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...activityWrapsEffectHeavySubtree,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(activityWrapsEffectHeavySubtree.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/advanced-event-handler-refs",
    id: "advanced-event-handler-refs",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...advancedEventHandlerRefs,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(advancedEventHandlerRefs.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/agent-tool-capability-risk",
    id: "agent-tool-capability-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...agentToolCapabilityRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(agentToolCapabilityRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/alt-text",
    id: "alt-text",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...altText,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(altText.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/anchor-ambiguous-text",
    id: "anchor-ambiguous-text",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...anchorAmbiguousText,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(anchorAmbiguousText.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/anchor-has-content",
    id: "anchor-has-content",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...anchorHasContent,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(anchorHasContent.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/anchor-is-valid",
    id: "anchor-is-valid",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...anchorIsValid,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(anchorIsValid.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/aria-activedescendant-has-tabindex",
    id: "aria-activedescendant-has-tabindex",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...ariaActivedescendantHasTabindex,
      framework: "global",
      category: "Accessibility",
      requires: [
        ...new Set<Capability>(["react", ...(ariaActivedescendantHasTabindex.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/aria-props",
    id: "aria-props",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...ariaProps,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(ariaProps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/aria-proptypes",
    id: "aria-proptypes",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...ariaProptypes,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(ariaProptypes.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/aria-role",
    id: "aria-role",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...ariaRole,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(ariaRole.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/aria-unsupported-elements",
    id: "aria-unsupported-elements",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...ariaUnsupportedElements,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(ariaUnsupportedElements.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/artifact-baas-authority-surface",
    id: "artifact-baas-authority-surface",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...artifactBaasAuthoritySurface,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(artifactBaasAuthoritySurface.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/artifact-env-leak",
    id: "artifact-env-leak",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...artifactEnvLeak,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(artifactEnvLeak.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/artifact-secret-leak",
    id: "artifact-secret-leak",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...artifactSecretLeak,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(artifactSecretLeak.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/async-await-in-loop",
    id: "async-await-in-loop",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...asyncDeferAwait,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(asyncDeferAwait.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/async-parallel",
    id: "async-parallel",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...asyncParallel,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/auth-token-in-web-storage",
    id: "auth-token-in-web-storage",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...authTokenInWebStorage,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/autocomplete-valid",
    id: "autocomplete-valid",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...autocompleteValid,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(autocompleteValid.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/build-pipeline-secret-boundary",
    id: "build-pipeline-secret-boundary",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...buildPipelineSecretBoundary,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(buildPipelineSecretBoundary.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/button-has-type",
    id: "button-has-type",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...buttonHasType,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(buttonHasType.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/checked-requires-onchange-or-readonly",
    id: "checked-requires-onchange-or-readonly",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...checkedRequiresOnchangeOrReadonly,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(checkedRequiresOnchangeOrReadonly.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/click-events-have-key-events",
    id: "click-events-have-key-events",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...clickEventsHaveKeyEvents,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(clickEventsHaveKeyEvents.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/clickjacking-redirect-risk",
    id: "clickjacking-redirect-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...clickjackingRedirectRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(clickjackingRedirectRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/client-localstorage-no-version",
    id: "client-localstorage-no-version",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...clientLocalstorageNoVersion,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(clientLocalstorageNoVersion.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/client-passive-event-listeners",
    id: "client-passive-event-listeners",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...clientPassiveEventListeners,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(clientPassiveEventListeners.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/command-execution-input-risk",
    id: "command-execution-input-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...commandExecutionInputRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(commandExecutionInputRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/control-has-associated-label",
    id: "control-has-associated-label",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...controlHasAssociatedLabel,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(controlHasAssociatedLabel.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/cors-cookie-trust-risk",
    id: "cors-cookie-trust-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...corsCookieTrustRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(corsCookieTrustRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/dangerous-html-sink",
    id: "dangerous-html-sink",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...dangerousHtmlSink,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(dangerousHtmlSink.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/design-no-em-dash-in-jsx-text",
    id: "design-no-em-dash-in-jsx-text",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noEmDashInJsxText,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noEmDashInJsxText.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/design-no-redundant-padding-axes",
    id: "design-no-redundant-padding-axes",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noRedundantPaddingAxes,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noRedundantPaddingAxes.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/design-no-redundant-size-axes",
    id: "design-no-redundant-size-axes",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noRedundantSizeAxes,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noRedundantSizeAxes.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/design-no-space-on-flex-children",
    id: "design-no-space-on-flex-children",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noSpaceOnFlexChildren,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noSpaceOnFlexChildren.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/design-no-three-period-ellipsis",
    id: "design-no-three-period-ellipsis",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noThreePeriodEllipsis,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noThreePeriodEllipsis.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/design-no-vague-button-label",
    id: "design-no-vague-button-label",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noVagueButtonLabel,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(noVagueButtonLabel.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/dialog-has-accessible-name",
    id: "dialog-has-accessible-name",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...dialogHasAccessibleName,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(dialogHasAccessibleName.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/display-name",
    id: "display-name",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...displayName,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(displayName.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/effect-needs-cleanup",
    id: "effect-needs-cleanup",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...effectNeedsCleanup,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(effectNeedsCleanup.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/exhaustive-deps",
    id: "exhaustive-deps",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...exhaustiveDeps,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(exhaustiveDeps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/expo-no-non-inlined-env",
    id: "expo-no-non-inlined-env",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...expoNoNonInlinedEnv,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(expoNoNonInlinedEnv.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/firebase-client-owned-authz-field",
    id: "firebase-client-owned-authz-field",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...firebaseClientOwnedAuthzField,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(firebaseClientOwnedAuthzField.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/firebase-permissive-rules",
    id: "firebase-permissive-rules",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...firebasePermissiveRules,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(firebasePermissiveRules.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/firebase-query-filter-as-auth",
    id: "firebase-query-filter-as-auth",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...firebaseQueryFilterAsAuth,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(firebaseQueryFilterAsAuth.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/forbid-component-props",
    id: "forbid-component-props",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...forbidComponentProps,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(forbidComponentProps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/forbid-dom-props",
    id: "forbid-dom-props",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...forbidDomProps,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(forbidDomProps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/forbid-elements",
    id: "forbid-elements",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...forbidElements,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(forbidElements.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/forward-ref-uses-ref",
    id: "forward-ref-uses-ref",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...forwardRefUsesRef,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(forwardRefUsesRef.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/git-provider-url-injection-risk",
    id: "git-provider-url-injection-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...gitProviderUrlInjectionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(gitProviderUrlInjectionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/heading-has-content",
    id: "heading-has-content",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...headingHasContent,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(headingHasContent.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/hook-use-state",
    id: "hook-use-state",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...hookUseState,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(hookUseState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/hooks-no-nan-in-deps",
    id: "hooks-no-nan-in-deps",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...hooksNoNanInDeps,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(hooksNoNanInDeps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/html-has-lang",
    id: "html-has-lang",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...htmlHasLang,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(htmlHasLang.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/html-no-invalid-paragraph-child",
    id: "html-no-invalid-paragraph-child",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...htmlNoInvalidParagraphChild,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/html-no-invalid-table-nesting",
    id: "html-no-invalid-table-nesting",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...htmlNoInvalidTableNesting,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/html-no-nested-interactive",
    id: "html-no-nested-interactive",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...htmlNoNestedInteractive,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/iframe-has-title",
    id: "iframe-has-title",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...iframeHasTitle,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(iframeHasTitle.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/iframe-missing-sandbox",
    id: "iframe-missing-sandbox",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...iframeMissingSandbox,
      framework: "global",
      category: "Security",
      requires: [...new Set<Capability>(["react", ...(iframeMissingSandbox.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/img-redundant-alt",
    id: "img-redundant-alt",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...imgRedundantAlt,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(imgRedundantAlt.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/import-metadata-execution-risk",
    id: "import-metadata-execution-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...importMetadataExecutionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(importMetadataExecutionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/insecure-crypto-risk",
    id: "insecure-crypto-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...insecureCryptoRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(insecureCryptoRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/insecure-session-cookie",
    id: "insecure-session-cookie",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...insecureSessionCookie,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(insecureSessionCookie.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/interactive-supports-focus",
    id: "interactive-supports-focus",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...interactiveSupportsFocus,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(interactiveSupportsFocus.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jotai-derived-atom-returns-fresh-object",
    id: "jotai-derived-atom-returns-fresh-object",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...jotaiDerivedAtomReturnsFreshObject,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(jotaiDerivedAtomReturnsFreshObject.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/jotai-select-atom-in-render-body",
    id: "jotai-select-atom-in-render-body",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...jotaiSelectAtomInRenderBody,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(jotaiSelectAtomInRenderBody.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/jotai-tq-use-raw-query-atom",
    id: "jotai-tq-use-raw-query-atom",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...jotaiTqUseRawQueryAtom,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(jotaiTqUseRawQueryAtom.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/js-async-reduce-without-awaited-acc",
    id: "js-async-reduce-without-awaited-acc",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...jsAsyncReduceWithoutAwaitedAcc,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-batch-dom-css",
    id: "js-batch-dom-css",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...jsxBooleanValue,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxBooleanValue.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-curly-brace-presence",
    id: "jsx-curly-brace-presence",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxCurlyBracePresence,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxCurlyBracePresence.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-filename-extension",
    id: "jsx-filename-extension",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxFilenameExtension,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxFilenameExtension.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-fragments",
    id: "jsx-fragments",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxFragments,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxFragments.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-handler-names",
    id: "jsx-handler-names",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxHandlerNames,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxHandlerNames.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-key",
    id: "jsx-key",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxKey,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(jsxKey.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-max-depth",
    id: "jsx-max-depth",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxMaxDepth,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxMaxDepth.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-comment-textnodes",
    id: "jsx-no-comment-textnodes",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoCommentTextnodes,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(jsxNoCommentTextnodes.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-constructed-context-values",
    id: "jsx-no-constructed-context-values",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoConstructedContextValues,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(jsxNoConstructedContextValues.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/jsx-no-duplicate-props",
    id: "jsx-no-duplicate-props",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoDuplicateProps,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(jsxNoDuplicateProps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-jsx-as-prop",
    id: "jsx-no-jsx-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoJsxAsProp,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(jsxNoJsxAsProp.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-new-array-as-prop",
    id: "jsx-no-new-array-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoNewArrayAsProp,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(jsxNoNewArrayAsProp.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-new-function-as-prop",
    id: "jsx-no-new-function-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoNewFunctionAsProp,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(jsxNoNewFunctionAsProp.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-new-object-as-prop",
    id: "jsx-no-new-object-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoNewObjectAsProp,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(jsxNoNewObjectAsProp.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-script-url",
    id: "jsx-no-script-url",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoScriptUrl,
      framework: "global",
      category: "Security",
      requires: [...new Set<Capability>(["react", ...(jsxNoScriptUrl.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-target-blank",
    id: "jsx-no-target-blank",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoTargetBlank,
      framework: "global",
      category: "Security",
      requires: [...new Set<Capability>(["react", ...(jsxNoTargetBlank.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-undef",
    id: "jsx-no-undef",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoUndef,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(jsxNoUndef.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-no-useless-fragment",
    id: "jsx-no-useless-fragment",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxNoUselessFragment,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxNoUselessFragment.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-pascal-case",
    id: "jsx-pascal-case",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxPascalCase,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxPascalCase.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-props-no-spread-multi",
    id: "jsx-props-no-spread-multi",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxPropsNoSpreadMulti,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(jsxPropsNoSpreadMulti.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jsx-props-no-spreading",
    id: "jsx-props-no-spreading",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...jsxPropsNoSpreading,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(jsxPropsNoSpreading.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/jwt-insecure-verification",
    id: "jwt-insecure-verification",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...jwtInsecureVerification,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(jwtInsecureVerification.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/key-lifecycle-risk",
    id: "key-lifecycle-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...keyLifecycleRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(keyLifecycleRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/label-has-associated-control",
    id: "label-has-associated-control",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...labelHasAssociatedControl,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(labelHasAssociatedControl.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/lang",
    id: "lang",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...lang,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(lang.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/local-rpc-native-bridge-risk",
    id: "local-rpc-native-bridge-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...localRpcNativeBridgeRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(localRpcNativeBridgeRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/mcp-tool-capability-risk",
    id: "mcp-tool-capability-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...mcpToolCapabilityRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(mcpToolCapabilityRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/mdx-ssr-execution-risk",
    id: "mdx-ssr-execution-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...mdxSsrExecutionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(mdxSsrExecutionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/media-has-caption",
    id: "media-has-caption",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...mediaHasCaption,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(mediaHasCaption.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/mouse-events-have-key-events",
    id: "mouse-events-have-key-events",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...mouseEventsHaveKeyEvents,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(mouseEventsHaveKeyEvents.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/nextjs-async-client-component",
    id: "nextjs-async-client-component",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsAsyncClientComponent,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-error-boundary-missing-use-client",
    id: "nextjs-error-boundary-missing-use-client",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsErrorBoundaryMissingUseClient,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-global-error-missing-html-body",
    id: "nextjs-global-error-missing-html-body",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsGlobalErrorMissingHtmlBody,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-image-missing-sizes",
    id: "nextjs-image-missing-sizes",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsImageMissingSizes,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-inline-script-missing-id",
    id: "nextjs-inline-script-missing-id",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsInlineScriptMissingId,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-missing-metadata",
    id: "nextjs-missing-metadata",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsMissingMetadata,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-a-element",
    id: "nextjs-no-a-element",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoAElement,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-client-fetch-for-server-data",
    id: "nextjs-no-client-fetch-for-server-data",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoClientFetchForServerData,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-client-side-redirect",
    id: "nextjs-no-client-side-redirect",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoClientSideRedirect,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-css-link",
    id: "nextjs-no-css-link",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoCssLink,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-default-export-in-route-handler",
    id: "nextjs-no-default-export-in-route-handler",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoDefaultExportInRouteHandler,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-edge-og-runtime",
    id: "nextjs-no-edge-og-runtime",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoEdgeOgRuntime,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-font-link",
    id: "nextjs-no-font-link",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoFontLink,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-google-analytics-script",
    id: "nextjs-no-google-analytics-script",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoGoogleAnalyticsScript,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-head-import",
    id: "nextjs-no-head-import",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoHeadImport,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-img-element",
    id: "nextjs-no-img-element",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoImgElement,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-native-script",
    id: "nextjs-no-native-script",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoNativeScript,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-polyfill-script",
    id: "nextjs-no-polyfill-script",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoPolyfillScript,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-redirect-in-try-catch",
    id: "nextjs-no-redirect-in-try-catch",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoRedirectInTryCatch,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-script-in-head",
    id: "nextjs-no-script-in-head",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoScriptInHead,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-side-effect-in-get-handler",
    id: "nextjs-no-side-effect-in-get-handler",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...nextjsNoUseSearchParamsWithoutSuspense,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/nextjs-no-vercel-og-import",
    id: "nextjs-no-vercel-og-import",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nextjsNoVercelOgImport,
      framework: "nextjs",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-access-key",
    id: "no-access-key",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noAccessKey,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(noAccessKey.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-adjust-state-on-prop-change",
    id: "no-adjust-state-on-prop-change",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noAdjustStateOnPropChange,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noAdjustStateOnPropChange.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-aria-hidden-on-focusable",
    id: "no-aria-hidden-on-focusable",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noAriaHiddenOnFocusable,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(noAriaHiddenOnFocusable.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-array-index-as-key",
    id: "no-array-index-as-key",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noArrayIndexAsKey,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-array-index-key",
    id: "no-array-index-key",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noArrayIndexKey,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noArrayIndexKey.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-async-effect-callback",
    id: "no-async-effect-callback",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noAsyncEffectCallback,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noAsyncEffectCallback.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-autofocus",
    id: "no-autofocus",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noAutofocus,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(noAutofocus.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-barrel-import",
    id: "no-barrel-import",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noBarrelImport,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-call-component-as-function",
    id: "no-call-component-as-function",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noCallComponentAsFunction,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noCallComponentAsFunction.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-cascading-set-state",
    id: "no-cascading-set-state",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noCascadingSetState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noCascadingSetState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-chain-state-updates",
    id: "no-chain-state-updates",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noChainStateUpdates,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noChainStateUpdates.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-children-prop",
    id: "no-children-prop",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noChildrenProp,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noChildrenProp.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-clone-element",
    id: "no-clone-element",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noCloneElement,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noCloneElement.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-create-context-in-render",
    id: "no-create-context-in-render",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noCreateContextInRender,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noCreateContextInRender.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-create-ref-in-function-component",
    id: "no-create-ref-in-function-component",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noCreateRefInFunctionComponent,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(noCreateRefInFunctionComponent.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-create-store-in-render",
    id: "no-create-store-in-render",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noCreateStoreInRender,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noCreateStoreInRender.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-danger",
    id: "no-danger",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noDanger,
      framework: "global",
      category: "Security",
      requires: [...new Set<Capability>(["react", ...(noDanger.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-danger-with-children",
    id: "no-danger-with-children",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noDangerWithChildren,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noDangerWithChildren.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-dark-mode-glow",
    id: "no-dark-mode-glow",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noDarkModeGlow,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-default-props",
    id: "no-default-props",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noDefaultProps,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-derived-state",
    id: "no-derived-state",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noDerivedState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noDerivedState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-derived-state-effect",
    id: "no-derived-state-effect",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noDerivedStateEffect,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noDerivedStateEffect.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-derived-useState",
    id: "no-derived-useState",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noDerivedUseState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noDerivedUseState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-did-mount-set-state",
    id: "no-did-mount-set-state",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noDidMountSetState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noDidMountSetState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-did-update-set-state",
    id: "no-did-update-set-state",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noDidUpdateSetState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noDidUpdateSetState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-direct-mutation-state",
    id: "no-direct-mutation-state",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noDirectMutationState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noDirectMutationState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-direct-state-mutation",
    id: "no-direct-state-mutation",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noDirectStateMutation,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noDirectStateMutation.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-disabled-zoom",
    id: "no-disabled-zoom",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...noDistractingElements,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(noDistractingElements.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-document-start-view-transition",
    id: "no-document-start-view-transition",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noDocumentStartViewTransition,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(noDocumentStartViewTransition.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-document-write",
    id: "no-document-write",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noDocumentWrite,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-dynamic-import-path",
    id: "no-dynamic-import-path",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noDynamicImportPath,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-effect-chain",
    id: "no-effect-chain",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noEffectChain,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noEffectChain.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-effect-event-handler",
    id: "no-effect-event-handler",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noEffectEventHandler,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noEffectEventHandler.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-effect-event-in-deps",
    id: "no-effect-event-in-deps",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noEffectEventInDeps,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noEffectEventInDeps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-effect-with-fresh-deps",
    id: "no-effect-with-fresh-deps",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noEffectWithFreshDeps,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noEffectWithFreshDeps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-eval",
    id: "no-eval",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...noEventHandler,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noEventHandler.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-event-trigger-state",
    id: "no-event-trigger-state",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noEventTriggerState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noEventTriggerState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-fetch-in-effect",
    id: "no-fetch-in-effect",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noFetchInEffect,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noFetchInEffect.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-find-dom-node",
    id: "no-find-dom-node",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noFindDomNode,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noFindDomNode.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-flush-sync",
    id: "no-flush-sync",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noFlushSync,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noFlushSync.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-full-lodash-import",
    id: "no-full-lodash-import",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noFullLodashImport,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-generic-handler-names",
    id: "no-generic-handler-names",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noGenericHandlerNames,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-giant-component",
    id: "no-giant-component",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noGiantComponent,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-global-css-variable-animation",
    id: "no-global-css-variable-animation",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noGlobalCssVariableAnimation,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(noGlobalCssVariableAnimation.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-gradient-text",
    id: "no-gradient-text",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noGradientText,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-gray-on-colored-background",
    id: "no-gray-on-colored-background",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noGrayOnColoredBackground,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-img-lazy-with-high-fetchpriority",
    id: "no-img-lazy-with-high-fetchpriority",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noImgLazyWithHighFetchpriority,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(noImgLazyWithHighFetchpriority.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-initialize-state",
    id: "no-initialize-state",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noInitializeState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noInitializeState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-inline-bounce-easing",
    id: "no-inline-bounce-easing",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...noInlineExhaustiveStyle,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-inline-prop-on-memo-component",
    id: "no-inline-prop-on-memo-component",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noInlinePropOnMemoComponent,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(noInlinePropOnMemoComponent.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-interactive-element-to-noninteractive-role",
    id: "no-interactive-element-to-noninteractive-role",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noInteractiveElementToNoninteractiveRole,
      framework: "global",
      category: "Accessibility",
      requires: [
        ...new Set<Capability>([
          "react",
          ...(noInteractiveElementToNoninteractiveRole.requires ?? []),
        ]),
      ],
    },
  },
  {
    key: "react-doctor/no-is-mounted",
    id: "no-is-mounted",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noIsMounted,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noIsMounted.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-json-parse-stringify-clone",
    id: "no-json-parse-stringify-clone",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noJsonParseStringifyClone,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-jsx-element-type",
    id: "no-jsx-element-type",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noJsxElementType,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-justified-text",
    id: "no-justified-text",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...noLargeAnimatedBlur,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noLargeAnimatedBlur.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-layout-property-animation",
    id: "no-layout-property-animation",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noLayoutPropertyAnimation,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noLayoutPropertyAnimation.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-layout-transition-inline",
    id: "no-layout-transition-inline",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...noLegacyClassLifecycles,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-legacy-context-api",
    id: "no-legacy-context-api",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noLegacyContextApi,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-long-transition-duration",
    id: "no-long-transition-duration",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...noManyBooleanProps,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-mirror-prop-effect",
    id: "no-mirror-prop-effect",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noMirrorPropEffect,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noMirrorPropEffect.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-moment",
    id: "no-moment",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noMoment,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-multi-comp",
    id: "no-multi-comp",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noMultiComp,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noMultiComp.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-mutable-in-deps",
    id: "no-mutable-in-deps",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noMutableInDeps,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noMutableInDeps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-mutating-reducer-state",
    id: "no-mutating-reducer-state",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noMutatingReducerState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noMutatingReducerState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-namespace",
    id: "no-namespace",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noNamespace,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noNamespace.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-nested-component-definition",
    id: "no-nested-component-definition",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noNestedComponentDefinition,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-noninteractive-element-interactions",
    id: "no-noninteractive-element-interactions",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noNoninteractiveElementInteractions,
      framework: "global",
      category: "Accessibility",
      requires: [
        ...new Set<Capability>(["react", ...(noNoninteractiveElementInteractions.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-noninteractive-element-to-interactive-role",
    id: "no-noninteractive-element-to-interactive-role",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noNoninteractiveElementToInteractiveRole,
      framework: "global",
      category: "Accessibility",
      requires: [
        ...new Set<Capability>([
          "react",
          ...(noNoninteractiveElementToInteractiveRole.requires ?? []),
        ]),
      ],
    },
  },
  {
    key: "react-doctor/no-noninteractive-tabindex",
    id: "no-noninteractive-tabindex",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noNoninteractiveTabindex,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(noNoninteractiveTabindex.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-outline-none",
    id: "no-outline-none",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...noPassDataToParent,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noPassDataToParent.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-pass-live-state-to-parent",
    id: "no-pass-live-state-to-parent",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noPassLiveStateToParent,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noPassLiveStateToParent.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-permanent-will-change",
    id: "no-permanent-will-change",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noPermanentWillChange,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noPermanentWillChange.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-polymorphic-children",
    id: "no-polymorphic-children",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noPolymorphicChildren,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-prevent-default",
    id: "no-prevent-default",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noPreventDefault,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-prop-callback-in-effect",
    id: "no-prop-callback-in-effect",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noPropCallbackInEffect,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noPropCallbackInEffect.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-prop-types",
    id: "no-prop-types",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noPropTypes,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-pure-black-background",
    id: "no-pure-black-background",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noPureBlackBackground,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-random-key",
    id: "no-random-key",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noRandomKey,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-react-children",
    id: "no-react-children",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noReactChildren,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noReactChildren.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-react-dom-deprecated-apis",
    id: "no-react-dom-deprecated-apis",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noReactDomDeprecatedApis,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-react19-deprecated-apis",
    id: "no-react19-deprecated-apis",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noReact19DeprecatedApis,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-redundant-roles",
    id: "no-redundant-roles",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noRedundantRoles,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(noRedundantRoles.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-redundant-should-component-update",
    id: "no-redundant-should-component-update",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noRedundantShouldComponentUpdate,
      framework: "global",
      category: "Maintainability",
      requires: [
        ...new Set<Capability>(["react", ...(noRedundantShouldComponentUpdate.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-render-in-render",
    id: "no-render-in-render",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noRenderInRender,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-render-prop-children",
    id: "no-render-prop-children",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noRenderPropChildren,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-render-return-value",
    id: "no-render-return-value",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noRenderReturnValue,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noRenderReturnValue.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-reset-all-state-on-prop-change",
    id: "no-reset-all-state-on-prop-change",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noResetAllStateOnPropChange,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(noResetAllStateOnPropChange.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-scale-from-zero",
    id: "no-scale-from-zero",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noScaleFromZero,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noScaleFromZero.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-secrets-in-client-code",
    id: "no-secrets-in-client-code",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noSecretsInClientCode,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/no-self-updating-effect",
    id: "no-self-updating-effect",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noSelfUpdatingEffect,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noSelfUpdatingEffect.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-set-state",
    id: "no-set-state",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noSetState,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(noSetState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-set-state-in-render",
    id: "no-set-state-in-render",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noSetStateInRender,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noSetStateInRender.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-side-tab-border",
    id: "no-side-tab-border",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noSideTabBorder,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-static-element-interactions",
    id: "no-static-element-interactions",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noStaticElementInteractions,
      framework: "global",
      category: "Accessibility",
      requires: [
        ...new Set<Capability>(["react", ...(noStaticElementInteractions.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-string-false-on-boolean-attribute",
    id: "no-string-false-on-boolean-attribute",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noStringFalseOnBooleanAttribute,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(noStringFalseOnBooleanAttribute.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/no-string-refs",
    id: "no-string-refs",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noStringRefs,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noStringRefs.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-sync-xhr",
    id: "no-sync-xhr",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noSyncXhr,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-this-in-sfc",
    id: "no-this-in-sfc",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noThisInSfc,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noThisInSfc.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-tiny-text",
    id: "no-tiny-text",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...noTransitionAll,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noTransitionAll.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-uncontrolled-input",
    id: "no-uncontrolled-input",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noUncontrolledInput,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/no-undeferred-third-party",
    id: "no-undeferred-third-party",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noUndeferredThirdParty,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-unescaped-entities",
    id: "no-unescaped-entities",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noUnescapedEntities,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noUnescapedEntities.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-unknown-property",
    id: "no-unknown-property",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noUnknownProperty,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noUnknownProperty.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-unsafe",
    id: "no-unsafe",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noUnsafe,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noUnsafe.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-unstable-nested-components",
    id: "no-unstable-nested-components",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noUnstableNestedComponents,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noUnstableNestedComponents.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-usememo-simple-expression",
    id: "no-usememo-simple-expression",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noUsememoSimpleExpression,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(noUsememoSimpleExpression.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-wide-letter-spacing",
    id: "no-wide-letter-spacing",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noWideLetterSpacing,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/no-will-update-set-state",
    id: "no-will-update-set-state",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...noWillUpdateSetState,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(noWillUpdateSetState.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/no-z-index-9999",
    id: "no-z-index-9999",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...noZIndex9999,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/nosql-injection-risk",
    id: "nosql-injection-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...nosqlInjectionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(nosqlInjectionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/only-export-components",
    id: "only-export-components",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...onlyExportComponents,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(onlyExportComponents.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/package-metadata-secret",
    id: "package-metadata-secret",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...packageMetadataSecret,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(packageMetadataSecret.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/path-traversal-risk",
    id: "path-traversal-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...pathTraversalRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(pathTraversalRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/plugin-update-trust-risk",
    id: "plugin-update-trust-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...pluginUpdateTrustRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(pluginUpdateTrustRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/postmessage-origin-risk",
    id: "postmessage-origin-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...postmessageOriginRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(postmessageOriginRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/preact-no-children-length",
    id: "preact-no-children-length",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preactNoChildrenLength,
      framework: "preact",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/preact-no-react-hooks-import",
    id: "preact-no-react-hooks-import",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preactNoReactHooksImport,
      framework: "preact",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/preact-no-render-arguments",
    id: "preact-no-render-arguments",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preactNoRenderArguments,
      framework: "preact",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/preact-prefer-ondblclick",
    id: "preact-prefer-ondblclick",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preactPreferOndblclick,
      framework: "preact",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/preact-prefer-oninput",
    id: "preact-prefer-oninput",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preactPreferOninput,
      framework: "preact",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/prefer-dynamic-import",
    id: "prefer-dynamic-import",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferDynamicImport,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/prefer-es6-class",
    id: "prefer-es6-class",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...preferEs6Class,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(preferEs6Class.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/prefer-explicit-variants",
    id: "prefer-explicit-variants",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferExplicitVariants,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/prefer-function-component",
    id: "prefer-function-component",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...preferFunctionComponent,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(preferFunctionComponent.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/prefer-html-dialog",
    id: "prefer-html-dialog",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferHtmlDialog,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(preferHtmlDialog.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/prefer-module-scope-pure-function",
    id: "prefer-module-scope-pure-function",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferModuleScopePureFunction,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/prefer-module-scope-static-value",
    id: "prefer-module-scope-static-value",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferModuleScopeStaticValue,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/prefer-stable-empty-fallback",
    id: "prefer-stable-empty-fallback",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferStableEmptyFallback,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(preferStableEmptyFallback.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/prefer-tag-over-role",
    id: "prefer-tag-over-role",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...preferTagOverRole,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(preferTagOverRole.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/prefer-use-effect-event",
    id: "prefer-use-effect-event",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferUseEffectEvent,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(preferUseEffectEvent.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/prefer-use-sync-external-store",
    id: "prefer-use-sync-external-store",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferUseSyncExternalStore,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(preferUseSyncExternalStore.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/prefer-useReducer",
    id: "prefer-useReducer",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...preferUseReducer,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(preferUseReducer.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/public-debug-artifact",
    id: "public-debug-artifact",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...publicDebugArtifact,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(publicDebugArtifact.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/public-env-secret-name",
    id: "public-env-secret-name",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...publicEnvSecretName,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(publicEnvSecretName.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/query-destructure-result",
    id: "query-destructure-result",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...queryDestructureResult,
      framework: "tanstack-query",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/query-mutation-missing-invalidation",
    id: "query-mutation-missing-invalidation",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...queryMutationMissingInvalidation,
      framework: "tanstack-query",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/query-no-query-in-effect",
    id: "query-no-query-in-effect",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...queryNoQueryInEffect,
      framework: "tanstack-query",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/query-no-rest-destructuring",
    id: "query-no-rest-destructuring",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...queryNoRestDestructuring,
      framework: "tanstack-query",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/query-no-usequery-for-mutation",
    id: "query-no-usequery-for-mutation",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...queryNoUseQueryForMutation,
      framework: "tanstack-query",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/query-no-void-query-fn",
    id: "query-no-void-query-fn",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...queryNoVoidQueryFn,
      framework: "tanstack-query",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/query-stable-query-client",
    id: "query-stable-query-client",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...queryStableQueryClient,
      framework: "tanstack-query",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/raw-sql-injection-risk",
    id: "raw-sql-injection-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rawSqlInjectionRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(rawSqlInjectionRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/react-compiler-no-manual-memoization",
    id: "react-compiler-no-manual-memoization",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...reactCompilerNoManualMemoization,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/react-in-jsx-scope",
    id: "react-in-jsx-scope",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...reactInJsxScope,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(reactInJsxScope.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/redux-useselector-inline-derivation",
    id: "redux-useselector-inline-derivation",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...reduxUseselectorInlineDerivation,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(reduxUseselectorInlineDerivation.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/redux-useselector-returns-new-collection",
    id: "redux-useselector-returns-new-collection",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...reduxUseselectorReturnsNewCollection,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(reduxUseselectorReturnsNewCollection.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/rendering-animate-svg-wrapper",
    id: "rendering-animate-svg-wrapper",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...renderingAnimateSvgWrapper,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(renderingAnimateSvgWrapper.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rendering-conditional-render",
    id: "rendering-conditional-render",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...renderingConditionalRender,
      framework: "global",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/rendering-hoist-jsx",
    id: "rendering-hoist-jsx",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...renderingHoistJsx,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(renderingHoistJsx.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rendering-hydration-mismatch-time",
    id: "rendering-hydration-mismatch-time",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...renderingHydrationMismatchTime,
      framework: "global",
      category: "Bugs",
      requires: [
        ...new Set<Capability>(["react", ...(renderingHydrationMismatchTime.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/rendering-hydration-no-flicker",
    id: "rendering-hydration-no-flicker",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...renderingHydrationNoFlicker,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(renderingHydrationNoFlicker.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/rendering-script-defer-async",
    id: "rendering-script-defer-async",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...renderingScriptDeferAsync,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(renderingScriptDeferAsync.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rendering-svg-precision",
    id: "rendering-svg-precision",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...renderingUsetransitionLoading,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(renderingUsetransitionLoading.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/repository-secret-file",
    id: "repository-secret-file",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...repositorySecretFile,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(repositorySecretFile.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/request-body-mass-assignment",
    id: "request-body-mass-assignment",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...requestBodyMassAssignment,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(requestBodyMassAssignment.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/require-render-return",
    id: "require-render-return",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...requireRenderReturn,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(requireRenderReturn.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rerender-defer-reads-hook",
    id: "rerender-defer-reads-hook",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderDeferReadsHook,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(rerenderDeferReadsHook.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rerender-dependencies",
    id: "rerender-dependencies",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderDependencies,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(rerenderDependencies.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rerender-derived-state-from-hook",
    id: "rerender-derived-state-from-hook",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderDerivedStateFromHook,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(rerenderDerivedStateFromHook.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/rerender-functional-setstate",
    id: "rerender-functional-setstate",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderFunctionalSetstate,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(rerenderFunctionalSetstate.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rerender-lazy-ref-init",
    id: "rerender-lazy-ref-init",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderLazyRefInit,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(rerenderLazyRefInit.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rerender-lazy-state-init",
    id: "rerender-lazy-state-init",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderLazyStateInit,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(rerenderLazyStateInit.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rerender-memo-before-early-return",
    id: "rerender-memo-before-early-return",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderMemoBeforeEarlyReturn,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(rerenderMemoBeforeEarlyReturn.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/rerender-memo-with-default-value",
    id: "rerender-memo-with-default-value",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderMemoWithDefaultValue,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(rerenderMemoWithDefaultValue.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/rerender-state-only-in-handlers",
    id: "rerender-state-only-in-handlers",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderStateOnlyInHandlers,
      framework: "global",
      category: "Performance",
      requires: [
        ...new Set<Capability>(["react", ...(rerenderStateOnlyInHandlers.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/rerender-transitions-scroll",
    id: "rerender-transitions-scroll",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rerenderTransitionsScroll,
      framework: "global",
      category: "Performance",
      requires: [...new Set<Capability>(["react", ...(rerenderTransitionsScroll.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-animate-layout-property",
    id: "rn-animate-layout-property",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnAnimateLayoutProperty,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnAnimateLayoutProperty.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-animation-reaction-as-derived",
    id: "rn-animation-reaction-as-derived",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnAnimationReactionAsDerived,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnAnimationReactionAsDerived.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-bottom-sheet-prefer-native",
    id: "rn-bottom-sheet-prefer-native",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnBottomSheetPreferNative,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnBottomSheetPreferNative.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-detox-missing-await",
    id: "rn-detox-missing-await",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnDetoxMissingAwait,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnDetoxMissingAwait.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-list-callback-per-row",
    id: "rn-list-callback-per-row",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnListCallbackPerRow,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnListCallbackPerRow.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-list-data-mapped",
    id: "rn-list-data-mapped",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnListDataMapped,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnListDataMapped.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-list-missing-estimated-item-size",
    id: "rn-list-missing-estimated-item-size",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnListMissingEstimatedItemSize,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnListMissingEstimatedItemSize.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-list-recyclable-without-types",
    id: "rn-list-recyclable-without-types",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnListRecyclableWithoutTypes,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnListRecyclableWithoutTypes.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-deep-imports",
    id: "rn-no-deep-imports",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoDeepImports,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoDeepImports.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-deprecated-modules",
    id: "rn-no-deprecated-modules",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoDeprecatedModules,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoDeprecatedModules.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-dimensions-get",
    id: "rn-no-dimensions-get",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoDimensionsGet,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoDimensionsGet.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-falsy-and-render",
    id: "rn-no-falsy-and-render",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoFalsyAndRender,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoFalsyAndRender.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-image-children",
    id: "rn-no-image-children",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoImageChildren,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoImageChildren.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-inline-flatlist-renderitem",
    id: "rn-no-inline-flatlist-renderitem",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoInlineFlatlistRenderitem,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoInlineFlatlistRenderitem.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-inline-object-in-list-item",
    id: "rn-no-inline-object-in-list-item",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoInlineObjectInListItem,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoInlineObjectInListItem.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-legacy-expo-packages",
    id: "rn-no-legacy-expo-packages",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoLegacyExpoPackages,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoLegacyExpoPackages.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-legacy-shadow-styles",
    id: "rn-no-legacy-shadow-styles",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoLegacyShadowStyles,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoLegacyShadowStyles.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-non-native-navigator",
    id: "rn-no-non-native-navigator",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoNonNativeNavigator,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoNonNativeNavigator.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-panresponder",
    id: "rn-no-panresponder",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoPanresponder,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoPanresponder.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-raw-text",
    id: "rn-no-raw-text",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoRawText,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoRawText.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-renderitem-key",
    id: "rn-no-renderitem-key",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoRenderitemKey,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoRenderitemKey.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-scroll-state",
    id: "rn-no-scroll-state",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoScrollState,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoScrollState.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-scrollview-mapped-list",
    id: "rn-no-scrollview-mapped-list",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoScrollviewMappedList,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoScrollviewMappedList.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-set-native-props",
    id: "rn-no-set-native-props",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoSetNativeProps,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoSetNativeProps.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-no-single-element-style-array",
    id: "rn-no-single-element-style-array",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnNoSingleElementStyleArray,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnNoSingleElementStyleArray.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-content-inset-adjustment",
    id: "rn-prefer-content-inset-adjustment",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnPreferContentInsetAdjustment,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnPreferContentInsetAdjustment.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-expo-image",
    id: "rn-prefer-expo-image",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnPreferExpoImage,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnPreferExpoImage.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-pressable",
    id: "rn-prefer-pressable",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnPreferPressable,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnPreferPressable.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-pressable-over-gesture-detector",
    id: "rn-prefer-pressable-over-gesture-detector",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnPreferPressableOverGestureDetector,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnPreferPressableOverGestureDetector.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-prefer-reanimated",
    id: "rn-prefer-reanimated",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnPreferReanimated,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnPreferReanimated.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-pressable-shared-value-mutation",
    id: "rn-pressable-shared-value-mutation",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnPressableSharedValueMutation,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnPressableSharedValueMutation.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-scrollview-dynamic-padding",
    id: "rn-scrollview-dynamic-padding",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnScrollviewDynamicPadding,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnScrollviewDynamicPadding.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-scrollview-flex-in-content-container",
    id: "rn-scrollview-flex-in-content-container",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnScrollviewFlexInContentContainer,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnScrollviewFlexInContentContainer.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/rn-style-prefer-boxshadow",
    id: "rn-style-prefer-boxshadow",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...rnStylePreferBoxShadow,
      framework: "react-native",
      category: "Bugs",
      tags: [...new Set(["react-native", ...(rnStylePreferBoxShadow.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/role-has-required-aria-props",
    id: "role-has-required-aria-props",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...roleHasRequiredAriaProps,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(roleHasRequiredAriaProps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/role-supports-aria-props",
    id: "role-supports-aria-props",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...roleSupportsAriaProps,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(roleSupportsAriaProps.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/rules-of-hooks",
    id: "rules-of-hooks",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...rulesOfHooks,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(rulesOfHooks.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/scope",
    id: "scope",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...scope,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(scope.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/secret-in-fallback",
    id: "secret-in-fallback",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...secretInFallback,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(secretInFallback.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/self-closing-comp",
    id: "self-closing-comp",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...selfClosingComp,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(selfClosingComp.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/server-after-nonblocking",
    id: "server-after-nonblocking",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...serverAfterNonblocking,
      framework: "global",
      category: "Bugs",
      tags: [...new Set(["server-action", ...(serverAfterNonblocking.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-auth-actions",
    id: "server-auth-actions",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...serverAuthActions,
      framework: "global",
      category: "Bugs",
      tags: [...new Set(["server-action", ...(serverAuthActions.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-cache-with-object-literal",
    id: "server-cache-with-object-literal",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...serverCacheWithObjectLiteral,
      framework: "global",
      category: "Bugs",
      tags: [...new Set(["server-action", ...(serverCacheWithObjectLiteral.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-dedup-props",
    id: "server-dedup-props",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...serverDedupProps,
      framework: "global",
      category: "Bugs",
      tags: [...new Set(["server-action", ...(serverDedupProps.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-fetch-without-revalidate",
    id: "server-fetch-without-revalidate",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...serverFetchWithoutRevalidate,
      framework: "global",
      category: "Bugs",
      tags: [...new Set(["server-action", ...(serverFetchWithoutRevalidate.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-hoist-static-io",
    id: "server-hoist-static-io",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...serverHoistStaticIo,
      framework: "global",
      category: "Bugs",
      tags: [...new Set(["server-action", ...(serverHoistStaticIo.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-no-mutable-module-state",
    id: "server-no-mutable-module-state",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...serverNoMutableModuleState,
      framework: "global",
      category: "Bugs",
      tags: [...new Set(["server-action", ...(serverNoMutableModuleState.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-sequential-independent-await",
    id: "server-sequential-independent-await",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...serverSequentialIndependentAwait,
      framework: "global",
      category: "Bugs",
      tags: [...new Set(["server-action", ...(serverSequentialIndependentAwait.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/state-in-constructor",
    id: "state-in-constructor",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...stateInConstructor,
      framework: "global",
      category: "Maintainability",
      requires: [...new Set<Capability>(["react", ...(stateInConstructor.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/style-prop-object",
    id: "style-prop-object",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...stylePropObject,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(stylePropObject.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/supabase-client-owned-authz-field",
    id: "supabase-client-owned-authz-field",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...supabaseClientOwnedAuthzField,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(supabaseClientOwnedAuthzField.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/supabase-rls-policy-risk",
    id: "supabase-rls-policy-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...supabaseRlsPolicyRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(supabaseRlsPolicyRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/supabase-table-missing-rls",
    id: "supabase-table-missing-rls",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...supabaseTableMissingRls,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(supabaseTableMissingRls.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/svg-filter-clickjacking-risk",
    id: "svg-filter-clickjacking-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...svgFilterClickjackingRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(svgFilterClickjackingRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/tabindex-no-positive",
    id: "tabindex-no-positive",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...tabindexNoPositive,
      framework: "global",
      category: "Accessibility",
      requires: [...new Set<Capability>(["react", ...(tabindexNoPositive.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/tanstack-start-get-mutation",
    id: "tanstack-start-get-mutation",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...tanstackStartMissingHeadContent,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-anchor-element",
    id: "tanstack-start-no-anchor-element",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartNoAnchorElement,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-direct-fetch-in-loader",
    id: "tanstack-start-no-direct-fetch-in-loader",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartNoDirectFetchInLoader,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-dynamic-server-fn-import",
    id: "tanstack-start-no-dynamic-server-fn-import",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartNoDynamicServerFnImport,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-navigate-in-render",
    id: "tanstack-start-no-navigate-in-render",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartNoNavigateInRender,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-secrets-in-loader",
    id: "tanstack-start-no-secrets-in-loader",
    source: "react-doctor",
    originallyExternal: false,
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
    rule: {
      ...tanstackStartNoUseServerInHandler,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-no-useeffect-fetch",
    id: "tanstack-start-no-useeffect-fetch",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartNoUseEffectFetch,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-redirect-in-try-catch",
    id: "tanstack-start-redirect-in-try-catch",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartRedirectInTryCatch,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-route-property-order",
    id: "tanstack-start-route-property-order",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartRoutePropertyOrder,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-server-fn-method-order",
    id: "tanstack-start-server-fn-method-order",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartServerFnMethodOrder,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tanstack-start-server-fn-validate-input",
    id: "tanstack-start-server-fn-validate-input",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tanstackStartServerFnValidateInput,
      framework: "tanstack-start",
      category: "Bugs",
    },
  },
  {
    key: "react-doctor/tenant-static-proxy-risk",
    id: "tenant-static-proxy-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...tenantStaticProxyRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(tenantStaticProxyRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/unsafe-json-in-html",
    id: "unsafe-json-in-html",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...unsafeJsonInHtml,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(unsafeJsonInHtml.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/untrusted-redirect-following",
    id: "untrusted-redirect-following",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...untrustedRedirectFollowing,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(untrustedRedirectFollowing.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/url-prefilled-privileged-action",
    id: "url-prefilled-privileged-action",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...urlPrefilledPrivilegedAction,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(urlPrefilledPrivilegedAction.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/use-lazy-motion",
    id: "use-lazy-motion",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...useLazyMotion,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/void-dom-elements-no-children",
    id: "void-dom-elements-no-children",
    source: "react-doctor",
    originallyExternal: true,
    rule: {
      ...voidDomElementsNoChildren,
      framework: "global",
      category: "Bugs",
      requires: [...new Set<Capability>(["react", ...(voidDomElementsNoChildren.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/webhook-signature-risk",
    id: "webhook-signature-risk",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...webhookSignatureRisk,
      framework: "global",
      category: "Security",
      tags: [...new Set(["security-scan", ...(webhookSignatureRisk.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/zod-v4-no-deprecated-error-apis",
    id: "zod-v4-no-deprecated-error-apis",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...zodV4NoDeprecatedErrorApis,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/zod-v4-no-deprecated-error-customization",
    id: "zod-v4-no-deprecated-error-customization",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...zodV4NoDeprecatedErrorCustomization,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/zod-v4-no-deprecated-schema-apis",
    id: "zod-v4-no-deprecated-schema-apis",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...zodV4NoDeprecatedSchemaApis,
      framework: "global",
      category: "Maintainability",
    },
  },
  {
    key: "react-doctor/zod-v4-prefer-top-level-string-formats",
    id: "zod-v4-prefer-top-level-string-formats",
    source: "react-doctor",
    originallyExternal: false,
    rule: {
      ...zodV4PreferTopLevelStringFormats,
      framework: "global",
      category: "Maintainability",
    },
  },
] as const;

export const ruleRegistry: Record<string, Rule> = Object.fromEntries(
  reactDoctorRules.map((rule) => [rule.id, rule.rule]),
);
