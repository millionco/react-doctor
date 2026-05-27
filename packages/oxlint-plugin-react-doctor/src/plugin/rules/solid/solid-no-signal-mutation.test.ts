import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoSignalMutation } from "./solid-no-signal-mutation.js";

describe("solid-no-signal-mutation", () => {
  it("flags .push() on signal getter", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createSignal } from "solid-js";
       const [items, setItems] = createSignal([]);
       items().push("new");`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".push()");
  });

  it("flags .sort() on signal getter", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createSignal } from "solid-js";
       const [items, setItems] = createSignal([]);
       items().sort();`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".sort()");
  });

  it("flags property assignment on signal getter", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createSignal } from "solid-js";
       const [obj, setObj] = createSignal({});
       obj().name = "test";`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".name");
  });

  it("does not flag non-signal calls", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createSignal } from "solid-js";
       const items = getItems();
       items.push("new");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags memo mutation", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createMemo } from "solid-js";
       const doubled = createMemo(() => [1, 2]);
       doubled().push(3);`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("memo");
  });

  it("does not flag without solid import", () => {
    const result = runRule(
      solidNoSignalMutation,
      `const [items, setItems] = createSignal([]);
       items().push("new");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags property assignment on memo return value", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createMemo } from "solid-js";
       const data = createMemo(() => ({ name: "x" }));
       data().name = "y";`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("memo");
  });

  it("does not flag deeply nested signal().nested.push() (limitation)", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createSignal } from "solid-js";
       const [data, setData] = createSignal({ nested: [] });
       data().nested.push("x");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .reverse() on non-signal array", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createSignal } from "solid-js";
       const plainArray = [3, 1, 2];
       plainArray.reverse();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags .splice() on signal getter", () => {
    const result = runRule(
      solidNoSignalMutation,
      `import { createSignal } from "solid-js";
       const [items, setItems] = createSignal([1, 2, 3]);
       items().splice(0, 1);`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".splice()");
  });
});
