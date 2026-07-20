import type { Capability } from "./capability.js";

interface MobxRuleGate {
  readonly requires: ReadonlyArray<Capability>;
  readonly disabledWhen?: ReadonlyArray<Capability>;
}

export const MOBX_RULE_GATES = {
  "mobx-reaction-disposer-discarded": {
    requires: ["mobx:4"],
  },
  "mobx-no-make-auto-observable-in-inheritance": {
    requires: ["mobx:6"],
  },
  "mobx-no-computed-side-effects": {
    requires: ["mobx:4"],
  },
  "mobx-async-action-requires-action": {
    requires: ["mobx:4"],
  },
  "mobx-no-observer-wrapped-memo": {
    requires: ["mobx:4", "mobx-react-binding-observer-memo-guard", "react"],
  },
  "mobx-make-observable-unconditional": {
    requires: ["mobx:6"],
  },
  "mobx-legacy-decorator-needs-make-observable": {
    requires: ["mobx:6"],
  },
  "mobx-initialize-before-make-auto-observable": {
    requires: ["mobx:6"],
  },
  "mobx-observable-read-needs-observer": {
    requires: ["mobx:4", "mobx-react-binding", "react"],
    disabledWhen: ["mobx-react-observer"],
  },
  "mobx-observer-before-inject": {
    requires: ["mobx:4", "mobx-react", "react"],
  },
  "mobx-reaction-requires-observable": {
    requires: ["mobx:4"],
  },
  "mobx-no-invalid-observable-override": {
    requires: ["mobx:6"],
  },
  "mobx-no-observable-prop-to-untracked-child": {
    requires: ["mobx:4", "mobx-react-binding", "react"],
  },
  "mobx-no-stale-observable-snapshot-after-await": {
    requires: ["mobx:4"],
  },
  "mobx-no-reaction-comparison-value-mutation": {
    requires: ["mobx:4"],
  },
  "mobx-observer-class-no-should-component-update": {
    requires: ["mobx:4", "mobx-react", "react"],
  },
  "mobx-enable-static-rendering-for-ssr": {
    requires: ["mobx:4", "mobx-react-binding", "react", "ssr"],
  },
  "mobx-no-rest-destructure-observable": {
    requires: ["mobx:4", "mobx-react-binding", "react"],
  },
  "mobx-computed-depends-on-non-observable": {
    requires: ["mobx:4"],
  },
  "mobx-no-keepalive-computed-without-disposal": {
    requires: ["mobx:4"],
  },
} satisfies Record<string, MobxRuleGate>;
