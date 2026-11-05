import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";
import { isClosedInvariantBooleanReset } from "./utils/is-closed-invariant-boolean-reset.js";

const certificateProbe = defineRule({
  id: "closed-invariant-boolean-reset-probe",
  title: "Closed Boolean reset certificate probe",
  severity: "warn",
  recommendation: "Probe the closed Boolean reset certificate.",
  create: (context) => ({
    IfStatement(node) {
      const consequent = isNodeOfType(node.consequent, "BlockStatement")
        ? node.consequent.body[0]
        : node.consequent;
      if (!isNodeOfType(consequent, "ExpressionStatement")) return;
      const effectFunction = findEnclosingFunction(node);
      const owner = effectFunction ? findEnclosingFunction(effectFunction) : null;
      const effectCall = effectFunction?.parent;
      if (!effectFunction || !owner || !effectCall) return;
      if (
        isClosedInvariantBooleanReset({
          context,
          owner,
          effectCall,
          effectFunction,
          setterCall: consequent.expression,
        })
      ) {
        context.report({ node, message: "Closed Boolean reset certificate accepted." });
      }
    },
  }),
});

const cases = [
  {
    name: "positive-false-guard",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "positive-false-guard.tsx",
    certificateExpected: true,
    expectedResetCount: 0,
  },
  {
    name: "positive-true-guard",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(true);\n  useEffect(() => {\n    if (active) setActive(true);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "positive-true-guard.tsx",
    certificateExpected: true,
    expectedResetCount: 0,
  },
  {
    name: "positive-parenthesized-false",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!(active)) { setActive(false); }\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "positive-parenthesized-false.tsx",
    certificateExpected: true,
    expectedResetCount: 0,
  },
  {
    name: "opposite-guard",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "opposite-guard.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "noninitial-event-writer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <button onClick={() => setActive(true)}>{active ? "active" : "idle"}</button>;\n};\n',
    filename: "noninitial-event-writer.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "queued-layout-writer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useLayoutEffect(() => { setActive(true); }, [identity]);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "queued-layout-writer.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "unknown-call-before-reset",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) { beforeReset?.(); setActive(false); }\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "unknown-call-before-reset.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "unknown-call-in-guard",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active && beforeReset?.()) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "unknown-call-in-guard.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "setter-passed-to-opaque",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  accept?.(setActive);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "setter-passed-to-opaque.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "setter-returned-in-jsx",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <button onClick={setActive}>{active ? "active" : "idle"}</button>;\n};\n',
    filename: "setter-returned-in-jsx.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "setter-alias",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  const reset = setActive;\n  useEffect(() => {\n    if (!active) reset(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "setter-alias.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "deferred-independent-writer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => { queueMicrotask(() => setActive(true)); }, []);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "deferred-independent-writer.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "cleanup-independent-writer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => () => { setActive(true); }, []);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "cleanup-independent-writer.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "same-effect-cleanup-writer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false); return () => { setActive(true); };\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "same-effect-cleanup-writer.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "shadowed-guard",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    { const active = false; if (!active) setActive(false); }\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "shadowed-guard.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "multiple-state-slots",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false); const [ready, setReady] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false); if (!ready) setReady(false);\n  }, [identity]);\n  return <output>{active ? "active" : ready ? "ready" : "idle"}</output>;\n};\n',
    filename: "multiple-state-slots.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "lazy-initializer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(() => false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "lazy-initializer.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "defaulted-setter-origin",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive = () => undefined] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "defaulted-setter-origin.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "defaulted-state-origin",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active = false, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "defaulted-state-origin.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "custom-state-provider",
    input:
      'import { useEffect, useLayoutEffect } from "react";\nimport { useState } from "./custom-provider";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "custom-state-provider.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "member-getter-guard",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  const probe = { get active() { return active; } };\n  useEffect(() => {\n    if (!probe.active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "member-getter-guard.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "ref-assignment-before-reset",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  const holder = { active: false };\n  useEffect(() => {\n    if (!active) { holder.active = true; setActive(false); }\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "ref-assignment-before-reset.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "forwarded-setter-call",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  const reset = (write: (value: boolean) => void) => write(false);\n  useEffect(() => {\n    if (!active) reset(setActive);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "forwarded-setter-call.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "loop-control-flow",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    while (!active) { setActive(false); break; }\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "loop-control-flow.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "try-finally-control-flow",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    try { if (!active) setActive(false); } finally { beforeReset?.(); }\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "try-finally-control-flow.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "nonboolean-initializer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(0);\n  useEffect(() => {\n    if (!active) setActive(0);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "nonboolean-initializer.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "noninitial-render-writer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  if (identity === "start" && !active) setActive(true);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "noninitial-render-writer.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "functional-setter-value",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive((previous) => previous);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "functional-setter-value.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "29-direct-eval-layout-writer",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\ninterface ResetPreviewProps { readonly identity: string; }\nexport const ResetPreview = ({ identity }: ResetPreviewProps) => {\n  const [active, setActive] = useState(false);\n  useLayoutEffect(() => { eval("setActive(true)"); }, [identity]);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "29-direct-eval-layout-writer.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "30-locally-bound-direct-eval",
    input:
      'const React = require("react");\nconst { useEffect, useLayoutEffect, useState } = React;\nexports.ResetPreview = function ResetPreview({ identity, scope }) {\n  const [active, setActive] = useState(false);\n  useLayoutEffect(() => {\n    const invokeWithEval = function (eval) { eval("setActive(true)"); };\n    invokeWithEval(globalThis.eval);\n  }, [identity]);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return React.createElement("output", null, active ? "active" : "idle");\n};\n',
    filename: "30-locally-bound-direct-eval.cjs",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "31-nested-capturing-eval",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\ninterface ResetPreviewProps { readonly identity: string; }\nexport const ResetPreview = ({ identity }: ResetPreviewProps) => {\n  const [active, setActive] = useState(false);\n  useLayoutEffect(() => {\n    const writeHiddenValue = () => eval("setActive(true)");\n    writeHiddenValue();\n  }, [identity]);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "31-nested-capturing-eval.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "32-indirect-eval-capability",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\ninterface ResetPreviewProps { readonly identity: string; }\nexport const ResetPreview = ({ identity }: ResetPreviewProps) => {\n  const [active, setActive] = useState(false);\n  useLayoutEffect(() => { (0, eval)("globalThis.booleanResetMarker = true"); }, [identity]);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "32-indirect-eval-capability.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "33-function-constructor-capability",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\ninterface ResetPreviewProps { readonly identity: string; }\nexport const ResetPreview = ({ identity }: ResetPreviewProps) => {\n  const [active, setActive] = useState(false);\n  useLayoutEffect(() => { Function("return globalThis")().booleanResetMarker = true; }, [identity]);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "33-function-constructor-capability.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "34-with-statement-script-profile",
    input:
      'const React = require("react");\nconst { useEffect, useLayoutEffect, useState } = React;\nexports.ResetPreview = function ResetPreview({ identity, scope }) {\n  const [active, setActive] = useState(false);\n  with (scope) { void identity; }\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return React.createElement("output", null, active ? "active" : "idle");\n};\n',
    filename: "34-with-statement-script-profile.cjs",
    certificateExpected: false,
    expectedResetCount: 0,
  },
  {
    name: "namespace-runtime-provider",
    input:
      'import * as React from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = React.useState(false);\n  React.useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "namespace-runtime-provider.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "default-runtime-provider",
    input:
      'import React from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = React.useState(false);\n  React.useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "default-runtime-provider.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "named-provider-namespace-facade-write",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\nimport * as React from "react";\nconst replacementState = (initial) => [!initial, () => undefined];\nReact.useState = replacementState;\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "named-provider-namespace-facade-write.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "named-provider-default-facade-write",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\nimport React from "react";\nconst replacementState = (initial) => [!initial, () => undefined];\nReact.useState = replacementState;\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "named-provider-default-facade-write.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "type-only-state-provider",
    input:
      'import { useEffect, useLayoutEffect } from "react";\nimport type { useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "type-only-state-provider.tsx",
    certificateExpected: false,
    expectedResetCount: 1,
  },
  {
    name: "extra-state-tuple-binding",
    input:
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive, details] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    filename: "extra-state-tuple-binding.tsx",
    certificateExpected: false,
    expectedResetCount: 0,
  },
];

