// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { asyncDeferAwait } from "./../rules/performance/async-defer-await.js";
import { noGlobalCssVariableAnimation } from "./../rules/performance/no-global-css-variable-animation.js";
import { noInlinePropOnMemoComponent } from "./../rules/performance/no-inline-prop-on-memo-component.js";
import { noLargeAnimatedBlur } from "./../rules/performance/no-large-animated-blur.js";
import { noLayoutPropertyAnimation } from "./../rules/performance/no-layout-property-animation.js";
import { noPermanentWillChange } from "./../rules/performance/no-permanent-will-change.js";
import { noScaleFromZero } from "./../rules/performance/no-scale-from-zero.js";
import { noTransitionAll } from "./../rules/performance/no-transition-all.js";
import { noUsememoSimpleExpression } from "./../rules/performance/no-usememo-simple-expression.js";
import { renderingAnimateSvgWrapper } from "./../rules/performance/rendering-animate-svg-wrapper.js";
import { renderingHoistJsx } from "./../rules/performance/rendering-hoist-jsx.js";
import { renderingHydrationMismatchTime } from "./../rules/performance/rendering-hydration-mismatch-time.js";
import { renderingHydrationNoFlicker } from "./../rules/performance/rendering-hydration-no-flicker.js";
import { renderingScriptDeferAsync } from "./../rules/performance/rendering-script-defer-async.js";
import { renderingUsetransitionLoading } from "./../rules/performance/rendering-usetransition-loading.js";
import { rerenderDerivedStateFromHook } from "./../rules/performance/rerender-derived-state-from-hook.js";
import { rerenderMemoBeforeEarlyReturn } from "./../rules/performance/rerender-memo-before-early-return.js";
import { rerenderMemoWithDefaultValue } from "./../rules/performance/rerender-memo-with-default-value.js";
import { rerenderTransitionsScroll } from "./../rules/performance/rerender-transitions-scroll.js";

export const PerformanceRuleEntries = [
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
] as const;
