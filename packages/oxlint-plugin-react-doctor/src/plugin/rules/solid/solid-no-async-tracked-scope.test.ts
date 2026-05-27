import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoAsyncTrackedScope } from "./solid-no-async-tracked-scope.js";

describe("solid-no-async-tracked-scope", () => {
  it("flags signal read inside setTimeout within createEffect", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [count, setCount] = createSignal(0);
       createEffect(() => { setTimeout(() => { console.log(count()); }, 1000); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setTimeout");
    expect(result.diagnostics[0].message).toContain("createEffect");
  });

  it("flags signal read inside setInterval within createEffect", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [value] = createSignal("x");
       createEffect(() => { setInterval(() => { doSomething(value()); }, 500); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
  });

  it("flags signal read inside requestAnimationFrame within createEffect", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [pos] = createSignal(0);
       createEffect(() => { requestAnimationFrame(() => { updateCanvas(pos()); }); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("requestAnimationFrame");
  });

  it("flags signal read inside setTimeout within createMemo", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createMemo, createSignal } from "solid-js";
       const [x] = createSignal(0);
       const derived = createMemo(() => { let result = 0; setTimeout(() => { result = x(); }, 0); return result; });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createMemo");
  });

  it("flags signal read inside setTimeout within createComputed", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createComputed, createSignal } from "solid-js";
       const [name] = createSignal("hello");
       createComputed(() => { setTimeout(() => { console.log(name()); }, 100); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createComputed");
  });

  it("flags signal read inside setTimeout within createRenderEffect", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createRenderEffect, createSignal } from "solid-js";
       const [color] = createSignal("red");
       createRenderEffect(() => { setTimeout(() => { el.style.color = color(); }, 0); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createRenderEffect");
  });

  it("does not flag synchronous signal reads in reactive scope", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [count] = createSignal(0);
       createEffect(() => { console.log(count()); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag captured signal value passed into setTimeout", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [count] = createSignal(0);
       createEffect(() => { const c = count(); setTimeout(() => { console.log(c); }, 1000); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag onMount with setTimeout", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { onMount, createSignal } from "solid-js";
       const [count] = createSignal(0);
       onMount(() => { setTimeout(() => { console.log(count()); }, 1000); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag setTimeout outside any reactive scope", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createSignal } from "solid-js";
       const [count] = createSignal(0);
       setTimeout(() => { console.log(count()); }, 100);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag without solid-js import", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `const [count] = createSignal(0);
       createEffect(() => { setTimeout(() => { console.log(count()); }, 1000); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags multiple scheduler calls in one reactive scope", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [a] = createSignal(0);
       const [b] = createSignal(1);
       createEffect(() => {
         setTimeout(() => { console.log(a()); }, 100);
         setInterval(() => { console.log(b()); }, 200);
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag setTimeout callback with no signal reads", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect } from "solid-js";
       createEffect(() => { setTimeout(() => { console.log("hello"); }, 1000); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("handles aliased imports", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect as eff, createSignal } from "solid-js";
       const [count] = createSignal(0);
       eff(() => { setTimeout(() => { console.log(count()); }, 1000); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createEffect");
  });

  it("flags signal read inside queueMicrotask within createEffect", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [count] = createSignal(0);
       createEffect(() => { queueMicrotask(() => { console.log(count()); }); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("queueMicrotask");
  });

  it("does not flag Promise.then inside effect (member expression callee)", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [count] = createSignal(0);
       createEffect(() => { somePromise.then(() => { console.log(count()); }); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag window.setTimeout (member expression callee)", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect, createSignal } from "solid-js";
       const [count] = createSignal(0);
       createEffect(() => { window.setTimeout(() => { console.log(count()); }, 1000); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag scheduler callback without signal reads (just regular function calls)", () => {
    const result = runRule(
      solidNoAsyncTrackedScope,
      `import { createEffect } from "solid-js";
       createEffect(() => { setTimeout(() => { doWork(someArg); }, 100); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
