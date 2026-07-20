import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnboundedAnimationFrameLoop } from "./no-unbounded-animation-frame-loop.js";

const run = (code: string) =>
  runRule(noUnboundedAnimationFrameLoop, code, { filename: "motion.ts" });

describe("no-unbounded-animation-frame-loop", () => {
  it("flags a declaration that unconditionally reschedules itself", () => {
    const result = run(
      `function draw(time) { render(time); requestAnimationFrame(draw); } requestAnimationFrame(draw);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a const-bound arrow through window.requestAnimationFrame", () => {
    const result = run(
      `const tick = () => { update(); window.requestAnimationFrame(tick); }; tick();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a loop with an explicit stop gate", () => {
    const result = run(
      `function draw(time) { if (!running) return; render(time); requestAnimationFrame(draw); }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a loop guarded by logical short-circuiting", () => {
    const result = run(
      `function draw(time) { render(time); running && requestAnimationFrame(draw); }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a loop that retains every active request ID", () => {
    const result = run(
      `let frameId; const draw = () => { render(); frameId = requestAnimationFrame(draw); }; const stop = () => cancelAnimationFrame(frameId);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores one-shot frame callbacks", () => {
    const result = run(`requestAnimationFrame(() => render());`);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a shadowed requestAnimationFrame helper", () => {
    const result = run(
      `const requestAnimationFrame = (callback) => queue.push(callback); function drain() { requestAnimationFrame(drain); }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores deliberate loops in test files", () => {
    const result = runRule(
      noUnboundedAnimationFrameLoop,
      `const tick = () => { update(); requestAnimationFrame(tick); }; tick();`,
      { filename: "/repo/e2e/freeze-animations.spec.ts" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
