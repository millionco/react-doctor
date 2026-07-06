import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAutofocus } from "./no-autofocus.js";

describe("a11y/no-autofocus regressions", () => {
  it("does not flag autoFocus inside an aria-modal dialog", () => {
    const result = runRule(
      noAutofocus,
      `export const ConfirmDialog = () => (
        <div role="dialog" aria-modal="true">
          <input autoFocus />
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag autoFocus inside a role=dialog surface", () => {
    const result = runRule(
      noAutofocus,
      `export const Prompt = () => (
        <div role="dialog">
          <textarea autoFocus />
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag autoFocus inside a native dialog element", () => {
    const result = runRule(
      noAutofocus,
      `export const Settings = () => (
        <dialog open>
          <input autoFocus />
        </dialog>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags autoFocus on a plain page-level input", () => {
    const result = runRule(
      noAutofocus,
      `export const SearchPage = () => (
        <main>
          <input autoFocus />
        </main>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags autoFocus inside a non-dialog role container", () => {
    const result = runRule(
      noAutofocus,
      `export const Nav = () => (
        <div role="navigation">
          <input autoFocus />
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags autoFocus in a conditionally rendered form outside a dialog", () => {
    const result = runRule(
      noAutofocus,
      `export const List = ({ isAdding }) => (
        <div>{isAdding && <input autoFocus />}</div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
