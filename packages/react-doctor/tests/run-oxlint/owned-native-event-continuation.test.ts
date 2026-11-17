import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "../regressions/_helpers.js";
import { assertNativeSyntaxSuccess } from "./utils/assert-native-syntax-success.js";

interface OwnedNativeEventCase {
  name: string;
  methodCall: string;
  hasFreshBarrier: boolean;
  expectedWarningCount: number;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-owned-native-event-"));
const eventCases: ReadonlyArray<OwnedNativeEventCase> = [
  {
    name: "click-with-barrier",
    methodCall: "click()",
    hasFreshBarrier: true,
    expectedWarningCount: 0,
  },
  {
    name: "click-without-barrier",
    methodCall: "click()",
    hasFreshBarrier: false,
    expectedWarningCount: 1,
  },
  {
    name: "dispatch-with-barrier",
    methodCall: 'dispatchEvent(new Event("updated"))',
    hasFreshBarrier: true,
    expectedWarningCount: 0,
  },
  {
    name: "dispatch-without-barrier",
    methodCall: 'dispatchEvent(new Event("updated"))',
    hasFreshBarrier: false,
    expectedWarningCount: 1,
  },
  { name: "unproved-focus", methodCall: "focus()", hasFreshBarrier: true, expectedWarningCount: 1 },
  {
    name: "unknown-method",
    methodCall: "activate()",
    hasFreshBarrier: true,
    expectedWarningCount: 1,
  },
];

afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("owned native event continuation in the native engine", () => {
  it.each(eventCases)("checks $name", async (eventCase) => {
    const freshBarrier = "if (!(await pause(24, controller.signal))) return;";
    const rootDirectory = setupReactProject(temporaryDirectory, eventCase.name, {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", next: "^16.0.0" },
      },
      files: {
        "src/App.tsx": `import { useEffect, useRef, useState } from "react";
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
      ${freshBarrier}
      host.current.${eventCase.methodCall};
      ${eventCase.hasFreshBarrier ? freshBarrier : ""}
      setStatus("ready");
    };
    run();
    return () => controller.abort();
  }, [revision]);
  return <button ref={host} type="button">Press</button>;
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
    expect(warnings).toHaveLength(eventCase.expectedWarningCount);
  });
});