describe("closed invariant Boolean resets", () => {
  it.each(cases)("certifies only the finite shape: $name", (testCase) => {
    const result = runRule(certificateProbe, testCase.input, { filename: testCase.filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(testCase.certificateExpected ? 1 : 0);
  });

  it.each(cases)("preserves the measured rule behavior: $name", (testCase) => {
    const result = runRule(noResetAllStateOnPropChange, testCase.input, {
      filename: testCase.filename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(testCase.expectedResetCount);
  });

  it("ignores erased type-only code and provider references", () => {
    const input =
      'import type * as ReactTypes from "react";\ntype CapabilityNames = { eval: string; Function: () => void; require: ReactTypes.ReactNode };\nimport { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n';
    const certificate = runRule(certificateProbe, input);
    const result = runRule(noResetAllStateOnPropChange, input);
    expect(certificate.parseErrors).toEqual([]);
    expect(certificate.diagnostics).toHaveLength(1);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("accepts a genuine renamed direct React import", () => {
    const input =
      'import { useEffect as observe, useLayoutEffect, useState as createState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = createState(false);\n  observe(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n';
    const certificate = runRule(certificateProbe, input);
    const result = runRule(noResetAllStateOnPropChange, input);
    expect(certificate.parseErrors).toEqual([]);
    expect(certificate.diagnostics).toHaveLength(1);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines a local const alias of the state provider", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState as nativeState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const useState = nativeState;\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("declines a React facade loaded through node process", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n\nimport { getBuiltinModule } from "node:process";\nconst foreignState = (initial) => [!initial, () => undefined];\nconst { createRequire: loadFrom } = getBuiltinModule("module");\nconst reactFacade = loadFrom(import.meta.url)("react");\nreactFacade.useState = foreignState;\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines reflected code loading and facade assignment", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n\nconst foreignState = (initial) => [!initial, () => undefined];\nconst loadCode = Reflect.get(globalThis, "Function");\nconst facade = loadCode("return process.getBuiltinModule(\'module\').createRequire(process.cwd() + \'/entry.cjs\')(\'react\')")();\nObject.assign(facade, { useState: foreignState });\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines unknown computed provider property access", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n\nconst facade = {};\nfacade["use" + "State"] = () => [];\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("declines an ambient process loader destructure", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n\nconst { getBuiltinModule: loadBuiltin } = process;\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("declines extra runtime statements even when benign", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n\nconst names = Object.keys({ first: 1 });\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("accepts an explicit use client directive", () => {
    const result = runRule(
      certificateProbe,
      '"use client";\nimport { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("declines runtime component parameter defaults", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps = obtainProps()) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines a component sibling initializer", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n}, extra = loadProvider();\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines a state declaration sibling initializer", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false), extra = loadProvider();\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines effect dependency calls", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [readIdentity(identity)]);\n  return <output>{active ? "active" : "idle"}</output>;\n};\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines native return attributes", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output title={readTitle()}>{active ? "active" : "idle"}</output>;\n};\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines nonliteral conditional output", () => {
    const result = runRule(
      certificateProbe,
      'import { useEffect, useLayoutEffect, useState } from "react";\n\ninterface IndicatorProps {\n  readonly identity: string;\n  readonly beforeReset?: () => void;\n  readonly accept?: (setter: (next: boolean) => void) => void;\n}\n\nexport const Indicator = ({ identity, beforeReset, accept }: IndicatorProps) => {\n  const [active, setActive] = useState(false);\n  useEffect(() => {\n    if (!active) setActive(false);\n  }, [identity]);\n  return <output>{active ? showActive() : "idle"}</output>;\n};\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
