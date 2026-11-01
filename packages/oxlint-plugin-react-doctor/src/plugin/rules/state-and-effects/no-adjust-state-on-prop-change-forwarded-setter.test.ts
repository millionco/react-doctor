import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const ASSIGN_HELPER = "const assign = (setter, value) => setter(value);";

const getDiagnosticLines = (source: string): ReadonlyArray<number | undefined> => {
  const result = runRule(noAdjustStateOnPropChange, source, { includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map((diagnostic) => diagnostic.line);
};

const buildEditableReset = (helper: string, write: string, effectHook = "useEffect"): string => `
  import { useState, useEffect, useLayoutEffect } from "react";
  ${helper}
  const Editor = ({ recordId }) => {
    const [value, setValue] = useState("");
    ${effectHook}(() => {
      ${write};
    }, [recordId]);
    return <input value={value} onChange={(event) => setValue(event.target.value)} />;
  };
`;

describe("no-adjust-state-on-prop-change forwarded setters", () => {
  it.each([
    ["an expression helper", ASSIGN_HELPER, 'assign(setValue, "")'],
    [
      "a block helper",
      "const assign = (setter, value) => { setter(value); };",
      'assign(setValue, "")',
    ],
    [
      "a returned call",
      "const assign = (setter, value) => { return setter(value); };",
      'assign(setValue, "")',
    ],
    [
      "a function declaration",
      "function assign(setter, value) { setter(value); }",
      'assign(setValue, "")',
    ],
    [
      "reordered arguments",
      "const assign = (value, setter) => setter(value);",
      'assign("", setValue)',
    ],
    [
      "a generic TypeScript helper",
      "const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);",
      'assign(setValue, "")',
    ],
    ["an immutable setter alias", ASSIGN_HELPER, 'const writer = setValue; assign(writer, "")'],
  ])("reports %s where the direct call is reported", (_scenario, helper, write) => {
    const directLines = getDiagnosticLines(buildEditableReset(helper, 'setValue("")'));
    expect(directLines).toHaveLength(1);
    expect(getDiagnosticLines(buildEditableReset(helper, write))).toEqual(directLines);
  });

  it("reports a forwarded write inside a layout effect", () => {
    const directLines = getDiagnosticLines(
      buildEditableReset(ASSIGN_HELPER, 'setValue("")', "useLayoutEffect"),
    );
    expect(directLines).toHaveLength(1);
    expect(
      getDiagnosticLines(
        buildEditableReset(ASSIGN_HELPER, 'assign(setValue, "")', "useLayoutEffect"),
      ),
    ).toEqual(directLines);
  });

  it("reports every forwarded reset when the setter is also forwarded by another effect", () => {
    const buildSource = (write: (setter: string, value: string) => string): string => `
      import { useState, useEffect } from "react";
      ${ASSIGN_HELPER}
      const XComModal = ({ isOpen, data }) => {
        const [key, setKey] = useState("");
        const [value, setValue] = useState("");
        useEffect(() => {
          if (isOpen && data) {
            ${write("setValue", "JSON.stringify(data.value)")};
          }
        }, [data, isOpen]);
        useEffect(() => {
          if (!isOpen) {
            ${write("setKey", '""')};
            ${write("setValue", '""')};
          }
        }, [isOpen]);
        return (
          <>
            <input onChange={(event) => setKey(event.target.value)} value={key} />
            <textarea onChange={(event) => setValue(event.target.value)} value={value} />
          </>
        );
      };
    `;
    const directLines = getDiagnosticLines(buildSource((setter, value) => `${setter}(${value})`));
    expect(directLines).toHaveLength(2);
    expect(
      getDiagnosticLines(buildSource((setter, value) => `assign(${setter}, ${value})`)),
    ).toEqual(directLines);
  });

  it("reports a forwarded functional updater where the direct updater is reported", () => {
    const buildSource = (write: string): string => `
      import { useState, useEffect } from "react";
      ${ASSIGN_HELPER}
      const Picker = ({ items }) => {
        const [selected, setSelected] = useState(null);
        useEffect(() => {
          ${write};
        }, [items]);
        return <select value={selected} onChange={(event) => setSelected(event.target.value)} />;
      };
    `;
    const updater = "(current) => (items.includes(current) ? current : items[0])";
    const directLines = getDiagnosticLines(buildSource(`setSelected(${updater})`));
    expect(directLines).toHaveLength(1);
    expect(getDiagnosticLines(buildSource(`assign(setSelected, ${updater})`))).toEqual(directLines);
  });

  it("reports an effect write when an event handler forwards through the same helper", () => {
    const source = `
      import { useState, useEffect } from "react";
      ${ASSIGN_HELPER}
      const Editor = ({ recordId }) => {
        const [value, setValue] = useState("");
        useEffect(() => { assign(setValue, ""); }, [recordId]);
        return <button onClick={() => assign(setValue, "edited")}>{value}</button>;
      };
    `;
    expect(getDiagnosticLines(source)).toEqual([6]);
  });

  it.each([
    ["an imported helper", 'import { assign } from "writer";', 'assign(setValue, "")'],
    ["an unknown helper", "", 'assign(setValue, "")'],
    [
      "a deferred setter",
      "const assign = (setter, value) => setTimeout(() => setter(value), 0);",
      'assign(setValue, "")',
    ],
    [
      "a returned callback",
      "const assign = (setter, value) => () => setter(value);",
      'assign(setValue, "")',
    ],
    [
      "a registered callback",
      "const assign = (setter, value) => subscribe(setter, value);",
      'assign(setValue, "")',
    ],
    [
      "an async helper",
      "const assign = async (setter, value) => setter(value);",
      'assign(setValue, "")',
    ],
    [
      "a generator helper",
      "function* assign(setter, value) { setter(value); }",
      'assign(setValue, "")',
    ],
    [
      "a conditional helper",
      "const assign = (setter, value) => { if (value) setter(value); };",
      'assign(setValue, "")',
    ],
    [
      "a two-statement helper",
      "const assign = (setter, value) => { track(value); setter(value); };",
      'assign(setValue, "")',
    ],
    [
      "an optional setter call",
      "const assign = (setter, value) => setter?.(value);",
      'assign(setValue, "")',
    ],
    [
      "a replaced helper",
      "let assign = (setter, value) => setter(value); assign = subscribe;",
      'assign(setValue, "")',
    ],
    [
      "a reassigned parameter",
      "const assign = (setter, value) => { setter = subscribe; setter(value); };",
      'assign(setValue, "")',
    ],
    [
      "a subscription in a default parameter",
      "const assign = (setter, value, registration = subscribe((next) => setter(next))) => setter(value);",
      'assign(setValue, "")',
    ],
    [
      "a shadowed setter",
      "const assign = (setter, value) => { const setValue = subscribe; setValue(value); };",
      'assign(setValue, "")',
    ],
    ["a deferred invocation", ASSIGN_HELPER, 'setTimeout(() => assign(setValue, ""), 0)'],
    ["a microtask invocation", ASSIGN_HELPER, 'queueMicrotask(() => assign(setValue, ""))'],
    [
      "a mutable setter alias",
      ASSIGN_HELPER,
      'let writer = setValue; writer = subscribe; assign(writer, "")',
    ],
    ["a non-setter argument", ASSIGN_HELPER, 'assign(subscribe, "")'],
  ])("keeps %s quiet", (_scenario, helper, write) => {
    expect(getDiagnosticLines(buildEditableReset(helper, write))).toEqual([]);
  });

  it.each([
    ["URL.revokeObjectURL(preview);", "setPreview", "null"],
    ["URL.revokeObjectURL(other);", "setPreview", "null"],
    ["URL.revokeObjectURL(preview);", "setDraft", "null"],
  ])("matches the direct released object URL decision for %s %s", (release, setter, value) => {
    const buildSource = (reset: string): string => `
      import { useEffect, useState } from "react";
      ${ASSIGN_HELPER}
      function Preview({ open, other }) {
        const [preview, setPreview] = useState(null);
        const [draft, setDraft] = useState(null);
        useEffect(() => {
          if (!open && preview) { ${release} ${reset}; }
        }, [open, preview, other]);
        return preview || draft;
      }
    `;
    expect(getDiagnosticLines(buildSource(`assign(${setter}, ${value})`))).toEqual(
      getDiagnosticLines(buildSource(`${setter}(${value})`)),
    );
  });

  it.each([
    ["mounted && target.current ? createPortal(children, target.current) : null", 0],
    ["mounted ? children : null", 1],
  ])("matches the direct portal mount decision for %s", (render, expectedCount) => {
    const buildSource = (write: string): string => `
      import { useEffect, useRef, useState } from "react";
      import { createPortal } from "react-dom";
      ${ASSIGN_HELPER}
      function Layer({ selector, children }) {
        const target = useRef(null);
        const [mounted, setMounted] = useState(false);
        useEffect(() => { target.current = document.querySelector(selector); ${write}; }, [selector]);
        return ${render};
      }
    `;
    const directLines = getDiagnosticLines(buildSource("setMounted(true)"));
    expect(directLines).toHaveLength(expectedCount);
    expect(getDiagnosticLines(buildSource("assign(setMounted, true)"))).toEqual(directLines);
  });

  it("matches the direct decision beside observer registration", () => {
    const buildSource = (write: string): string => `
      import { useEffect, useState } from "react";
      ${ASSIGN_HELPER}
      function Feed({ source }) {
        const [selection, setSelection] = useState(null);
        useEffect(() => {
          ${write};
          const observer = new ResizeObserver(() => refresh());
          observer.observe(source);
        }, [source]);
        return selection;
      }
    `;
    expect(getDiagnosticLines(buildSource("setSelection(null)"))).toEqual([]);
    expect(getDiagnosticLines(buildSource("assign(setSelection, null)"))).toEqual([]);
  });
});
