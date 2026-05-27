import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidRequireCleanup } from "./solid-require-cleanup.js";

describe("solid-require-cleanup", () => {
  it("flags setInterval without onCleanup", () => {
    const result = runRule(
      solidRequireCleanup,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         const id = setInterval(tick, 1000);
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
    expect(result.diagnostics[0].message).toContain("onCleanup");
  });

  it("flags addEventListener without onCleanup", () => {
    const result = runRule(
      solidRequireCleanup,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         window.addEventListener("resize", handler);
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addEventListener");
  });

  it("does not flag when onCleanup is present", () => {
    const result = runRule(
      solidRequireCleanup,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(() => {
         const id = setInterval(tick, 1000);
         onCleanup(() => clearInterval(id));
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag effect without subscriptions", () => {
    const result = runRule(
      solidRequireCleanup,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         console.log(count());
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag without Solid import", () => {
    const result = runRule(
      solidRequireCleanup,
      `createEffect(() => {
         setInterval(tick, 1000);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags requestAnimationFrame without onCleanup", () => {
    const result = runRule(
      solidRequireCleanup,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         const id = requestAnimationFrame(draw);
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("requestAnimationFrame");
    expect(result.diagnostics[0].message).toContain("cancelAnimationFrame");
  });

  it("does not flag when onCleanup is imported with alias", () => {
    const result = runRule(
      solidRequireCleanup,
      `import { createEffect, onCleanup as cleanup } from "solid-js";
       createEffect(() => {
         const id = setInterval(tick, 1000);
         cleanup(() => clearInterval(id));
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag setTimeout inside nested function in effect", () => {
    const result = runRule(
      solidRequireCleanup,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         const start = () => {
           setTimeout(tick, 1000);
         };
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
