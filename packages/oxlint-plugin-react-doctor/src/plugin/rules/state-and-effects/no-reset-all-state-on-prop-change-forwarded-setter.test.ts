import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

const ASSIGN_HELPER = "const assign = (setter, value) => setter(value);";

const getDiagnosticLines = (source: string): ReadonlyArray<number | undefined> => {
  const result = runRule(noResetAllStateOnPropChange, source, { includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map((diagnostic) => diagnostic.line);
};

const buildEditorReset = (
  helper: string,
  write: (setter: string, value: string) => string,
  effectHook = "useEffect",
): string => `
  import { useState, useEffect, useLayoutEffect } from "react";
  ${helper}
  const Editor = ({ recordId }) => {
    const [draft, setDraft] = useState("");
    const [isDirty, setIsDirty] = useState(false);
    ${effectHook}(() => {
      ${write("setDraft", '""')};
      ${write("setIsDirty", "false")};
    }, [recordId]);
    return (
      <input
        data-dirty={isDirty}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setIsDirty(true);
        }}
      />
    );
  };
`;

const directWrite = (setter: string, value: string): string => `${setter}(${value})`;
const assignWrite = (setter: string, value: string): string => `assign(${setter}, ${value})`;

describe("no-reset-all-state-on-prop-change forwarded setters", () => {
  it.each([
    ["an expression helper", ASSIGN_HELPER, assignWrite],
    ["a block helper", "const assign = (setter, value) => { setter(value); };", assignWrite],
    [
      "a returned call",
      "const assign = (setter, value) => { return setter(value); };",
      assignWrite,
    ],
    ["a function declaration", "function assign(setter, value) { setter(value); }", assignWrite],
    [
      "reordered arguments",
      "const assign = (value, setter) => setter(value);",
      (setter: string, value: string) => `assign(${value}, ${setter})`,
    ],
    [
      "a generic TypeScript helper",
      "const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);",
      assignWrite,
    ],
    [
      "an immutable setter alias",
      ASSIGN_HELPER,
      (setter: string, value: string) =>
        `const ${setter}Writer = ${setter}; assign(${setter}Writer, ${value})`,
    ],
    [
      "one direct and one forwarded reset",
      ASSIGN_HELPER,
      (setter: string, value: string) =>
        setter === "setDraft" ? directWrite(setter, value) : assignWrite(setter, value),
    ],
  ])("reports %s where the direct reset is reported", (_scenario, helper, write) => {
    const directLines = getDiagnosticLines(buildEditorReset(helper, directWrite));
    expect(directLines).toHaveLength(1);
    expect(getDiagnosticLines(buildEditorReset(helper, write))).toEqual(directLines);
  });

  it("reports a helper that writes a fixed reset value", () => {
    const buildSource = (write: (setter: string) => string): string => `
      import { useState, useEffect } from "react";
      const clear = (setter) => setter("");
      const Filters = ({ listId }) => {
        const [query, setQuery] = useState("");
        const [owner, setOwner] = useState("");
        useEffect(() => {
          ${write("setQuery")};
          ${write("setOwner")};
        }, [listId]);
        return (
          <>
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
            <input value={owner} onChange={(event) => setOwner(event.target.value)} />
          </>
        );
      };
    `;
    const directLines = getDiagnosticLines(buildSource((setter) => `${setter}("")`));
    expect(directLines).toHaveLength(1);
    expect(getDiagnosticLines(buildSource((setter) => `clear(${setter})`))).toEqual(directLines);
  });

  it("reports a forwarded reset inside a layout effect", () => {
    const directLines = getDiagnosticLines(
      buildEditorReset(ASSIGN_HELPER, directWrite, "useLayoutEffect"),
    );
    expect(directLines).toHaveLength(1);
    expect(
      getDiagnosticLines(buildEditorReset(ASSIGN_HELPER, assignWrite, "useLayoutEffect")),
    ).toEqual(directLines);
  });

  it("reports the closing reset when another effect also forwards a setter", () => {
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
    const directLines = getDiagnosticLines(buildSource(directWrite));
    expect(directLines).toHaveLength(1);
    expect(getDiagnosticLines(buildSource(assignWrite))).toEqual(directLines);
  });

  it.each([
    ["an imported helper", 'import { assign } from "writer";'],
    ["an unknown helper", ""],
    ["a deferred setter", "const assign = (setter, value) => setTimeout(() => setter(value), 0);"],
    ["a returned callback", "const assign = (setter, value) => () => setter(value);"],
    ["a registered callback", "const assign = (setter, value) => subscribe(setter, value);"],
    ["an async helper", "const assign = async (setter, value) => setter(value);"],
    ["a generator helper", "function* assign(setter, value) { setter(value); }"],
    ["a conditional helper", "const assign = (setter, value) => { if (value) setter(value); };"],
    [
      "a two-statement helper",
      "const assign = (setter, value) => { track(value); setter(value); };",
    ],
    ["an optional setter call", "const assign = (setter, value) => setter?.(value);"],
    ["a replaced helper", "let assign = (setter, value) => setter(value); assign = subscribe;"],
    [
      "a reassigned parameter",
      "const assign = (setter, value) => { setter = subscribe; setter(value); };",
    ],
    [
      "a subscription in a default parameter",
      "const assign = (setter, value, registration = subscribe((next) => setter(next))) => setter(value);",
    ],
    [
      "a shadowed setter",
      "const assign = (setter, value) => { const setDraft = subscribe; setDraft(value); };",
    ],
  ])("keeps %s quiet", (_scenario, helper) => {
    expect(getDiagnosticLines(buildEditorReset(ASSIGN_HELPER, directWrite))).toHaveLength(1);
    expect(getDiagnosticLines(buildEditorReset(helper, assignWrite))).toEqual([]);
  });

  it.each([
    [
      "a deferred invocation",
      (setter: string, value: string) => `setTimeout(() => assign(${setter}, ${value}), 0)`,
    ],
    [
      "a microtask invocation",
      (setter: string, value: string) => `queueMicrotask(() => assign(${setter}, ${value}))`,
    ],
    [
      "a mutable setter alias",
      (setter: string, value: string) =>
        `let ${setter}Writer = ${setter}; ${setter}Writer = subscribe; assign(${setter}Writer, ${value})`,
    ],
    ["a non-setter argument", (_setter: string, value: string) => `assign(subscribe, ${value})`],
  ])("keeps %s quiet", (_scenario, write) => {
    expect(getDiagnosticLines(buildEditorReset(ASSIGN_HELPER, write))).toEqual([]);
  });

  it.each([
    ["a value that is not the initial state", '"draft"'],
    ["a prop value", "recordId"],
  ])("matches the direct decision for %s", (_scenario, value) => {
    const buildSource = (write: (setter: string, value: string) => string): string =>
      buildEditorReset(ASSIGN_HELPER, (setter, initialValue) =>
        write(setter, setter === "setDraft" ? value : initialValue),
      );
    expect(getDiagnosticLines(buildSource(directWrite))).toEqual([]);
    expect(getDiagnosticLines(buildSource(assignWrite))).toEqual([]);
  });

  it.each([
    ["a direct reset and a direct reload", directWrite, directWrite],
    ["a forwarded reset and a direct reload", assignWrite, directWrite],
    ["a direct reset and a forwarded reload", directWrite, assignWrite],
    ["a forwarded reset and a forwarded reload", assignWrite, assignWrite],
  ])("keeps %s quiet", (_scenario, resetWrite, reloadWrite) => {
    expect(
      getDiagnosticLines(`
        import { useState, useEffect } from "react";
        ${ASSIGN_HELPER}
        const Results = ({ query, search }) => {
          const [items, setItems] = useState([]);
          useEffect(() => {
            ${resetWrite("setItems", "[]")};
            search(query).then((next) => ${reloadWrite("setItems", "next")});
          }, [query]);
          return items.map((item) => <p key={item}>{item}</p>);
        };
      `),
    ).toEqual([]);
  });

  it("matches the direct decision when a hidden tooltip handler forwards its write", () => {
    const buildSource = (resetWrite: string, handlerWrite: string): string => `
      import { useEffect, useState } from "react";
      ${ASSIGN_HELPER}
      interface SelectItemProps {
        highlighted?: boolean;
      }
      export const SelectItem = ({ highlighted }: SelectItemProps) => {
        const [canShowTooltip, setCanShowTooltip] = useState(true);
        useEffect(() => {
          ${resetWrite};
        }, [highlighted]);
        return (
          highlighted &&
          canShowTooltip && <output onKeyDown={() => ${handlerWrite}}>Disabled reason</output>
        );
      };
    `;
    expect(
      getDiagnosticLines(buildSource("setCanShowTooltip(true)", "setCanShowTooltip(false)")),
    ).toEqual([]);
    expect(
      getDiagnosticLines(
        buildSource("assign(setCanShowTooltip, true)", "assign(setCanShowTooltip, false)"),
      ),
    ).toEqual([]);
  });

  it("keeps a reset of only some state quiet", () => {
    const source = buildEditorReset(ASSIGN_HELPER, (setter, value) =>
      setter === "setDraft" ? assignWrite(setter, value) : "track(recordId)",
    );
    expect(getDiagnosticLines(source)).toEqual([]);
  });
});

describe("forwarded reset resource ownership", () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])("preserves image latch reset=%s event=%s", (forwardedReset, forwardedEvent) => {
    expect(
      getDiagnosticLines(`
      import { useEffect, useState } from "react";
      ${ASSIGN_HELPER}
      function Image({ src }) {
        const [failed, setFailed] = useState(false);
        useEffect(() => { ${forwardedReset ? "assign(setFailed, false)" : "setFailed(false)"}; }, [src]);
        return <img src={src} alt={failed ? "failed" : "image"} onError={() => ${forwardedEvent ? "assign(setFailed, true)" : "setFailed(true)"}} />;
      }
    `),
    ).toEqual([]);
  });

  it("does not transfer another state variable's resource latch", () => {
    expect(
      getDiagnosticLines(`
      import { useEffect, useState } from "react";
      ${ASSIGN_HELPER}
      function Image({ src }) {
        const [failed, setFailed] = useState(false);
        const [other, setOther] = useState(false);
        useEffect(() => { assign(setFailed, false); assign(setOther, false); }, [src]);
        return <img src={src} alt={failed ? "failed" : String(other)} onError={() => assign(setOther, true)} />;
      }
    `),
    ).toHaveLength(1);
  });
});

