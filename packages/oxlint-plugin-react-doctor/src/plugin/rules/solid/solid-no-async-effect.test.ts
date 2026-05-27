import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoAsyncEffect } from "./solid-no-async-effect.js";

describe("solid-no-async-effect", () => {
  it("flags async arrow in createEffect", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect(async () => {
         const data = await fetchData(count());
         setResult(data);
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createEffect");
    expect(result.diagnostics[0].message).toContain("tracking scope");
  });

  it("flags async function expression in createEffect", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect(async function() {
         await something();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createEffect");
  });

  it("flags async arrow in createRenderEffect", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createRenderEffect } from "solid-js";
       createRenderEffect(async () => {
         await loadStyles();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createRenderEffect");
  });

  it("flags async arrow in createComputed", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createComputed } from "solid-js";
       createComputed(async () => {
         const v = await compute();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createComputed");
  });

  it("flags aliased import", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect as fx } from "solid-js";
       fx(async () => {
         await x();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createEffect");
  });

  it("does not flag synchronous createEffect", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         console.log(count());
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .then() inside synchronous callback", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         fetchData(count()).then(setResult);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createResource with async fetcher", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createResource } from "solid-js";
       const [data] = createResource(count, async (c) => {
         return await fetchData(c);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag onMount with async callback", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { onMount } from "solid-js";
       onMount(async () => {
         await loadData();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag async inside a nested function in the callback", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         const load = async () => {
           await x();
         };
         load();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag without solid-js import", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `createEffect(async () => {
         await doSomething();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags multiple async effects in the same file", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect, createComputed } from "solid-js";
       createEffect(async () => { await a(); });
       createComputed(async () => { await b(); });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag createEffect with no arguments", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createEffect with a non-function argument", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect(someVariable);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag sync callback that returns an async function", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         return async () => { await doWork(); };
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag identifier reference as callback (cannot statically verify)", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       const myAsyncFn = async () => { await x(); };
       createEffect(myAsyncFn);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags async arrow with no await (async keyword alone breaks tracking)", () => {
    const result = runRule(
      solidNoAsyncEffect,
      `import { createEffect } from "solid-js";
       createEffect(async () => {
         console.log("no await but still async");
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
