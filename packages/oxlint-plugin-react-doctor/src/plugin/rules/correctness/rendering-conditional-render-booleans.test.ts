import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingConditionalRender } from "./rendering-conditional-render.js";

describe("rendering-conditional-render Boolean bindings", () => {
  it.each(["value === 10", "value !== 0", "value > 0", "!value", "true"])(
    "accepts a numeric-looking name initialized by %s",
    (initializer) => {
      const result = runRule(
        renderingConditionalRender,
        `const Panel = ({ value }) => { const atMaxLength = ${initializer}; return <div>{atMaxLength && <span>Full</span>}</div>; };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each([
    `const atMaxLength = value.length`,
    `let atMaxLength = value.length === 10; atMaxLength = 0`,
    `const { atMaxLength = false } = value`,
  ])("retains warnings where zero can reach JSX: %s", (declaration) => {
    const result = runRule(
      renderingConditionalRender,
      `const Panel = ({ value }) => { ${declaration}; return <div>{atMaxLength && <span>Full</span>}</div>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not borrow a Boolean initializer from a shadowed binding", () => {
    const result = runRule(
      renderingConditionalRender,
      `const atMaxLength = true; const Panel = ({ atMaxLength }) => <div>{atMaxLength && <span>Full</span>}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
