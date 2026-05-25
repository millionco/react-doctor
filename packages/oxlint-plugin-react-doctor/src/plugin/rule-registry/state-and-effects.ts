// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { advancedEventHandlerRefs } from "./../rules/state-and-effects/advanced-event-handler-refs.js";
import { effectNeedsCleanup } from "./../rules/state-and-effects/effect-needs-cleanup.js";
import { noAdjustStateOnPropChange } from "./../rules/state-and-effects/no-adjust-state-on-prop-change.js";
import { noCascadingSetState } from "./../rules/state-and-effects/no-cascading-set-state.js";
import { noChainStateUpdates } from "./../rules/state-and-effects/no-chain-state-updates.js";
import { noDerivedState } from "./../rules/state-and-effects/no-derived-state.js";
import { noDerivedStateEffect } from "./../rules/state-and-effects/no-derived-state-effect.js";
import { noDerivedUseState } from "./../rules/state-and-effects/no-derived-use-state.js";
import { noDirectStateMutation } from "./../rules/state-and-effects/no-direct-state-mutation.js";
import { noEffectChain } from "./../rules/state-and-effects/no-effect-chain.js";
import { noEffectEventHandler } from "./../rules/state-and-effects/no-effect-event-handler.js";
import { noEffectEventInDeps } from "./../rules/state-and-effects/no-effect-event-in-deps.js";
import { noEventHandler } from "./../rules/state-and-effects/no-event-handler.js";
import { noEventTriggerState } from "./../rules/state-and-effects/no-event-trigger-state.js";
import { noFetchInEffect } from "./../rules/state-and-effects/no-fetch-in-effect.js";
import { noInitializeState } from "./../rules/state-and-effects/no-initialize-state.js";
import { noMirrorPropEffect } from "./../rules/state-and-effects/no-mirror-prop-effect.js";
import { noMutableInDeps } from "./../rules/state-and-effects/no-mutable-in-deps.js";
import { noPassDataToParent } from "./../rules/state-and-effects/no-pass-data-to-parent.js";
import { noPassLiveStateToParent } from "./../rules/state-and-effects/no-pass-live-state-to-parent.js";
import { noPropCallbackInEffect } from "./../rules/state-and-effects/no-prop-callback-in-effect.js";
import { noResetAllStateOnPropChange } from "./../rules/state-and-effects/no-reset-all-state-on-prop-change.js";
import { noSetStateInRender } from "./../rules/state-and-effects/no-set-state-in-render.js";
import { preferUseEffectEvent } from "./../rules/state-and-effects/prefer-use-effect-event.js";
import { preferUseSyncExternalStore } from "./../rules/state-and-effects/prefer-use-sync-external-store.js";
import { preferUseReducer } from "./../rules/state-and-effects/prefer-use-reducer.js";
import { rerenderDeferReadsHook } from "./../rules/state-and-effects/rerender-defer-reads-hook.js";
import { rerenderDependencies } from "./../rules/state-and-effects/rerender-dependencies.js";
import { rerenderFunctionalSetstate } from "./../rules/state-and-effects/rerender-functional-setstate.js";
import { rerenderLazyStateInit } from "./../rules/state-and-effects/rerender-lazy-state-init.js";
import { rerenderStateOnlyInHandlers } from "./../rules/state-and-effects/rerender-state-only-in-handlers.js";

export const StateAndEffectsRuleEntries = [
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
] as const;
