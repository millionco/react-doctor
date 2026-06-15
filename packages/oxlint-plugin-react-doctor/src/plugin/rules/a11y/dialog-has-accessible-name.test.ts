import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { dialogHasAccessibleName } from "./dialog-has-accessible-name.js";

describe("dialog-has-accessible-name", () => {
  it("flags a native `<dialog>` with no name", () => {
    const result = runRule(
      dialogHasAccessibleName,
      `const M = () => <dialog open><p>Body</p></dialog>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("accessible name");
  });

  it('flags `<div role="dialog">` with no name', () => {
    const result = runRule(dialogHasAccessibleName, `const M = () => <div role="dialog">x</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `<section role="alertdialog">` with no name', () => {
    const result = runRule(
      dialogHasAccessibleName,
      `const M = () => <section role="alertdialog">Sure?</section>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a `<dialog>` with aria-label", () => {
    const result = runRule(
      dialogHasAccessibleName,
      `const M = () => <dialog aria-label="Settings">x</dialog>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `<dialog>` named via aria-labelledby", () => {
    const result = runRule(
      dialogHasAccessibleName,
      `const M = () => <dialog aria-labelledby="title"><h2 id="title">Hi</h2></dialog>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `<dialog>` named via title", () => {
    const result = runRule(
      dialogHasAccessibleName,
      `const M = () => <dialog title="Settings">x</dialog>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag an unrelated role (`role="status"`)', () => {
    const result = runRule(
      dialogHasAccessibleName,
      `const T = () => <div role="status">Saved</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a custom `<Modal role="dialog">` component', () => {
    const result = runRule(
      dialogHasAccessibleName,
      `const P = () => <Modal role="dialog">x</Modal>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic role that is not statically a dialog", () => {
    const result = runRule(dialogHasAccessibleName, `const P = ({ r }) => <div role={r}>x</div>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `<dialog>` with a spread that may supply a name", () => {
    const result = runRule(dialogHasAccessibleName, `const M = (p) => <dialog {...p}>x</dialog>;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
