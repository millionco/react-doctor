import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoEffectDerivedState } from "./solid-no-effect-derived-state.js";

describe("solid-no-effect-derived-state", () => {
  it("flags createEffect that only calls a setter", () => {
    const result = runRule(
      solidNoEffectDerivedState,
      `import { createSignal, createEffect } from "solid-js";
       const [count, setCount] = createSignal(0);
       const [doubled, setDoubled] = createSignal(0);
       createEffect(() => setDoubled(count() * 2));`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("derived state");
  });

  it("flags createEffect with block body that only has setters", () => {
    const result = runRule(
      solidNoEffectDerivedState,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         setA(value() + 1);
         setB(value() * 2);
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag createEffect with side effects", () => {
    const result = runRule(
      solidNoEffectDerivedState,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         console.log(count());
         setDoubled(count() * 2);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createEffect with DOM mutation", () => {
    const result = runRule(
      solidNoEffectDerivedState,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         document.title = count();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createEffect without Solid import", () => {
    const result = runRule(
      solidNoEffectDerivedState,
      `createEffect(() => setDoubled(count() * 2));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags aliased imports", () => {
    const result = runRule(
      solidNoEffectDerivedState,
      `import { createEffect as eff } from "solid-js";
       eff(() => setCount(value()));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag effect with mixed setter and non-setter statements", () => {
    const result = runRule(
      solidNoEffectDerivedState,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         setDoubled(count() * 2);
         doSomething();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag effect with variable declarations alongside setter", () => {
    const result = runRule(
      solidNoEffectDerivedState,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         const logIt = () => console.log("hi");
         setA(value());
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
