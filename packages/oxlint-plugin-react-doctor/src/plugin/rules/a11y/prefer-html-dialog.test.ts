import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferHtmlDialog } from "./prefer-html-dialog.js";

describe("prefer-html-dialog", () => {
  it('flags `<div role="dialog">`', () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Modal = () => (
        <div role="dialog" aria-labelledby="title">
          <h2 id="title">Confirm</h2>
        </div>
      );
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<dialog>`");
  });

  it('flags `<section role="alertdialog">`', () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Confirm = () => (
        <section role="alertdialog">
          Are you sure?
        </section>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `<div aria-modal="true">` (string-true)', () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Modal = () => (
        <div aria-modal="true">
          Modal contents
        </div>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("aria-modal");
  });

  it("flags `<div aria-modal={true}>` (boolean-true)", () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Modal = () => (
        <div aria-modal={true}>
          Modal contents
        </div>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `<dialog>` itself", () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Modal = () => (
        <dialog role="dialog" aria-modal="true">
          Modal contents
        </dialog>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag `<div role="status">` (unrelated role)', () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Toast = () => <div role="status">Saved</div>;
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag `<div aria-modal="false">`', () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Container = () => <div aria-modal="false">Not a modal</div>;
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a custom-component `<Dialog>` (we cannot inspect its internals)", () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Page = () => (
        <Dialog role="dialog">
          <h2>Confirm</h2>
        </Dialog>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("only reports the `role` attribute when both role and aria-modal are present (avoids double-flag noise)", () => {
    const result = runRule(
      preferHtmlDialog,
      `
      const Modal = () => (
        <div role="dialog" aria-modal="true">
          x
        </div>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
