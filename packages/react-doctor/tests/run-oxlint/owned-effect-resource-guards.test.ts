import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "../regressions/_helpers.js";
import { assertNativeSyntaxSuccess } from "./utils/assert-native-syntax-success.js";

interface OwnedEffectResourceCase {
  name: string;
  prefix?: string;
  signalDeclaration?: string;
  signalExpression?: string;
  nativeBody?: string;
  afterWork?: string;
  setup?: string;
  beforeEffect?: string;
  template?: string;
  cleanup?: string;
  expectedWarningCount: number;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-owned-effect-resource-"));
const cases: ReadonlyArray<OwnedEffectResourceCase> = [
  { name: "quiet-native-wait", expectedWarningCount: 0 },
  {
    name: "returned-abort-cleanup",
    cleanup: "{ return (controller.abort()); }",
    expectedWarningCount: 0,
  },
  {
    name: "returned-foreign-cleanup",
    cleanup: "{ return foreign.abort(); }",
    expectedWarningCount: 1,
  },
  {
    name: "repeated-acyclic-signal-helper",
    signalDeclaration:
      "const { signal } = controller; const inspectToken = token => { const localToken = token; return localToken.aborted; };",
    signalExpression: "signal",
    nativeBody:
      "inspectToken(signal); inspectToken(signal); if (!(await pause(24, signal))) return;",
    expectedWarningCount: 0,
  },
  {
    name: "recursive-signal-helper",
    signalDeclaration:
      "const { signal } = controller; const inspectToken = token => { const localToken = token; return inspectToken(localToken); };",
    signalExpression: "signal",
    nativeBody: "inspectToken(signal); if (!(await pause(24, signal))) return;",
    expectedWarningCount: 1,
  },
  {
    name: "leading-resource-guard",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 0,
  },
  {
    name: "readonly-signal-destructure",
    signalDeclaration: "const { signal } = controller;",
    signalExpression: "signal",
    expectedWarningCount: 0,
  },
  {
    name: "guard-and-signal-destructure",
    prefix: "if (!enabled || !panel.current) return;",
    signalDeclaration: "const { signal } = controller;",
    signalExpression: "signal",
    expectedWarningCount: 0,
  },
  {
    name: "renamed-signal-destructure",
    signalDeclaration: "const { signal: ownedSignal } = controller;",
    signalExpression: "ownedSignal",
    expectedWarningCount: 0,
  },
  {
    name: "guard-after-controller",
    signalDeclaration: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "guard-after-work",
    afterWork: "if (!enabled) return;",
    expectedWarningCount: 1,
  },
  {
    name: "work-before-prefix-guard",
    prefix: "notify(); if (!enabled) return;",
    expectedWarningCount: 1,
  },
  {
    name: "unproved-prefix-getter",
    prefix: "if (!external.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "call-in-prefix-guard",
    prefix: "if (!checkEnabled()) return;",
    expectedWarningCount: 1,
  },
  {
    name: "mutable-signal-pattern",
    signalDeclaration: "let { signal } = controller; signal = foreignSignal;",
    signalExpression: "signal",
    expectedWarningCount: 1,
  },
  {
    name: "computed-signal-pattern",
    signalDeclaration: "const { ['signal']: signal } = controller;",
    signalExpression: "signal",
    expectedWarningCount: 1,
  },
  {
    name: "default-signal-pattern",
    signalDeclaration: "const { signal = foreignSignal } = controller;",
    signalExpression: "signal",
    expectedWarningCount: 1,
  },
  {
    name: "rest-signal-pattern",
    signalDeclaration: "const { signal, ...rest } = controller;",
    signalExpression: "signal",
    expectedWarningCount: 1,
  },
  {
    name: "escaped-signal",
    signalDeclaration: "const { signal } = controller; publish(signal);",
    signalExpression: "signal",
    expectedWarningCount: 1,
  },
  {
    name: "published-signal",
    setup: "export let captured = null;",
    signalDeclaration: "const { signal } = controller; captured = signal;",
    signalExpression: "signal",
    expectedWarningCount: 1,
  },
  {
    name: "mutated-signal-property",
    signalDeclaration: "const { signal } = controller; signal.aborted = false;",
    signalExpression: "signal",
    expectedWarningCount: 1,
  },
  {
    name: "iterated-signal",
    signalDeclaration: "const { signal } = controller; for (const item of signal) {}",
    signalExpression: "signal",
    expectedWarningCount: 1,
  },
  {
    name: "logical-native-node-escape",
    signalDeclaration: "foreign(panel.current || null);",
    nativeBody: "const duplicate = panel.current.cloneNode(true);",
    expectedWarningCount: 1,
  },
  {
    name: "boolean-native-node-test",
    signalDeclaration: "const present = !!panel.current; notify(present);",
    nativeBody: "const duplicate = panel.current.cloneNode(true);",
    expectedWarningCount: 0,
  },
  {
    name: "loose-native-node-coercion",
    signalDeclaration: "const matches = panel.current == 1;",
    nativeBody: "const duplicate = panel.current.cloneNode(true);",
    expectedWarningCount: 1,
  },
  {
    name: "loose-null-native-node-test",
    signalDeclaration: "const missing = panel.current == null;",
    nativeBody: "const duplicate = panel.current.cloneNode(true);",
    expectedWarningCount: 0,
  },
  {
    name: "opaque-child-state-only-baseline",
    setup: "const OpaqueChild = () => <x-widget />;",
    template: "<div ref={panel}><OpaqueChild /></div>",
    expectedWarningCount: 0,
  },
  {
    name: "opaque-child-closed-ref-read",
    setup: "const OpaqueChild = () => <x-widget />;",
    template: "<div ref={panel}><OpaqueChild /></div>",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 0,
  },
  {
    name: "opaque-child-native-clone-refused",
    setup: "const OpaqueChild = () => <x-widget />;",
    template: "<div ref={panel}><OpaqueChild /></div>",
    prefix: "if (!enabled || !panel.current) return;",
    nativeBody: "const duplicate = panel.current.cloneNode(true);",
    expectedWarningCount: 1,
  },
  {
    name: "escaped-ref-object-read",
    beforeEffect: "publish(panel);",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "getter-ref-descriptor-read",
    beforeEffect: "Object.defineProperty(panel, 'current', { get: () => foreignNode });",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "deleted-ref-descriptor-read",
    beforeEffect: "delete panel.current;",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "mutable-ref-alias-read",
    beforeEffect: "let alias = panel;",
    prefix: "if (!enabled || !alias.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "readonly-ref-alias-read",
    beforeEffect: "const alias = panel;",
    prefix: "if (!enabled || !alias.current) return;",
    expectedWarningCount: 0,
  },
  {
    name: "getter-ref-alias-read",
    beforeEffect:
      "const alias = panel; Object.defineProperty(alias, 'current', { get: () => foreignNode });",
    prefix: "if (!enabled || !alias.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "custom-ref-owner-read",
    setup: "const OpaqueChild = () => <span />;",
    template: "<OpaqueChild ref={panel} />",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "ref-passed-to-opaque-child-read",
    setup: "const OpaqueChild = () => <span />;",
    template: "<div ref={panel}><OpaqueChild target={panel} /></div>",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "returned-owner-ref-descriptor-extraction",
    setup:
      "export const Parent = properties => { const element = App(properties); Object.defineProperty(element.props.ref, 'current', { get: () => foreignNode }); return element; };",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "returned-owner-ref-publication",
    setup:
      "export const Parent = properties => { const element = App(properties); publish(element.props.ref); return element; };",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "opaque-native-owner-ancestor",
    setup: "const OpaqueParent = ({ children }) => foreign(children);",
    template: "<OpaqueParent><div ref={panel} /></OpaqueParent>",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
  {
    name: "published-native-owner-element",
    beforeEffect: "const element = <div ref={panel} />; publish(element);",
    template: "element",
    prefix: "if (!enabled || !panel.current) return;",
    expectedWarningCount: 1,
  },
];

afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("owned effect resource guards in the native engine", () => {
  it.each(cases)("checks $name", async (testCase) => {
    const rootDirectory = setupReactProject(temporaryDirectory, testCase.name, {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", next: "^16.0.0" },
      },
      files: {
        "src/App.tsx": `import { useEffect, useRef, useState } from "react";
${testCase.setup ?? ""}
const pause = (milliseconds, signal) => new Promise(settle => {
  if (signal.aborted) { settle(false); return; }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", cancel);
    settle(true);
  }, milliseconds);
  const cancel = () => { clearTimeout(timer); settle(false); };
  signal.addEventListener("abort", cancel, { once: true });
});
export const App = ({ enabled, revision }) => {
  const panel = useRef(null);
  const [status, setStatus] = useState("");
  ${testCase.beforeEffect ?? ""}
  useEffect(() => {
    ${testCase.prefix ?? ""}
    const controller = new AbortController();
    ${testCase.signalDeclaration ?? ""}
    const run = async () => {
      if (!(await pause(24, ${testCase.signalExpression ?? "controller.signal"}))) return;
      ${testCase.nativeBody ?? ""}
      setStatus("ready");
    };
    void run();
    ${testCase.afterWork ?? ""}
    return () => ${testCase.cleanup ?? "controller.abort()"};
  }, [enabled, revision]);
  return ${testCase.template ?? "<div ref={panel}><span>Panel</span></div>"};
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
