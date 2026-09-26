import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

const expectDiagnosticCount = (body: string, count: number): void => {
  const result = runRule(
    noDerivedState,
    `import { useEffect, useState } from "react";
    function useDraft(value) {
      const [draft, setDraft] = useState(value);
      useEffect(() => { setDraft(value); }, [value]);
      ${body}
    }`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("no-derived-state escaped-draft-setter", () => {
  it("allows the staged draft returned to a consumer event handler", () => {
    const result = runRule(
      noDerivedState,
      `import React from "react";
      const useDraft = ({ selectedValue, onChange }) => {
        const [open, setOpen] = React.useState(false);
        const [draft, setDraft] = React.useState(selectedValue);
        React.useEffect(() => {
          if (!open) setDraft(selectedValue);
        }, [selectedValue, open]);
        const close = () => { setOpen(false); onChange(draft); };
        return { draft: open ? draft : selectedValue, setDraft, setOpen, close };
      };
      function Picker(props) {
        const { draft, setDraft: edit, setOpen, close } = useDraft(props);
        return <PickerInput value={draft} onValueChange={next => edit(next)}
          onOpen={() => setOpen(true)} onClose={close} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "return setDraft;",
    "return [draft, setDraft] as const;",
    "return { draft, update: setDraft };",
    'return { ["update"]: setDraft };',
    "return { controls: { update: setDraft } };",
    "const edit = setDraft; const update = edit; return { update };",
    "const edit = (setDraft satisfies Function); return [draft, edit!];",
    "if (value) return setDraft; return draft;",
  ])("allows an escaped writable setter: %s", (body) => {
    expectDiagnosticCount(body, 0);
  });

  it.each([
    "return draft;",
    "return { draft };",
    "return { setDraft: draft };",
    "return { [setDraft]: draft };",
    "return setDraft.name;",
    "return { update: setDraft(value) };",
    "const unused = () => setDraft; return draft;",
    "const unused = () => { return { setDraft }; }; return draft;",
    "if (false) return setDraft; return draft;",
    "return draft; return setDraft;",
    "{ const setDraft = () => {}; return { setDraft }; }",
    "let edit = setDraft; edit = () => {}; return edit;",
    "const [other, setOther] = useState(value); return { setDraft: setOther };",
    "return { update: setDraft, update: () => {} };",
    "const result = { setDraft }; result.setDraft = () => {}; return result;",
  ])("keeps prop-copy positives when no setter escapes: %s", (body) => {
    expectDiagnosticCount(body, 1);
  });

  it("does not follow a reassigned setter binding", () => {
    const result = runRule(
      noDerivedState,
      `import { useEffect, useState } from "react";
      function useDraft(value) {
        let [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        setDraft = () => {};
        return { draft, setDraft };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("bounds alias propagation and terminates cycles", () => {
    const aliases = Array.from(
      { length: 100 },
      (_, index) => `const alias${index} = ${index === 0 ? "setDraft" : `alias${index - 1}`};`,
    ).join("\n");
    expectDiagnosticCount(`${aliases} return alias99;`, 1);
    expectDiagnosticCount("const first = second; const second = first; return first;", 1);
  });
});
