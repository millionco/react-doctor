import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "../regressions/_helpers.js";
import { assertNativeSyntaxSuccess } from "./utils/assert-native-syntax-success.js";

interface NativeGlobalClosureCase {
  name: string;
  setup: string;
  expectedWarningCount: number;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-native-global-closure-"));
const privateArrayOwnerSource = `import { useRef } from "react";
const parts = ['quay', 'ridge'];
export function Spectrum(props) {
  const position = useRef(0);
  const selector = \`[data-part=\${parts[position.current]}]\`;
  position.current = (position.current + 1) % parts.length;
  return <div data-selector={selector}>{props.label}</div>;
}`;
const cases: ReadonlyArray<NativeGlobalClosureCase> = [
  {
    name: "private-array-numeric-ref-transfer",
    setup: privateArrayOwnerSource,
    expectedWarningCount: 0,
  },
  {
    name: "private-array-numeric-ref-reset",
    setup: privateArrayOwnerSource.replace("(position.current + 1) % parts.length", "1"),
    expectedWarningCount: 0,
  },
  {
    name: "private-array-numeric-ref-out-of-bounds",
    setup: privateArrayOwnerSource.replace("(position.current + 1) % parts.length", "2"),
    expectedWarningCount: 1,
  },
  {
    name: "private-array-publication",
    setup: privateArrayOwnerSource + "\npublish(parts);",
    expectedWarningCount: 1,
  },
  {
    name: "private-numeric-ref-publication",
    setup: privateArrayOwnerSource.replace(
      "  const selector",
      "  publish(position); const selector",
    ),
    expectedWarningCount: 1,
  },
  {
    name: "private-numeric-ref-direct-component-call",
    setup: privateArrayOwnerSource + "\nSpectrum({ label: 'ridge' });",
    expectedWarningCount: 1,
  },
  {
    name: "literal-numeric-selector-key",
    setup: "const parts = ['quay', 'ridge']; const selector = `[data-part=${parts[1]}]`;",
    expectedWarningCount: 0,
  },
  {
    name: "readonly-numeric-selector-key",
    setup:
      "const parts = ['quay', 'ridge']; const index = 1; const selector = `[data-part=${parts[index]}]`;",
    expectedWarningCount: 0,
  },
  {
    name: "opaque-selector-key-coercion",
    setup:
      "const parts = ['quay', 'ridge']; const index = { toString: () => 'constructor' }; const selector = `[data-part=${parts[index]}]`;",
    expectedWarningCount: 1,
  },
  {
    name: "array-pattern-callable-gateway",
    setup:
      "const chooseName = () => \"constructor\"; const [Carrier] = [() => {}]; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-direct-pattern",
    setup:
      "const chooseName = () => \"constructor\"; const Carrier = () => {}; const {[chooseName()]: makeCode} = Carrier; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-nested-pattern",
    setup:
      "const chooseName = () => \"constructor\"; const Carrier = () => {}; const {nested:{[chooseName()]: makeCode}} = {nested: Carrier}; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "static-callable-destructuring",
    setup: "const Carrier = () => {}; const { name: label } = Carrier;",
    expectedWarningCount: 0,
  },
  {
    name: "unknown-computed-assigned-after-uninitialized",
    setup:
      "const chooseName = () => \"constructor\"; let Carrier; Carrier = () => {}; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-assigned-over-scalar",
    setup:
      "const chooseName = () => \"constructor\"; let Carrier = 1; Carrier = () => {}; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-let-arrow",
    setup:
      "const chooseName = () => \"constructor\"; let Carrier = () => {}; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-var-arrow",
    setup:
      "const chooseName = () => \"constructor\"; var Carrier = () => {}; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-let-class",
    setup:
      "const chooseName = () => \"constructor\"; let Carrier = class {}; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-var-class",
    setup:
      "const chooseName = () => \"constructor\"; var Carrier = class {}; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-self-reassigned-arrow",
    setup:
      "const chooseName = () => \"constructor\"; let Carrier = () => {}; Carrier = Carrier; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "ordinary-data-computed",
    setup:
      'const chooseName = () => "label"; const record = {label:"quay"}; const result = record[chooseName()];',
    expectedWarningCount: 0,
  },
  {
    name: "local-record-shadow-computed",
    setup:
      'const chooseName = () => "label"; const Math = {max:{label:"quay"}}; const result = Math.max[chooseName()];',
    expectedWarningCount: 0,
  },
  {
    name: "known-callable-static",
    setup: "const Carrier = () => {}; const result = Carrier.name;",
    expectedWarningCount: 0,
  },
  {
    name: "unknown-computed-local-arrow",
    setup:
      "const chooseName = () => \"constructor\"; const Carrier = () => {}; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-local-function-alias",
    setup:
      "const chooseName = () => \"constructor\"; function Carrier() {} const Alias = Carrier; const makeCode = Alias[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-class-constructor",
    setup:
      "const chooseName = () => \"constructor\"; class Carrier {} const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-class-expression-alias",
    setup:
      "const chooseName = () => \"constructor\"; const Carrier = class {}; const Alias = Carrier; const makeCode = Alias[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-native-global-alias",
    setup:
      "const chooseName = () => \"constructor\"; const Carrier = Object; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-native-static-alias",
    setup:
      "const chooseName = () => \"constructor\"; const Carrier = Math.max; const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-primitive-method-alias",
    setup:
      'const chooseName = () => "constructor"; const Carrier = "".slice; const makeCode = Carrier[chooseName()]; makeCode(\'globalThis.setTimeout = replacement\')();',
    expectedWarningCount: 1,
  },
  {
    name: "unknown-computed-native-bound-alias",
    setup:
      "const chooseName = () => \"constructor\"; const Carrier = Math.max.bind(null); const makeCode = Carrier[chooseName()]; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "native-reflected-constructor-gateway-0",
    setup:
      "const makeCode = Object.constructor; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "native-reflected-constructor-gateway-1",
    setup: "const makeCode = Array.constructor; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "native-reflected-constructor-gateway-2",
    setup:
      "const makeCode = ''.slice.constructor; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "native-reflected-constructor-gateway-3",
    setup:
      "const makeCode = Math.max.constructor; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "native-reflected-constructor-gateway-4",
    setup:
      "const { constructor: makeCode } = () => {}; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "native-reflected-constructor-gateway-5",
    setup:
      "const makeCode = Reflect.get(() => {}, 'constructor'); makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "function-constructor-code-gateway",
    setup:
      "const makeCode = (() => {}).constructor; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "computed-function-constructor-code-gateway",
    setup:
      "const makeCode = (() => {})['constructor']; makeCode('globalThis.setTimeout = replacement')();",
    expectedWarningCount: 1,
  },
  {
    name: "block-const-shadow",
    setup: "{ const Object = { getPrototypeOf: () => ({}) }; Object.getPrototypeOf({}); }",
    expectedWarningCount: 0,
  },
  {
    name: "function-body-shadow",
    setup:
      "const inspectLocal = () => { function Object() { return {}; } return Object(); }; inspectLocal();",
    expectedWarningCount: 0,
  },
  {
    name: "closed-own-record",
    setup:
      "const record = {}; Object.defineProperty(record, 'addEventListener', { value: replacement });",
    expectedWarningCount: 0,
  },
  {
    name: "direct-native-writer",
    setup: "Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    expectedWarningCount: 1,
  },
  {
    name: "block-function-add-writer",
    setup:
      "{ function Object() {} } Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    expectedWarningCount: 1,
  },
  {
    name: "block-function-remove-writer",
    setup:
      "{ function Object() {} } Object.getPrototypeOf(new AbortController().signal).removeEventListener = foreign;",
    expectedWarningCount: 1,
  },
  {
    name: "erased-object-type",
    setup:
      "type Object = {}; Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    expectedWarningCount: 1,
  },
  {
    name: "ambient-object-binding",
    setup:
      "declare const Object: any; Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    expectedWarningCount: 1,
  },
  {
    name: "erased-function-type",
    setup: "type Function = {}; new Function('patchNativeGlobals()')();",
    expectedWarningCount: 1,
  },
  {
    name: "block-enum-dynamic-code",
    setup: "{ enum Function { Local } } new Function('patchNativeGlobals()')();",
    expectedWarningCount: 1,
  },
  {
    name: "opaque-signal-writer",
    setup: "foreign(new AbortController().signal).addEventListener = replacement;",
    expectedWarningCount: 1,
  },
  {
    name: "opaque-promise-writer",
    setup: "foreign(new Promise(() => {})).constructor = replacement;",
    expectedWarningCount: 1,
  },
  {
    name: "destructured-reflection",
    setup:
      "const { defineProperty: change } = Object; change(foreign(), 'addEventListener', { value: replacement });",
    expectedWarningCount: 1,
  },
  {
    name: "namespace-import-equals",
    setup:
      "namespace Container { import Function = Utilities.create; } new Function('patchNativeGlobals()')();",
    expectedWarningCount: 1,
  },
  {
    name: "namespace-var",
    setup:
      "namespace Container { var Function = Utilities.create; } new Function('patchNativeGlobals()')();",
    expectedWarningCount: 1,
  },
  {
    name: "static-block-var",
    setup: "class Holder { static { var Function; } } new Function('patchNativeGlobals()')();",
    expectedWarningCount: 1,
  },
];

afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("native delay source-global closure in the native engine", () => {
  it("rejects a fatal native ESM parse error before checking rule warnings", () => {
    const rootDirectory = setupReactProject(temporaryDirectory, "fatal-native-esm", {
      files: { "src/App.tsx": 'import "react"; type eval = {}; eval("patchNativeGlobals()");' },
    });
    expect(() => assertNativeSyntaxSuccess(rootDirectory)).toThrow(
      "Cannot assign to 'eval' in strict mode",
    );
  });

  it.each(cases)("checks $name", async (testCase) => {
    const rootDirectory = setupReactProject(temporaryDirectory, testCase.name, {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", next: "^16.0.0" },
      },
      files: {
        "src/App.tsx": `import { useEffect, useState } from "react";
${testCase.setup}
const pause = (milliseconds, signal) => new Promise(settle => {
  if (signal.aborted) { settle(false); return; }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", cancel);
    settle(true);
  }, milliseconds);
  const cancel = () => { clearTimeout(timer); settle(false); };
  signal.addEventListener("abort", cancel, { once: true });
});
export const App = ({ revision }) => {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      if (!(await pause(24, controller.signal))) return;
      setStatus("ready");
    };
    run();
    return () => controller.abort();
  }, [revision]);
  return <div>{status}</div>;
};`,
      },
    });
    assertNativeSyntaxSuccess(rootDirectory);
    const diagnostics = await runOxlint({
      rootDirectory,
      project: buildTestProject({ rootDirectory, framework: "vite" }),
      userConfig: { rules: { "react-doctor/no-set-state-after-await-in-effect": "warn" } },
      perFileLintCacheEnabled: false,
      sidecarLintCacheEnabled: false,
    });
    const warnings = diagnostics.filter(
      (diagnostic) =>
        diagnostic.rule === "no-set-state-after-await-in-effect" &&
        diagnostic.filePath === "src/App.tsx",
    );
    expect(warnings).toHaveLength(testCase.expectedWarningCount);
  });
});
