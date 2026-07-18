import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookUseState } from "./hook-use-state.js";

describe("react-builtins/hook-use-state — regressions", () => {
  it("still flags a non-destructured useState when the `React` receiver is wrapped in `as any`", () => {
    const result = runRule(hookUseState, `const state = (React as any).useState(0);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `const useStateTuple = () => useState(0);`,
    `const useStateTuple = () => (useState(0));`,
    `const useStateTuple = () => (useState(0) as readonly [number, unknown]);`,
    `const useStateTuple = () => { return useState(0); };`,
  ])("allows returning a useState tuple without local destructuring", (code) => {
    const result = runRule(hookUseState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([`const state = useState(0);`, `consume(useState(0));`, `useState(0);`])(
    "still reports a non-returned useState tuple",
    (code) => {
      const result = runRule(hookUseState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
