import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoCleanupAfterAwait } from "./solid-no-cleanup-after-await.js";

describe("solid-no-cleanup-after-await", () => {
  it("flags onCleanup after await in createEffect", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(async () => {
         await fetch("/api");
         onCleanup(() => console.log("cleanup"));
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createEffect");
    expect(result.diagnostics[0].message).toContain("after");
  });

  it("flags onCleanup after await in createResource fetcher", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createResource, onCleanup } from "solid-js";
       const [data] = createResource(signal, async (s) => {
         const ctrl = new AbortController();
         const res = await fetch("/url", { signal: ctrl.signal });
         onCleanup(() => ctrl.abort());
         return res.json();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createResource");
  });

  it("flags onCleanup after await in createRenderEffect", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createRenderEffect, onCleanup } from "solid-js";
       createRenderEffect(async () => {
         const x = await loadThing();
         onCleanup(() => x.dispose());
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createRenderEffect");
  });

  it("flags onCleanup after await in createComputed", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createComputed, onCleanup } from "solid-js";
       createComputed(async () => {
         await someWork();
         onCleanup(() => {});
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createComputed");
  });

  it("does not flag onCleanup before await in createEffect", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(async () => {
         onCleanup(() => console.log("cleanup"));
         await fetch("/api");
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag onCleanup before await in createResource", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createResource, onCleanup } from "solid-js";
       const [data] = createResource(signal, async (s) => {
         const ctrl = new AbortController();
         onCleanup(() => ctrl.abort());
         const res = await fetch("/url", { signal: ctrl.signal });
         return res.json();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag synchronous createEffect with onCleanup", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(() => {
         const id = setInterval(tick, 1000);
         onCleanup(() => clearInterval(id));
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag onCleanup at component top level", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { onCleanup } from "solid-js";
       const Comp = () => { onCleanup(() => {}); return <div />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag without solid-js import", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `createEffect(async () => {
         await fetch("/api");
         onCleanup(() => {});
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags multiple onCleanup calls after await", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(async () => {
         await fetch("/api");
         onCleanup(() => console.log("a"));
         onCleanup(() => console.log("b"));
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags only the onCleanup after await when one is before and one after", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(async () => {
         onCleanup(() => console.log("safe"));
         await fetch("/api");
         onCleanup(() => console.log("broken"));
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("after");
  });

  it("does not flag onCleanup inside a nested non-async function after await", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(async () => {
         await fetch("/api");
         const helper = () => { onCleanup(() => {}); };
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("handles aliased imports", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect as eff, onCleanup as cleanup } from "solid-js";
       eff(async () => {
         await fetch("/api");
         cleanup(() => {});
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createEffect");
  });

  it("does not flag async function expression that is not a callback to a primitive", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { onCleanup } from "solid-js";
       const run = async () => {
         await fetch("/api");
         onCleanup(() => {});
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags onCleanup after await in single-arg createResource (no source signal)", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createResource, onCleanup } from "solid-js";
       const [data] = createResource(async () => {
         const ctrl = new AbortController();
         const res = await fetch("/api", { signal: ctrl.signal });
         onCleanup(() => ctrl.abort());
         return res.json();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createResource");
  });

  it("does not flag onCleanup before await in single-arg createResource", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createResource, onCleanup } from "solid-js";
       const [data] = createResource(async () => {
         const ctrl = new AbortController();
         onCleanup(() => ctrl.abort());
         const res = await fetch("/api", { signal: ctrl.signal });
         return res.json();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags onCleanup in catch block after await in try", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(async () => {
         try {
           await fetch("/api");
         } catch (e) {
           onCleanup(() => console.log("cleanup in catch"));
         }
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags cleanup between two awaits", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(async () => {
         await fetch("/first");
         onCleanup(() => console.log("between awaits"));
         await fetch("/second");
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag non-async callback with onCleanup (for-await requires async)", () => {
    const result = runRule(
      solidNoCleanupAfterAwait,
      `import { createEffect, onCleanup } from "solid-js";
       createEffect(() => {
         onCleanup(() => console.log("safe"));
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
