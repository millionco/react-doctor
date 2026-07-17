import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTransitionedFocusRing } from "./no-transitioned-focus-ring.js";

describe("no-transitioned-focus-ring", () => {
  it("flags a focus ring animated through box-shadow", () => {
    const result = runRule(
      noTransitionedFocusRing,
      `const Button = () => <button className="transition-shadow duration-200 focus-visible:ring-2 focus-visible:ring-blue-500">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an arbitrary outline transition", () => {
    const result = runRule(
      noTransitionedFocusRing,
      `const Button = () => <button className="transition-[outline] focus-visible:outline-2">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows instant focus with animated hover color", () => {
    const result = runRule(
      noTransitionedFocusRing,
      `const Button = () => <button className="transition-colors hover:bg-blue-600 focus-visible:ring-2">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
