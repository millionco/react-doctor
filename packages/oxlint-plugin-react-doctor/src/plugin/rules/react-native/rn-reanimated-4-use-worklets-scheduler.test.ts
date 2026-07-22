import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnReanimated4UseWorkletsScheduler } from "./rn-reanimated-4-use-worklets-scheduler.js";

const SCHEDULER_REPLACEMENT_PAIRS = [
  ["runOnUI", "scheduleOnUI"],
  ["runOnJS", "scheduleOnRN"],
  ["executeOnUIRuntimeSync", "runOnUISync"],
  ["runOnRuntime", "scheduleOnRuntime"],
];

describe("react-native/rn-reanimated-4-use-worklets-scheduler", () => {
  it.each(SCHEDULER_REPLACEMENT_PAIRS)(
    "recommends %s as the replacement for %s",
    (apiName, replacementName) => {
      const result = runRule(
        rnReanimated4UseWorkletsScheduler,
        `import { ${apiName} } from "react-native-reanimated"; ${apiName}(() => {});`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain(apiName);
      expect(result.diagnostics[0].message).toContain(replacementName);
      expect(result.diagnostics[0].message).toContain("react-native-worklets");
    },
  );

  it("resolves a renamed import through a const alias", () => {
    const result = runRule(
      rnReanimated4UseWorkletsScheduler,
      `import { runOnJS as callOnJavaScript } from "react-native-reanimated";
      const invoke = callOnJavaScript;
      invoke(() => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("scheduleOnRN");
  });

  it("resolves a namespace member through transparent wrappers", () => {
    const result = runRule(
      rnReanimated4UseWorkletsScheduler,
      `import * as Reanimated from "react-native-reanimated";
      (Reanimated.runOnRuntime)(runtime, () => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("scheduleOnRuntime");
  });

  it("stays silent on the Worklets replacements", () => {
    const result = runRule(
      rnReanimated4UseWorkletsScheduler,
      `import { scheduleOnUI, scheduleOnRN, runOnUISync, scheduleOnRuntime } from "react-native-worklets";
      scheduleOnUI(() => {});
      scheduleOnRN(() => {});
      runOnUISync(() => {});
      scheduleOnRuntime(runtime, () => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on same-named imports from another package", () => {
    const result = runRule(
      rnReanimated4UseWorkletsScheduler,
      `import { runOnUI, runOnJS } from "./scheduler";
      runOnUI(() => {});
      runOnJS(() => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a shadowed Reanimated import", () => {
    const result = runRule(
      rnReanimated4UseWorkletsScheduler,
      `import { runOnUI } from "react-native-reanimated";
      const Component = () => {
        const runOnUI = (callback) => callback();
        return runOnUI(() => {});
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a locally shadowed namespace", () => {
    const result = runRule(
      rnReanimated4UseWorkletsScheduler,
      `import * as Reanimated from "react-native-reanimated";
      const Component = () => {
        const Reanimated = { runOnJS: (callback) => callback() };
        return Reanimated.runOnJS(() => {});
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
