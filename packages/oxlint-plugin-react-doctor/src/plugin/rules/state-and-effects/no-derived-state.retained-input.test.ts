import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";

const source = `
  import { useEffect, useState } from "react";

  export function useAnnouncement(phase: "waiting" | "acknowledged", message?: string) {
    const [announcement, setAnnouncement] = useState(message);
    useEffect(() => {
      if (message) setAnnouncement(message);
    }, [message]);
    useEffect(() => {
      if (phase === "acknowledged") setAnnouncement(undefined);
    }, [phase]);
    return announcement;
  }
`;

const countReports = (code: string) =>
  [noDerivedState, noDerivedStateEffect].map((rule) => {
    const result = runRule(rule, code, { filename: "announcement.tsx" });
    expect(result.parseErrors).toEqual([]);
    return result.diagnostics.length;
  });

describe("derived-state rules on inputs retained between effects", () => {
  it("keeps the last present value until another input schedules a reset", () => {
    expect(countReports(source)).toEqual([0, 0]);
  });

  it("recognizes a local union type with present and absent values", () => {
    const typed = source
      .replace("export function", 'type Notice = "new" | undefined; export function')
      .replace("message?: string", "message: Notice");
    expect(countReports(typed)).toEqual([0, 0]);
  });

  it("retains a direct mirror beside the retained value", () => {
    const withMirror = source.replace(
      "return announcement;",
      "const [label, setLabel] = useState(phase); useEffect(() => setLabel(phase), [phase]); return { announcement, label };",
    );
    expect(countReports(withMirror)).toEqual([1, 1]);
  });

  it.each([
    [
      "an unconditional mirror",
      source.replace("if (message) setAnnouncement(message);", "setAnnouncement(message);"),
    ],
    [
      "a fallback assignment",
      source.replace(
        "if (message) setAnnouncement(message);",
        "if (message) setAnnouncement(message); else setAnnouncement(undefined);",
      ),
    ],
    ["a different initializer", source.replace("useState(message)", "useState(undefined)")],
    ["shared dependencies", source.replace("[phase]);", "[message, phase]);")],
    ["a different guard", source.replace("if (message)", 'if (phase === "waiting")')],
    [
      "a different setter",
      source.replace(
        'if (phase === "acknowledged") setAnnouncement(undefined);',
        'if (phase === "acknowledged") setOther(undefined);',
      ),
    ],
    [
      "an escaped setter",
      source.replace("return announcement;", "register(setAnnouncement); return announcement;"),
    ],
    [
      "a shadowed clear value",
      source.replace("message?: string)", 'message?: string, undefined = "other")'),
    ],
    [
      "a default that removes the missing value",
      source.replace(
        'phase: "waiting" | "acknowledged", message?: string',
        'phase: "waiting", message: "new" | "old" | undefined = "new"',
      ),
    ],
    [
      "a local type that contains only missing values",
      source
        .replace("export function", "type Missing = null | undefined; export function")
        .replace("message?: string", "message?: Missing"),
    ],
    ["a function-valued input", source.replace("message?: string", "message?: () => undefined")],
  ])("keeps reporting %s", (_label, code) => {
    expect(countReports(code)).toEqual([1, 1]);
  });
});
