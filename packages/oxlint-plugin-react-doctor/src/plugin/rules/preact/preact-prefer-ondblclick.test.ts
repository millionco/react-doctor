import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preactPreferOndblclick } from "./preact-prefer-ondblclick.js";

describe("preact-prefer-ondblclick", () => {
  it("flags `onDoubleClick` on a host element", () => {
    const result = runRule(
      preactPreferOndblclick,
      `
      const Item = () => <li onDoubleClick={openInline}>Item</li>;
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("onDblClick");
  });

  it("flags `onDoubleClick` on a `<button>`", () => {
    const result = runRule(
      preactPreferOndblclick,
      `
      const Editable = () => <button onDoubleClick={beginEdit}>Edit</button>;
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `onDblClick`", () => {
    const result = runRule(
      preactPreferOndblclick,
      `
      const Item = () => <li onDblClick={openInline}>Item</li>;
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `onDoubleClick` on a custom (capitalised) component", () => {
    const result = runRule(
      preactPreferOndblclick,
      `
      const Page = () => <Item onDoubleClick={openInline}>Item</Item>;
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
