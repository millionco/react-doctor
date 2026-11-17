import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "../regressions/_helpers.js";
import { assertNativeSyntaxSuccess } from "./utils/assert-native-syntax-success.js";

interface NativeSdkCallbackCase {
  name: string;
  setup?: string;
  callback?: string;
  dependencies?: Readonly<Record<string, string>>;
  hasSdkRole?: boolean;
  files?: Readonly<Record<string, string>>;
  expectedWarningCount: number;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-native-sdk-callback-"));
const cases: ReadonlyArray<NativeSdkCallbackCase> = [
  { name: "genuine-sdk-query-clone", expectedWarningCount: 0 },
  { name: "missing-sdk-role", hasSdkRole: false, expectedWarningCount: 1 },
  {
    name: "dynamic-sdk-alias-mutation",
    setup:
      'const sdkName = "lucide-react"; import(sdkName).then(sdk => { sdk.Check.render = foreign; });',
    expectedWarningCount: 1,
  },
  {
    name: "protected-package-alias-mutation",
    setup: 'import { Check as Same } from "icons"; Same.render = foreign;',
    dependencies: { icons: "npm:lucide-react@^1.0.0" },
    expectedWarningCount: 1,
  },
  {
    name: "runtime-import-equals-sdk",
    setup: 'import Icons = require("lucide-react"); Icons.Check.render = foreign;',
    expectedWarningCount: 1,
  },
  {
    name: "runtime-import-equals-react",
    setup: 'import Runtime = require("react"); Runtime.useEffect = foreign;',
    expectedWarningCount: 1,
  },
  {
    name: "consumed-opaque-callback-result",
    callback: "() => foreign(readNative())",
    expectedWarningCount: 1,
  },
  {
    name: "imported-primitive-callback-result",
    setup: 'import { readNative } from "./helper";',
    callback: "() => foreign(readNative())",
    files: { "src/helper.ts": 'export const readNative = () => "label";' },
    expectedWarningCount: 0,
  },
  {
    name: "published-opaque-callback-result",
    setup: "export let captured = null;",
    callback: "() => { captured = readNative(); }",
    expectedWarningCount: 1,
  },
  {
    name: "destructured-published-opaque-callback-result",
    setup: "export let captured = null;",
    callback: "() => { ({ item: captured } = { item: readNative() }); }",
    expectedWarningCount: 1,
  },
  {
    name: "aliased-published-opaque-callback-result",
    setup: "export let captured = null;",
    callback: "() => { const result = readNative(); captured = result; }",
    expectedWarningCount: 1,
  },
  {
    name: "published-primitive-callback-result",
    setup: "export let captured = null;",
    callback: '() => { captured = "label"; }',
    expectedWarningCount: 0,
  },
  {
    name: "published-imported-primitive-callback-result",
    setup: 'import { readNative } from "./helper"; export let captured = null;',
    callback: "() => { captured = readNative(); }",
    files: { "src/helper.ts": 'export const readNative = () => "label";' },
    expectedWarningCount: 0,
  },
  {
    name: "coerced-opaque-callback-target",
    setup: "let captured = readNative();",
    callback: "() => { captured++; }",
    expectedWarningCount: 1,
  },
  {
    name: "updated-primitive-callback-target",
    setup: "let count = 0;",
    callback: "() => { count++; }",
    expectedWarningCount: 0,
  },
];

afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("native SDK and callback provenance in the native engine", () => {
  it.each(cases)("checks $name", async (testCase) => {
    const rootDirectory = setupReactProject(temporaryDirectory, testCase.name, {
      packageJsonExtras: {
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          next: "^16.0.0",
          ...(testCase.hasSdkRole === false ? {} : { "lucide-react": "^1.0.0" }),
          ...testCase.dependencies,
        },
      },
      files: {
        ...testCase.files,
        "src/App.tsx": `import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
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
export const App = ({ revision }) => {
  const host = useRef(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      if (!(await pause(24, controller.signal))) return;
      host.current.click();
      if (!(await pause(24, controller.signal))) return;
      const duplicate = host.current.querySelector("[data-part]").cloneNode(true);
      setStatus("ready");
    };
    run();
    return () => controller.abort();
  }, [revision]);
  return <button ref={host} type="button" onClick={${testCase.callback ?? "() => notify()"}}><Check data-part="item" /></button>;
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
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "parse-error")).toBe(false);
    const warnings = diagnostics.filter(
      (diagnostic) =>
        diagnostic.rule === "no-set-state-after-await-in-effect" &&
        diagnostic.filePath === "src/App.tsx",
    );
    expect(warnings).toHaveLength(testCase.expectedWarningCount);
  });
});
