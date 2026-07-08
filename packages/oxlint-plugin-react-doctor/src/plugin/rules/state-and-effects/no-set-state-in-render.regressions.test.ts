import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateInRender } from "./no-set-state-in-render.js";

describe("state-and-effects/no-set-state-in-render — regressions", () => {
  it("flags an unconditional top-level setter call in a function component", () => {
    const result = runRule(
      noSetStateInRender,
      `import { useState } from "react";
export function C() {
  const [count, setCount] = useState(0);
  setCount(1);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags the same shape in an arrow-function component", () => {
    const result = runRule(
      noSetStateInRender,
      `import { useState } from "react";
export const C = () => {
  const [open, setOpen] = useState(false);
  setOpen(true);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on the conditional derive-from-props pattern", () => {
    const result = runRule(
      noSetStateInRender,
      `import { useState } from "react";
export function C({ count }) {
  const [prevCount, setPrevCount] = useState(count);
  if (prevCount !== count) {
    setPrevCount(count);
  }
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on setter calls inside event handlers", () => {
    const result = runRule(
      noSetStateInRender,
      `import { useState } from "react";
export function C() {
  const [count, setCount] = useState(0);
  const onClick = () => setCount(count + 1);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
