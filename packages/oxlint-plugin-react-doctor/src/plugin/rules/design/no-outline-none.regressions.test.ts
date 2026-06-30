import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noOutlineNone } from "./no-outline-none.js";

const run = (code: string) => runRule(noOutlineNone, code, { filename: "fixture.tsx" });

describe("design/no-outline-none — regressions", () => {
  it("does not flag outline:none paired with a tailwind focus-visible ring", () => {
    const result = run(
      `<button style={{ outline: "none" }} className="focus-visible:ring-2 focus-visible:ring-blue-500" />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags outline:none with no replacement focus indicator", () => {
    const result = run(`<button style={{ outline: "none" }} />`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
