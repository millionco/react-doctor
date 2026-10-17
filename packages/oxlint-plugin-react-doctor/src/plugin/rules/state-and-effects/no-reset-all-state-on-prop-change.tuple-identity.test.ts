import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

interface StateResetTupleCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expectedCount: number;
}

const stateResetOptions: RunRuleOptions = { forceJsx: true };

const cases: StateResetTupleCase[] = [
  {
    name: "getter-setter-cardinality-collision",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [, writeBusy] = useState(false);\n  const [previousKey, writePreviousKey] = useState(itemKey);\n\n  useEffect(() => { writeNotice(""); writeBusy(false); }, [itemKey]);\n  return <section><button onClick={() => writeNotice("changed")}>Change</button><button onClick={() => writeBusy(true)}>Busy</button><output>{notice}:{previousKey}</output></section>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "render-adjustment-is-independent",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [, writeBusy] = useState(false);\n  const [previousKey, writePreviousKey] = useState(itemKey);\n  if (previousKey !== itemKey) { writePreviousKey(itemKey); writeNotice(""); writeBusy(false); }\n  useEffect(() => { writeNotice(""); writeBusy(false); }, [itemKey]);\n  return <section><button onClick={() => writeNotice("changed")}>Change</button><button onClick={() => writeBusy(true)}>Busy</button><output>{notice}:{previousKey}</output></section>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "all-two-named-states-reset",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [busy, writeBusy] = useState(false);\n\n  useEffect(() => { writeNotice(""); writeBusy(false); }, [itemKey]);\n  return <output>{notice}:{String(busy)}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "ordinary-partial-two-named",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [busy, writeBusy] = useState(false);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}:{String(busy)}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "duplicate-one-setter-not-two-states",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [busy, writeBusy] = useState(false);\n\n  useEffect(() => { writeNotice(""); writeNotice(""); }, [itemKey]);\n  return <output>{notice}:{String(busy)}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "naming-the-omitted-getter-removes-collision",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [busy, writeBusy] = useState(false);\n  const [previousKey, writePreviousKey] = useState(itemKey);\n\n  useEffect(() => { writeNotice(""); writeBusy(false); }, [itemKey]);\n  return <output>{notice}:{String(busy)}:{previousKey}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "all-three-named-states-reset",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [busy, writeBusy] = useState(false);\n  const [amount, writeAmount] = useState(0);\n\n  useEffect(() => { writeNotice(""); writeBusy(false); writeAmount(0); }, [itemKey]);\n  return <output>{notice}:{String(busy)}:{amount}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "all-three-with-omitted-getter-legacy-abstention",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [, writeBusy] = useState(false);\n  const [amount, writeAmount] = useState(0);\n\n  useEffect(() => { writeNotice(""); writeBusy(false); writeAmount(0); }, [itemKey]);\n  return <output>{notice}:{amount}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "unreset-omitted-getter-proves-partial-reset",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [, writeBusy] = useState(false);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <section><button onClick={() => writeBusy(true)}>Busy</button><output>{notice}</output></section>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "readonly-setter-alias-same-tuple",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [busy, writeBusy] = useState(false);\n  const resetNotice = writeNotice;\n\n  useEffect(() => { resetNotice(""); writeBusy(false); }, [itemKey]);\n  return <output>{notice}:{String(busy)}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "extra-tuple-after-return",
    code: 'import { useEffect, useState as nativeState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = nativeState("");\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n  const [, writeBusy] = nativeState(false);\n  const unusedHandler = () => writeBusy(true);\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "conditional-extra-tuple",
    code: 'import { useEffect, useState as nativeState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = nativeState("");\n  if (false) { const [, writeBusy] = nativeState(false); writeBusy(true); }\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "fake-local-useState-setter",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst useState = (_initial: unknown) => [0, (_next: unknown) => {}] as const;\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = useState(false);\n  const handler = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "type-only-extra-provider",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport type { useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = useState(false);\n  const handler = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "runtime-namespace-replacement",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport * as ReactCarrier from "react";\nReactCarrier.useState = replacement;\ndeclare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handler = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "type-only-namespace-preserved",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport type * as ReactTypes from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handler = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "runtime-default-react-carrier",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport ReactCarrier from "react"; ReactCarrier.useState = replacement; declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "runtime-named-default-react-carrier",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport { default as ReactCarrier } from "react"; ReactCarrier.useState = replacement; declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "genuine-global-react-carrier",
    code: 'import { useEffect, useState as nativeState } from "react";\nReact.useState = replacement; declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "genuine-globalThis-react-carrier",
    code: 'import { useEffect, useState as nativeState } from "react";\nglobalThis.React.useState = replacement; declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "genuine-window-root-conservative-boundary",
    code: 'import { useEffect, useState as nativeState } from "react";\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  window.console.log(itemKey);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "shadowed-window-root-is-not-global",
    code: 'import { useEffect, useState as nativeState } from "react";\nexport const Example = ({ itemKey, window }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  window.note(itemKey);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "genuine-require-alias-carrier",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst loadRuntime = require; const carrier = loadRuntime("react"); carrier.useState = replacement; declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "shadowed-require-preserves-native-witness",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst require = (_name: string) => null; require("unrelated");\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "genuine-module-carrier",
    code: 'import { useEffect, useState as nativeState } from "react";\nmodule.exports = replacement; declare const replacement: unknown;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "shadowed-module-is-not-a-carrier",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst module = { label: "local" }; const label = module.label;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "runtime-import-expression-carrier",
    code: 'import { useEffect, useState as nativeState } from "react";\nvoid import("react").then((carrier) => { carrier.useState = replacement; }); declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "typescript-import-type-does-not-load-provider",
    code: 'import { useEffect, useState as nativeState } from "react";\ntype ReactShape = typeof import("react");\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "local-hook-alias-is-unsupported",
    code: 'import { useEffect, useState as nativeState } from "react";\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const createState = nativeState;\n  const [, writeBusy] = createState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "destructured-write-to-native-callee",
    code: 'import { useEffect, useState as nativeState } from "react";\n[nativeState] = [replacement]; declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "loop-write-to-native-callee",
    code: 'import { useEffect, useState as nativeState } from "react";\nfor (nativeState of replacements) {} declare const replacements: Array<typeof nativeState>;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "typescript-type-query-is-not-runtime-global-exposure",
    code: 'import { useEffect, useState as nativeState } from "react";\ntype WindowShape = typeof globalThis;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "typescript-enum-runtime-body-is-not-pruned",
    code: 'import { useEffect, useState as nativeState } from "react";\nenum RuntimeShape { Active = (globalThis.React.useState = replacement, 1) } declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "typescript-namespace-runtime-body-is-not-pruned",
    code: 'import { useEffect, useState as nativeState } from "react";\nnamespace RuntimeShape { globalThis.React.useState = replacement; } declare const replacement: typeof nativeState;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "typescript-import-equals-is-unsupported",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport ReactCarrier = require("react");\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "direct-named-native-hook-alias",
    code: 'import { useEffect, useState as createState } from "react";\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = createState("");\n  const [, writeBusy] = createState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "multiple-const-declarators-remain-owned",
    code: 'import { useEffect, useState as nativeState } from "react";\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false), marker = "local";\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "ordinary-function-declaration-owner",
    code: 'import { useEffect, useState as nativeState } from "react";\nexport function Example({ itemKey }) {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n}\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "extra-after-effect-is-unsupported",
    code: 'import { useEffect, useState as nativeState } from "react";\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  const [, writeBusy] = nativeState(false);\n  return <button onClick={() => writeBusy(true)}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "type-only-named-default-carrier-is-not-runtime",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport type { default as ReactTypes } from "react";\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <output>{notice}</output>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "unused-runtime-node-module-import",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport { createRequire } from "node:module";\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "unused-runtime-module-import",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport { createRequire } from "module";\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "genuine-eval-symbol-read",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst evaluateProgram = eval;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "genuine-function-symbol-read",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst compileProgram = Function;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "local-function-and-nonglobal-eval-properties",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst Function = (_value: string) => null; const sandbox = { eval: (_value: string) => null }; const localFactory = Function; const localEvaluate = sandbox.eval;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "type-only-builtin-module-imports",
    code: 'import { useEffect, useState as nativeState } from "react";\nimport type { createRequire } from "node:module";\nimport { type createRequire as OtherFactory } from "module";\ntype Factory = typeof Function;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
  {
    name: "readonly-static-callable-constructor-projection",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst callableConstructor = (() => null).constructor;\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "readonly-static-constructor-pattern-extraction",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst { constructor: factory } = (() => null);\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 1,
  },
  {
    name: "harmless-nonconstructor-pattern-extraction",
    code: 'import { useEffect, useState as nativeState } from "react";\nconst { name: label } = (() => null);\nexport const Example = ({ itemKey }) => {\n  const [notice, writeNotice] = nativeState("");\n  const [, writeBusy] = nativeState(false);\n  const handleBusy = () => writeBusy(true);\n  useEffect(() => { writeNotice(""); }, [itemKey]);\n  return <button onClick={handleBusy}>{notice}</button>;\n};\n',
    options: stateResetOptions,
    expectedCount: 0,
  },
];

describe("no-reset-all-state-on-prop-change tuple identity", () => {
  it.each(cases)("$name", ({ code, options, expectedCount }) => {
    const result = runRule(noResetAllStateOnPropChange, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
