import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

const source = `
  import { useEffect, useState } from "react";

  export function useSection(element: HTMLElement, initial: number) {
    const [section, setSection] = useState({ ratio: initial });

    useEffect(() => {
      const tracker = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          setSection({ ratio: entry.intersectionRatio });
        });
      });
      tracker.observe(element);
      return () => tracker.disconnect();
    }, [element]);

    useEffect(() => { setSection({ ratio: initial }); }, [initial]);
    return section;
  }
`;

const lint = (code: string) => {
  const result = runRule(noDerivedState, code, { filename: "observer.tsx" });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("no-derived-state with a registered IntersectionObserver", () => {
  it("keeps a reset for state written by native observer delivery", () => {
    expect(lint(source)).toEqual([]);
  });

  it("keeps a reset for a guarded nullable Element state target", () => {
    const guarded = source
      .replace(
        "const [section",
        "const [node, setNode] = useState<Element | null>(null); const [section",
      )
      .replace("const tracker", "if (!node) return; const tracker")
      .replace("tracker.observe(element)", "tracker.observe(node)")
      .replace("return section;", "return { section, setNode };");
    expect(lint(guarded)).toEqual([]);
  });

  it("retains a warning when a guarded Element state can never leave its null initializer", () => {
    const dormant = source
      .replace("const [section", "const [node] = useState<Element | null>(null); const [section")
      .replace("const tracker", "if (!node) return; const tracker")
      .replace("tracker.observe(element)", "tracker.observe(node)");
    expect(lint(dormant)).toHaveLength(1);
  });

  it("retains a warning when a non-null type is contradicted by its initializer", () => {
    const missing = source
      .replace("const [section", "const [node] = useState<Element>(null!); const [section")
      .replace("tracker.observe(element)", "tracker.observe(node)");
    expect(lint(missing)).toHaveLength(1);
  });

  it("keeps the warning when a returned tuple overwrites the ref setter", () => {
    const replaced = source
      .replace(
        "const [section",
        "const [node, setNode] = useState<Element | null>(null); const [section",
      )
      .replace("const tracker", "if (!node) return; const tracker")
      .replace("tracker.observe(element)", "tracker.observe(node)")
      .replace("return section;", "const output = [setNode]; output[0] = () => {}; return output;");
    expect(lint(replaced)).toHaveLength(1);
  });

  it.each([
    ["unregistered instance", source.replace("tracker.observe(element);", "")],
    [
      "dead registration",
      source.replace("tracker.observe(element);", "if (false) tracker.observe(element);"),
    ],
    [
      "synchronous disconnect",
      source.replace("return () => tracker.disconnect();", "tracker.disconnect();"),
    ],
    ["foreign receiver", source.replace("tracker.observe(element)", "other.observe(element)")],
    [
      "null target",
      source
        .replace("const tracker", "const missing = null; const tracker")
        .replace("tracker.observe(element)", "tracker.observe(missing)"),
    ],
    [
      "non-element target",
      source
        .replace("const tracker", "const clock = new Date(); const tracker")
        .replace("tracker.observe(element)", "tracker.observe(clock)"),
    ],
    [
      "an inactive nested writer",
      source.replace(
        "setSection({ ratio: entry.intersectionRatio });",
        "const later = () => setSection({ ratio: entry.intersectionRatio });",
      ),
    ],
    [
      "unused entry data",
      source.replace("ratio: entry.intersectionRatio", "ratio: (entry, initial)"),
    ],
    [
      "a replaced iteration method",
      source.replace("entries.forEach", "entries.forEach = () => {}; entries.forEach"),
    ],
    [
      "a replaced global provider",
      source.replace(
        "export function",
        "window.IntersectionObserver = Replacement; export function",
      ),
    ],
    [
      "an escaped global provider",
      source.replace(
        "export function",
        "const box = { host: window }; replaceObserver(box); export function",
      ),
    ],
    [
      "mutation through the observer threshold array",
      source.replace(
        "entries.forEach",
        "tracker.thresholds.constructor.prototype.forEach = () => {}; entries.forEach",
      ),
    ],
  ])("keeps the existing warning for %s", (_label, code) => {
    expect(lint(code)).toHaveLength(1);
  });
});
