import {
  noGiantComponent,
  noNestedComponentDefinition,
  noRenderInRender,
} from "./rules/architecture.js";
import {
  noBarrelImport,
  noFullLodashImport,
  noMoment,
  noUndeferredThirdParty,
  preferDynamicImport,
  useLazyMotion,
} from "./rules/bundle-size.js";
import { clientPassiveEventListeners } from "./rules/client.js";
import {
  noArrayIndexAsKey,
  noPreventDefault,
  renderingConditionalRender,
} from "./rules/correctness.js";
import {
  asyncParallel,
  jsBatchDomCss,
  jsCacheStorage,
  jsCombineIterations,
  jsEarlyExit,
  jsHoistRegexp,
  jsIndexMaps,
  jsMinMaxLoop,
  jsSetMapLookups,
  jsTosortedImmutable,
} from "./rules/js-performance.js";
import {
  nextjsAsyncClientComponent,
  nextjsImageMissingSizes,
  nextjsInlineScriptMissingId,
  nextjsMissingMetadata,
  nextjsNoAElement,
  nextjsNoClientFetchForServerData,
  nextjsNoClientSideRedirect,
  nextjsNoCssLink,
  nextjsNoFontLink,
  nextjsNoHeadImport,
  nextjsNoImgElement,
  nextjsNoNativeScript,
  nextjsNoPolyfillScript,
  nextjsNoRedirectInTryCatch,
  nextjsNoSideEffectInGetHandler,
  nextjsNoUseSearchParamsWithoutSuspense,
} from "./rules/nextjs.js";
import {
  noGlobalCssVariableAnimation,
  noLargeAnimatedBlur,
  noLayoutPropertyAnimation,
  noPermanentWillChange,
  noScaleFromZero,
  noTransitionAll,
  noUsememoSimpleExpression,
  renderingAnimateSvgWrapper,
  noInlinePropOnMemoComponent,
  renderingHydrationNoFlicker,
  rerenderMemoWithDefaultValue,
} from "./rules/performance.js";
import {
  rnNoRawText,
  rnNoDeprecatedModules,
  rnNoLegacyExpoPackages,
  rnNoDimensionsGet,
  rnNoInlineFlatlistRenderitem,
  rnNoLegacyShadowStyles,
  rnPreferReanimated,
  rnNoSingleElementStyleArray,
} from "./rules/react-native.js";
import { noEval, noSecretsInClientCode } from "./rules/security.js";
import { serverAfterNonblocking, serverAuthActions } from "./rules/server.js";
import {
  noCascadingSetState,
  noDerivedStateEffect,
  noDerivedUseState,
  noEffectEventHandler,
  noFetchInEffect,
  preferUseReducer,
  rerenderDependencies,
  rerenderFunctionalSetstate,
  rerenderLazyStateInit,
} from "./rules/state-and-effects.js";
import type { RulePlugin } from "./types.js";

const plugin: RulePlugin = {
  meta: { name: "react-doctor" },
  rules: {
    "no-derived-state-effect": noDerivedStateEffect,
    "no-fetch-in-effect": noFetchInEffect,
    "no-cascading-set-state": noCascadingSetState,
    "no-effect-event-handler": noEffectEventHandler,
    "no-derived-useState": noDerivedUseState,
    "prefer-useReducer": preferUseReducer,
    "rerender-lazy-state-init": rerenderLazyStateInit,
    "rerender-functional-setstate": rerenderFunctionalSetstate,
    "rerender-dependencies": rerenderDependencies,

    "no-giant-component": noGiantComponent,
    "no-render-in-render": noRenderInRender,
    "no-nested-component-definition": noNestedComponentDefinition,

    "no-usememo-simple-expression": noUsememoSimpleExpression,
    "no-layout-property-animation": noLayoutPropertyAnimation,
    "rerender-memo-with-default-value": rerenderMemoWithDefaultValue,
    "rendering-animate-svg-wrapper": renderingAnimateSvgWrapper,
    "no-inline-prop-on-memo-component": noInlinePropOnMemoComponent,
    "rendering-hydration-no-flicker": renderingHydrationNoFlicker,

    "no-transition-all": noTransitionAll,
    "no-global-css-variable-animation": noGlobalCssVariableAnimation,
    "no-large-animated-blur": noLargeAnimatedBlur,
    "no-scale-from-zero": noScaleFromZero,
    "no-permanent-will-change": noPermanentWillChange,

    "no-eval": noEval,
    "no-secrets-in-client-code": noSecretsInClientCode,

    "no-barrel-import": noBarrelImport,
    "no-full-lodash-import": noFullLodashImport,
    "no-moment": noMoment,
    "prefer-dynamic-import": preferDynamicImport,
    "use-lazy-motion": useLazyMotion,
    "no-undeferred-third-party": noUndeferredThirdParty,

    "no-array-index-as-key": noArrayIndexAsKey,
    "rendering-conditional-render": renderingConditionalRender,
    "no-prevent-default": noPreventDefault,

    "nextjs-no-img-element": nextjsNoImgElement,
    "nextjs-async-client-component": nextjsAsyncClientComponent,
    "nextjs-no-a-element": nextjsNoAElement,
    "nextjs-no-use-search-params-without-suspense": nextjsNoUseSearchParamsWithoutSuspense,
    "nextjs-no-client-fetch-for-server-data": nextjsNoClientFetchForServerData,
    "nextjs-missing-metadata": nextjsMissingMetadata,
    "nextjs-no-client-side-redirect": nextjsNoClientSideRedirect,
    "nextjs-no-redirect-in-try-catch": nextjsNoRedirectInTryCatch,
    "nextjs-image-missing-sizes": nextjsImageMissingSizes,
    "nextjs-no-native-script": nextjsNoNativeScript,
    "nextjs-inline-script-missing-id": nextjsInlineScriptMissingId,
    "nextjs-no-font-link": nextjsNoFontLink,
    "nextjs-no-css-link": nextjsNoCssLink,
    "nextjs-no-polyfill-script": nextjsNoPolyfillScript,
    "nextjs-no-head-import": nextjsNoHeadImport,
    "nextjs-no-side-effect-in-get-handler": nextjsNoSideEffectInGetHandler,

    "server-auth-actions": serverAuthActions,
    "server-after-nonblocking": serverAfterNonblocking,

    "client-passive-event-listeners": clientPassiveEventListeners,

    "js-combine-iterations": jsCombineIterations,
    "js-tosorted-immutable": jsTosortedImmutable,
    "js-hoist-regexp": jsHoistRegexp,
    "js-min-max-loop": jsMinMaxLoop,
    "js-set-map-lookups": jsSetMapLookups,
    "js-batch-dom-css": jsBatchDomCss,
    "js-index-maps": jsIndexMaps,
    "js-cache-storage": jsCacheStorage,
    "js-early-exit": jsEarlyExit,
    "async-parallel": asyncParallel,

    "rn-no-raw-text": rnNoRawText,
    "rn-no-deprecated-modules": rnNoDeprecatedModules,
    "rn-no-legacy-expo-packages": rnNoLegacyExpoPackages,
    "rn-no-dimensions-get": rnNoDimensionsGet,
    "rn-no-inline-flatlist-renderitem": rnNoInlineFlatlistRenderitem,
    "rn-no-legacy-shadow-styles": rnNoLegacyShadowStyles,
    "rn-prefer-reanimated": rnPreferReanimated,
    "rn-no-single-element-style-array": rnNoSingleElementStyleArray,
  },
};

export default plugin;
