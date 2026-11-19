import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

const rule = wrapWithSemanticContext(noPassLiveStateToParent) as Rule;

const fixture = (setup: string, invocation = "schedule();", before = ""): string => `
  import { useCallback, useEffect, useState } from "react";
  ${before}
  export function SessionCounter({ onValue }: { onValue: (value: number) => void }) {
    const [value] = useState(5);
    const report = useCallback(() => {
      onValue(value);
    }, [onValue, value]);

    const schedule = useCallback((_input?: unknown) => {
      ${setup}
    }, [report, onValue, value]);

    useEffect(() => {
      ${invocation}
    }, [schedule, onValue, value]);
    return null;
  }
`;

describe("no-pass-live-state-to-parent native timer callbacks", () => {
  it.each([
    ["an interval", fixture("setInterval(() => { report(); }, 100);")],
    ["a timeout", fixture("setTimeout(() => { report(); }, 100);")],
    [
      "a synchronous literal beside deferred live state",
      fixture("onValue(0); setInterval(() => { report(); }, 100);"),
    ],
  ])("ignores live state reached through %s", (_name, code) => {
    const result = runRule(rule, code, { filename: "counter.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "a synchronous sibling posting the state",
      fixture("setInterval(() => { report(); }, 100); onValue(value);"),
    ],
    [
      "an argument that posts the state before scheduling",
      fixture("setInterval(() => { report(); }, 100);", "schedule(onValue(value));"),
    ],
    [
      "a shadowed interval",
      fixture(
        "setInterval(() => { report(); }, 100);",
        undefined,
        "const setInterval = (callback: () => void, _delay: number) => { callback(); return 0; };",
      ),
    ],
    [
      "a replaced native interval through the document's window",
      fixture(
        "setInterval(() => { report(); }, 100);",
        undefined,
        "document.defaultView!.setInterval = (callback: () => void) => { callback(); return 0; };",
      ),
    ],
    ["a synchronous collection callback", fixture("[1].forEach(() => { report(); });")],
  ])("reports %s", (_name, code) => {
    const result = runRule(rule, code, { filename: "counter.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
