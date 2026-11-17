import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const CLOSED_RECORD_ARRAY = `
  import { useState } from "react";
  function ChoiceList() {
    const [entries, setEntries] = useState([]);
    const load = () => {
      const freshEntries = [];
      freshEntries.push({ label: "First", checked: false });
      setEntries(freshEntries);
    };
    const change = (position) => {
      const nextEntries = [...entries];
      if (!nextEntries[position].checked) {
        nextEntries[position].checked = true;
        nextEntries[position].element = null;
      } else {
        nextEntries[position].checked = false;
      }
      setEntries(nextEntries);
    };
    return <div><button onClick={load}>Load</button>{entries.map((entry, position) =>
      <button key={position} onClick={() => change(position)}>{entry.label}</button>
    )}</div>;
  }
`;

const diagnosticsFor = (source: string) => {
  const result = runRule(noDirectStateMutation, source);
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("no-direct-state-mutation shallow copies", () => {
  it("reports the retained own records but leaves a new field unsupported", () => {
    expect(diagnosticsFor(CLOSED_RECORD_ARRAY)).toHaveLength(2);
  });

  it("accepts literal record seeds and inline map indices", () => {
    expect(
      diagnosticsFor(`
      import { useState } from "react";
      function ChoiceList() {
        const [entries, setEntries] = useState([{ checked: false }]);
        return entries.map((entry, position) => {
          const nextEntries = [...entries];
          nextEntries[position].checked = true;
          setEntries(nextEntries);
          return <span>{entry.checked}</span>;
        });
      }
    `),
    ).toHaveLength(1);
  });

  it("accepts a named function expression without self references", () => {
    expect(
      diagnosticsFor(
        CLOSED_RECORD_ARRAY.replace(
          "const change = (position) =>",
          "const change = function Change(position)",
        ),
      ),
    ).toHaveLength(2);
  });

  it.each([
    'Change("map");',
    "unknown(Change);",
    "Change = replacement;",
    "({ Change } = replacement);",
    'arguments.callee("map");',
    'arguments[0] = "map";',
  ])("rejects alternate function-expression invocation through %s", (statement) => {
    const source = CLOSED_RECORD_ARRAY.replace(
      "const change = (position) =>",
      "const change = function Change(position)",
    ).replace("const nextEntries =", `${statement} const nextEntries =`);
    expect(diagnosticsFor(source)).toEqual([]);
  });

  it("rejects arrow capture of runtime arguments", () => {
    expect(
      diagnosticsFor(
        CLOSED_RECORD_ARRAY.replace(
          "const nextEntries =",
          "unknown(arguments); const nextEntries =",
        ),
      ),
    ).toEqual([]);
  });

  it("rejects a native map callback with named self calls", () => {
    expect(
      diagnosticsFor(`
      import { useState } from "react";
      function Choices() {
        const [entries, setEntries] = useState([{ checked: false }]);
        return entries.map(function Iterate(entry, position) {
          if (typeof position === "number") { Iterate(entry, "map"); return; }
          const copy = [...entries];
          copy[position].checked = false;
          setEntries(copy);
          return <span>{entry.checked}</span>;
        });
      }
    `),
    ).toEqual([]);
  });

  it.each([
    ["opaque initializer", "useState([])", "useState(getEntries())"],
    ["prop initializer", "useState([])", "useState(props.entries)"],
    ["lazy initializer", "useState([])", "useState(() => [])"],
    ["shadowed hook", 'import { useState } from "react";', "const useState = factory;"],
    ["namespace hook", 'import { useState } from "react";', 'import React from "react";'],
    ["opaque feed", "setEntries(freshEntries);", "setEntries(getEntries());"],
    ["callback feed", "setEntries(freshEntries);", "setEntries(previous => previous);"],
    [
      "deep copied records",
      "const nextEntries = [...entries];",
      "const nextEntries = entries.map(entry => ({ ...entry }));",
    ],
    [
      "replaced copied index",
      "if (!nextEntries[position].checked)",
      "nextEntries[position] = { checked: false }; if (!nextEntries[position].checked)",
    ],
    ["mutable copy", "const nextEntries", "let nextEntries"],
    [
      "copy reassignment",
      "if (!nextEntries[position].checked)",
      "nextEntries = []; if (!nextEntries[position].checked)",
    ],
    [
      "pattern reassignment",
      "if (!nextEntries[position].checked)",
      "({ nextEntries } = replacement); if (!nextEntries[position].checked)",
    ],
    [
      "unknown copy escape",
      "if (!nextEntries[position].checked)",
      "unknown(nextEntries); if (!nextEntries[position].checked)",
    ],
    [
      "unknown record escape",
      "if (!nextEntries[position].checked)",
      "unknown(nextEntries[position]); if (!nextEntries[position].checked)",
    ],
    ["state escape", "const change =", "unknown(entries); const change ="],
    ["setter escape", "const change =", "unknown(setEntries); const change ="],
    [
      "builder escape",
      "setEntries(freshEntries);",
      "unknown(freshEntries); setEntries(freshEntries);",
    ],
    ["builder record accessor", "checked: false", "get checked() { return false; }"],
    ["builder record method", "checked: false", "checked() { return false; }"],
    ["builder record spread", 'label: "First", checked: false', "...record"],
    ["builder record duplicate key", "checked: false", "checked: false, checked: true"],
    ["builder record computed key", "checked: false", "[key]: false"],
    ["builder record prototype", "checked: false", "checked: false, __proto__: prototype"],
    ["missing own data key", "checked: false", "other: false"],
    ["nested record method", "{entry.label}", "{entry.label.getOwner()}"],
    ["record returned by method", "{entry.label}", "{expose(entry.label())}"],
    [
      "copied record method escape",
      "if (!nextEntries[position].checked)",
      "expose(nextEntries[position].label()); if (!nextEntries[position].checked)",
    ],
    [
      "legacy getter definition",
      "if (!nextEntries[position].checked)",
      "nextEntries[position].__defineGetter__('checked', freshValue); if (!nextEntries[position].checked)",
    ],
    ["record exposed from renderer", "{entry.label}", "{expose(entry)}"],
    ["map parameter reassignment", "{entry.label}", "{(entry = replacement).label}"],
    ["handler index reassignment", "const nextEntries", "position = key; const nextEntries"],
    ["map index reassignment", "change(position)", "change(position = key)"],
    ["opaque handler call", "<button onClick={load}>", "<button onClick={() => change(key)}>"],
    ["handler escape", "onClick={() => change(position)}", "onClick={change}"],
    ["unknown index", "change(position)", "change(key)"],
    ["derived index", "change(position)", "change(position + offset)"],
    ["callback value index", "change(position)", "change(entry)"],
    [
      "copy iterator replacement",
      "if (!nextEntries[position].checked)",
      "nextEntries[Symbol.iterator] = iterator; if (!nextEntries[position].checked)",
    ],
    [
      "state iterator replacement",
      "const change =",
      "entries[Symbol.iterator] = iterator; const change =",
    ],
    ["native map replacement", "const change =", "Array.prototype.map = mapper; const change ="],
    [
      "native alias escape",
      "const change =",
      "const intrinsic = Array; unknown(intrinsic); const change =",
    ],
    [
      "global alias access",
      "const change =",
      "const root = globalThis; unknown(root); const change =",
    ],
    [
      "computed prototype alias",
      "const change =",
      'const key = "__proto__"; const nativePrototype = [][key]; nativePrototype.map = customMap; const change =',
    ],
    [
      "opaque computed prototype alias",
      "const change =",
      "const nativePrototype = [][key]; unknown(nativePrototype); const change =",
    ],
    [
      "multiple prototype aliases",
      "const change =",
      'const array = []; const key = "__proto__"; const nativePrototype = array[key]; unknown(nativePrototype); const change =',
    ],
    [
      "prototype alias access",
      "const change =",
      "const prototype = [].constructor.prototype; unknown(prototype); const change =",
    ],
    [
      "descriptor index getter",
      "const change =",
      "Object.defineProperty(entries, '0', { get: freshRecord }); const change =",
    ],
    ["native push replacement", "const load =", "Array.prototype.push = customPush; const load ="],
    [
      "builder push replacement",
      "freshEntries.push",
      "freshEntries.push = customPush; freshEntries.push",
    ],
    ["async handler", "const change = (position)", "const change = async (position)"],
    ["callback ref", "<button onClick={load}>", "<button ref={setEntries} onClick={load}>"],
  ])("stays quiet for %s", (_name, before, after) => {
    let source = CLOSED_RECORD_ARRAY.replace(before, after);
    if (_name === "namespace hook") source = source.replace("useState([])", "React.useState([])");
    expect(
      diagnosticsFor(source).filter((diagnostic) =>
        diagnostic.message.startsWith("Copying the array"),
      ),
    ).toEqual([]);
  });

  it.each([
    ["return", "return;"],
    ["throw", 'throw new Error("stop");'],
    ["false branch", "if (false)"],
    ["zero branch", "if (0)"],
    ["bigint zero branch", "if (0n)"],
  ])("ignores unreachable writes after %s", (_name, guard) => {
    const source = CLOSED_RECORD_ARRAY.replace(
      "if (!nextEntries[position].checked)",
      guard.startsWith("if") ? guard : `${guard} if (!nextEntries[position].checked)`,
    );
    const count = guard.startsWith("if") ? 1 : 0;
    expect(diagnosticsFor(source)).toHaveLength(count);
  });

  it("preserves existing direct-state warnings when the new proof fails", () => {
    const source = CLOSED_RECORD_ARRAY.replace(
      "const change =",
      "unknown(entries); entries.push({ checked: false }); const change =",
    );
    expect(diagnosticsFor(source)).toHaveLength(1);
  });

  it("does not report mutations of the new outer container", () => {
    const source = CLOSED_RECORD_ARRAY.replace(
      "nextEntries[position].checked = true;",
      "nextEntries.reverse();",
    ).replace("nextEntries[position].checked = false;", "nextEntries.splice(position, 1);");
    expect(diagnosticsFor(source)).toEqual([]);
  });
});
