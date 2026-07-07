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

  it("does not flag autoFocus behind a logical-and state gate", () => {
    const result = runRule(
      noAutofocus,
      `export const List = ({ isAdding }) => (
        <div>{isAdding && <input autoFocus />}</div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag edit-in-place autoFocus behind a ternary", () => {
    const result = runRule(
      noAutofocus,
      `export const AssetItem = ({ isEditing, name }) => (
        <div>
          {isEditing ? <input autoFocus value={name} /> : <span>{name}</span>}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag autoFocus returned from inside an if statement", () => {
    const result = runRule(
      noAutofocus,
      `export const EditableText = ({ editing, value }) => {
        if (editing) {
          return <input autoFocus value={value} />;
        }
        return <span>{value}</span>;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a computed autoFocus value", () => {
    const result = runRule(
      noAutofocus,
      `export const Navigation = ({ disableFocus }) => (
        <div autoFocus={!disableFocus} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag autoFocus forwarding a consumer flag", () => {
    const result = runRule(
      noAutofocus,
      `export const BaseInputTemplate = ({ autofocus }) => (
        <input autoFocus={autofocus} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags autoFocus={undefined}", () => {
    const result = runRule(noAutofocus, `export const A = () => <input autoFocus={undefined} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags autoFocus rendered unconditionally inside a map callback", () => {
    const result = runRule(
      noAutofocus,
      `export const Fields = ({ fields }) => (
        <div>{fields.map((field) => <input key={field.id} autoFocus />)}</div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // glific Variables/InlineInput: `autoFocus` on a design-system
  // wrapper (MUI TextField). The default `ignoreNonDOM: true` skips
  // PascalCase components deliberately — the wrapper owns how/when to
  // focus, and its internal `<input autoFocus />` is where the rule
  // enforces. Matches jsx-a11y's multi-year default.
  it("does not flag autoFocus on a PascalCase design-system component (glific corpus shape)", () => {
    const result = runRule(
      noAutofocus,
      `export const InlineInput = ({ label, setInputVal }) => (
        <div>
          <TextField
            label={label}
            fullWidth
            onChange={(event) => setInputVal(event.target.value)}
            autoFocus
          />
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
