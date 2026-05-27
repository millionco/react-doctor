import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoReactDeps } from "./solid-no-react-deps.js";

describe("solid-no-react-deps", () => {
  it("flags a dependency array passed to createEffect", () => {
    const result = runRule(
      solidNoReactDeps,
      `import { createEffect } from "solid-js";\ncreateEffect(() => {}, [count]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createEffect");
  });

  it("flags a dependency array passed to createMemo", () => {
    const result = runRule(
      solidNoReactDeps,
      `import { createMemo } from "solid-js";\ncreateMemo(() => count(), [count]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag createEffect with a single function argument", () => {
    const result = runRule(
      solidNoReactDeps,
      `import { createEffect } from "solid-js";\ncreateEffect(() => { console.log(count()); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createMemo with an initial value (function takes one param)", () => {
    const result = runRule(
      solidNoReactDeps,
      `import { createMemo } from "solid-js";\ncreateMemo((prev) => prev + 1, 0);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when import is from elsewhere", () => {
    const result = runRule(
      solidNoReactDeps,
      `import { createEffect } from "other-lib";\ncreateEffect(() => {}, [count]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
