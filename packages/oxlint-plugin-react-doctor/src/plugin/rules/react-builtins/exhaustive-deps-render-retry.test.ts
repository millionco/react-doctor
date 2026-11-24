import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const renderRetryMemo = `
  import { useMemo, useState } from "react";

  const History = ({ keyName }: { keyName: string }) => {
    const [changes, setChanges] = useState<string[]>([]);
    const [previousKey, setPreviousKey] = useState(keyName);
    const keyChanged = keyName !== previousKey;
    if (keyChanged) {
      setPreviousKey(keyName);
      setChanges([]);
    }
    const visibleChanges = keyChanged ? [] : changes;
    const summary = useMemo(() => visibleChanges.join(", "), [visibleChanges]);
    return summary;
  };
`;

const run = (code: string, portedRuleMode: "curated" | "upstream" = "curated") => {
  const result = runRule(exhaustiveDeps, code, {
    settings: { "react-doctor": { portedRuleMode } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map((diagnostic) => diagnostic.message);
};

const unstableMessage = "`visibleChanges` is rebuilt every render, so `useMemo` runs every time.";

describe("exhaustive-deps render retry memo fallback", () => {
  it("accepts a fallback created only on a render that adjusts the previous key", () => {
    expect(run(renderRetryMemo)).toEqual([]);
  });

  it("keeps upstream behavior for the same dependency", () => {
    expect(run(renderRetryMemo, "upstream")).toEqual([unstableMessage]);
  });

  it.each([
    ["an unsettled key", "setPreviousKey(keyName);", "setPreviousKey(previousKey);"],
    [
      "a deferred setter",
      "setPreviousKey(keyName);",
      "queueMicrotask(() => setPreviousKey(keyName));",
    ],
    [
      "an escaped setter",
      "setPreviousKey(keyName);",
      "setPreviousKey(keyName); save(setPreviousKey);",
    ],
    ["a fresh settled branch", "keyChanged ? [] : changes", "keyChanged ? [] : [...changes]"],
    ["a different branch test", "keyChanged ? [] : changes", "changes.length === 0 ? [] : changes"],
    ["an unproven key type", "keyName: string", "keyName: number"],
  ])("keeps the warning for %s", (_reason, before, after) => {
    expect(run(renderRetryMemo.replace(before, after))).toEqual([unstableMessage]);
  });

  it("still requires the derived array in the dependency list", () => {
    expect(run(renderRetryMemo.replace("[visibleChanges]", "[]"))).toEqual([
      "Include `visibleChanges.join` explicitly in an inline dependency array for `useMemo`.",
    ]);
  });
});