describe("forwarded reset setter identity", () => {
  it("counts two immutable aliases of one setter as one state variable", () => {
    expect(
      getDiagnosticLines(`
      import { useEffect, useState } from "react";
      ${ASSIGN_HELPER}
      function Editor({ recordId }) {
        const [draft, setDraft] = useState("");
        const [note, setNote] = useState("");
        const first = setDraft;
        const second = setDraft;
        useEffect(() => { assign(first, ""); assign(second, ""); }, [recordId]);
        return <><input value={draft} onChange={(event) => setDraft(event.target.value)} /><input value={note} onChange={(event) => setNote(event.target.value)} /></>;
      }
    `),
    ).toEqual([]);
  });
});

describe("forwarded reset value and reload compatibility", () => {
  it("reports a zero-argument setter helper like its direct equivalent", () => {
    const buildSource = (write: string): string => `
      import { useEffect, useState } from "react";
      const clear = (setter) => setter();
      function Editor({ recordId }) {
        const [draft, setDraft] = useState();
        useEffect(() => { ${write}; }, [recordId]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }
    `;
    expect(getDiagnosticLines(buildSource("setDraft()"))).toHaveLength(1);
    expect(getDiagnosticLines(buildSource("clear(setDraft)"))).toHaveLength(1);
  });

  it("preserves async reloads through another immutable alias", () => {
    expect(
      getDiagnosticLines(`
      import { useEffect, useState } from "react";
      ${ASSIGN_HELPER}
      function Editor({ recordId }) {
        const [draft, setDraft] = useState("");
        const resetDraft = setDraft;
        const reloadDraft = setDraft;
        useEffect(() => {
          assign(resetDraft, "");
          Promise.resolve(recordId).then((value) => assign(reloadDraft, value));
        }, [recordId]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      }
    `),
    ).toEqual([]);
  });
});
