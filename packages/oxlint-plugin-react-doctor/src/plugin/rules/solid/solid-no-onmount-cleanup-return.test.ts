import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoOnmountCleanupReturn } from "./solid-no-onmount-cleanup-return.js";

describe("solid-no-onmount-cleanup-return", () => {
  it("flags returning an arrow cleanup function from onMount", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { const id = setInterval(tick, 1000); return () => clearInterval(id); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("onCleanup");
  });

  it("flags returning a function expression from onMount", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { document.addEventListener("click", handler); return function() { document.removeEventListener("click", handler); }; });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("onCleanup");
  });

  it("flags returning a subscription cleanup from onMount", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { const sub = observable.subscribe(handler); return () => sub.unsubscribe(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags returning a teardown arrow from onMount", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { setup(); return () => teardown(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag onMount with onCleanup and no return", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount, onCleanup } from "solid-js";
       onMount(() => { const id = setInterval(tick, 1000); onCleanup(() => clearInterval(id)); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag onMount without a return statement", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { console.log("mounted"); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag returning a non-function value", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { return 42; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag returning a string value", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { return "done"; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createEffect with cleanup return", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { createEffect } from "solid-js";
       createEffect(() => { return () => cleanup(); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag onMount without solid-js import", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `onMount(() => { return () => cleanup(); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag onMount with fetchData call only", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { fetchData(); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores return of a function in a nested function inside onMount", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { const helper = () => { return () => cleanup(); }; helper(); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag returning a variable reference (cannot statically verify)", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { const fn = () => {}; return fn; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags conditional return of a cleanup function", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => { if (condition) return () => cleanup(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags expression-body arrow returning a function", () => {
    const result = runRule(
      solidNoOnmountCleanupReturn,
      `import { onMount } from "solid-js";
       onMount(() => () => cleanup());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
