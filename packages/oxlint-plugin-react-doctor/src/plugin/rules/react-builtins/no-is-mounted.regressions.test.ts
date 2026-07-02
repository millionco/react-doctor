import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noIsMounted } from "./no-is-mounted.js";

describe("react-builtins/no-is-mounted — regressions", () => {
  // A plain class that exposes an `isMounted` method is not a React
  // component, so `this.isMounted()` inside it must not be flagged.
  it("stays silent on a non-component class with an isMounted method", () => {
    const result = runRule(
      noIsMounted,
      `class ConnectionPool { active = false; isMounted() { return this.active; } send(m) { if (!this.isMounted()) return; this.write(m); } }`,
      { filename: "pool.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags this.isMounted() inside a React.Component class", () => {
    const result = runRule(
      noIsMounted,
      `class Hello extends React.Component { method() { if (!this.isMounted()) return; } render() { return <div />; } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
