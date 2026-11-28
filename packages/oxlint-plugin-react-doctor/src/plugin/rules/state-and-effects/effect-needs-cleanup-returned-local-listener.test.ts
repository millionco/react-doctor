import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const listener = `import { useEffect, useState } from "react";

export function Monitor() {
  const [changed, setChanged] = useState(false);
  const handleChange = () => setChanged(true);
  const receiver = {
    on(handler) {
      document.addEventListener("change", handler);
      return () => document.removeEventListener("change", handler);
    },
  };
  useEffect(() => receiver.on(handleChange), [receiver]);
  return <output>{String(changed)}</output>;
}`;

describe("directly returned local listener cleanup", () => {
  it.each([
    ["an expression body", listener],
    [
      "a block return",
      listener.replace(
        "() => receiver.on(handleChange)",
        "() => { return receiver.on(handleChange); }",
      ),
    ],
  ])("accepts matching registration and removal in %s", (_case, source) => {
    const result = runRule(effectNeedsCleanup, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "no removal",
      listener.replace('() => document.removeEventListener("change", handler)', "() => {}"),
    ],
    [
      "the wrong callback",
      listener.replace(
        'removeEventListener("change", handler)',
        'removeEventListener("change", other)',
      ),
    ],
    [
      "the wrong event",
      listener.replace(
        'removeEventListener("change", handler)',
        'removeEventListener("other", handler)',
      ),
    ],
    [
      "the wrong target",
      listener.replace("document.removeEventListener", "window.removeEventListener"),
    ],
    [
      "an unreturned disposer",
      listener.replace("() => receiver.on(handleChange)", "() => { receiver.on(handleChange); }"),
    ],
    [
      "a changed registration method",
      listener.replace("  useEffect(", "  receiver.on = replacement; useEffect("),
    ],
    ["an escaped receiver", listener.replace("  useEffect(", "  retain(receiver); useEffect(")],
    [
      "another registration in an argument",
      listener.replace(
        'addEventListener("change", handler)',
        'addEventListener("change", handler, false, window.addEventListener("resize", handler))',
      ),
    ],
    [
      "another registration in cleanup",
      listener.replace(
        '() => document.removeEventListener("change", handler)',
        '() => { window.addEventListener("resize", handler); document.removeEventListener("change", handler); }',
      ),
    ],
    [
      "a replaced browser method",
      listener.replace("  useEffect(", "  document.removeEventListener = () => {}; useEffect("),
    ],
    [
      "a replaced method through a browser alias",
      listener.replace(
        "  useEffect(",
        "  const target = document; target.removeEventListener = () => {}; useEffect(",
      ),
    ],
    [
      "a replaced prototype method",
      listener.replace(
        "  useEffect(",
        "  EventTarget.prototype.removeEventListener = () => {}; useEffect(",
      ),
    ],
    [
      "a registration default that replaces the cleanup method",
      listener.replace(
        "on(handler)",
        "on(handler, _default = (document.removeEventListener = () => {}))",
      ),
    ],
    ["an async effect callback", listener.replace("useEffect(() =>", "useEffect(async () =>")],
    [
      "a listener that replaces the removal method through its event",
      listener.replace(
        "() => setChanged(true)",
        "(event) => { event.currentTarget.removeEventListener = () => {}; }",
      ),
    ],
    [
      "a listener that replaces the removal method through this",
      listener.replace(
        "() => setChanged(true)",
        "function () { this.removeEventListener = () => {}; }",
      ),
    ],
    [
      "a registration that uses another listener",
      listener
        .replace(
          "  const receiver",
          "  const other = (event) => { event.currentTarget.removeEventListener = () => {}; };\n  const receiver",
        )
        .replaceAll('("change", handler)', '("change", other)'),
    ],
  ])("still warns with %s", (_case, source) => {
    const result = runRule(effectNeedsCleanup, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
