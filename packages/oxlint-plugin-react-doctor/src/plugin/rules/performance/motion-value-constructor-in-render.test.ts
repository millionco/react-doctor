import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionValueConstructorInRender } from "./motion-value-constructor-in-render.js";

describe("motion-value-constructor-in-render", () => {
  it("reports imported constructors executed while rendering", () => {
    const result = runRule(
      motionValueConstructorInRender,
      `import { motionValue as createValue } from "motion/react";
       const Digit = ({ value }) => { const current = createValue(value); return <span>{current.get()}</span>; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows the React hook, module values, stable initializers, and events", () => {
    const result = runRule(
      motionValueConstructorInRender,
      `import { motionValue, useMotionValue } from "motion/react";
       import { useMemo } from "react";
       const shared = motionValue(0);
       const Digit = ({ value }) => {
         const current = useMotionValue(value);
         const stable = useMemo(() => motionValue(value), []);
         const onClick = () => motionValue(value);
         return <button onClick={onClick}>{current.get() + stable.get()}</button>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports useMemo without a dependency array", () => {
    const result = runRule(
      motionValueConstructorInRender,
      `import { motionValue } from "motion/react";
       import { useMemo } from "react";
       const Digit = ({ value }) => {
         const current = useMemo(() => motionValue(value));
         return <span>{current.get()}</span>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores unrelated constructors", () => {
    const result = runRule(
      motionValueConstructorInRender,
      `const motionValue = (value) => value; const Digit = () => motionValue(1);`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
