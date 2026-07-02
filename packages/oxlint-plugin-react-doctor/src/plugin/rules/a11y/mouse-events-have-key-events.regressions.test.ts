import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mouseEventsHaveKeyEvents } from "./mouse-events-have-key-events.js";

describe("a11y/mouse-events-have-key-events regressions", () => {
  it("exempts a hover handler explicitly set to `undefined` (no handler bound)", () => {
    const result = runRule(mouseEventsHaveKeyEvents, `<div onMouseOver={undefined} />`);
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts an explicit-undefined hover-out handler too", () => {
    const result = runRule(mouseEventsHaveKeyEvents, `<div onMouseOut={undefined} />`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a real hover handler with no focus handler", () => {
    const result = runRule(mouseEventsHaveKeyEvents, `<div onMouseOver={() => {}} />`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
