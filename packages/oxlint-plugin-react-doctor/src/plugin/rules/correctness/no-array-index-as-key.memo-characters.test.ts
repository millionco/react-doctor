import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("memoized positional characters", () => {
  it.each([
    ['import { useMemo } from "react";', "useMemo(() => Array.from(label), [label])"],
    ['import { useMemo as cache } from "react";', "cache(() => Array.from(label), [label])"],
    ['import { useMemo } from "react";', "useMemo(() => { return Array.from(label); }, [label])"],
  ])("accepts an unobserved character array with %s", (imports, initializer) => {
    const result = runRule(
      noArrayIndexAsKey,
      `${imports}
const Caption = ({ label }: { label: string }) => {
  const letters = ${initializer};
  return letters.map((letter, index) => <span key={index}>{letter}</span>);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a string parameter declared by a same-file interface", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo } from "react";
interface CaptionProps { label: string; enabled: boolean; }
const Caption = ({ label, enabled }: CaptionProps) => {
  const letters = useMemo(() => Array.from(label), [label]);
  if (enabled) return letters.map((letter, index) => <span key={index}>{letter}</span>);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["stateful child", "<Glyph key={index} value={letter} />"],
    ["member child", "<Motion.span key={index}>{letter}</Motion.span>"],
    ["spread attributes", "<span key={index} {...props}>{letter}</span>"],
    ["callback ref", "<span key={index} ref={rememberNode}>{letter}</span>"],
    ["event handler", "<span key={index} onClick={handleClick}>{letter}</span>"],
    ["nested custom element", "<span key={index}><x-glyph>{letter}</x-glyph></span>"],
    ["opaque child", "<span key={index}>{format(letter)}</span>"],
    ["cloned element", "cloneElement(element, { key: index })"],
  ])("keeps memoized positions reportable for %s", (_label, child) => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { cloneElement, useMemo, useState } from "react";
const Glyph = ({ value }: { value: string }) => {
  const [first] = useState(value);
  return <span>{first}:{value}</span>;
};
const Caption = ({ label }: { label: string }) => {
  const letters = useMemo(() => Array.from(label), [label]);
  return letters.map((letter, index) => ${child});
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["const field = 'rows';", "{ field: string; rows: ReactNode[] }", "[field]: value"],
    ["const field = Symbol();", "{ field: string; [field]: ReactNode[] }", "[field]: value"],
    ["const field = 'other';", "{ [field]: string; field: ReactNode[] }", "field: value"],
    ["", "{ field?: string }", "field: value = ''"],
  ])("keeps uncertain memo property identity reportable: %s %s %s", (setup, props, binding) => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo, type ReactNode } from "react";
${setup}
const Caption = ({ ${binding} }: ${props}) => {
  const letters = useMemo(() => Array.from(value), [value]);
  return letters.map((letter, index) => <span key={index}>{letter}</span>);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["interface Props { readonly label: string }", "label: value"],
    ["type TextProps = { readonly 'label': string }; type Props = TextProps;", "'label': value"],
  ])("accepts an exact readonly string property: %s", (declaration, binding) => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo } from "react";
${declaration}
const Caption = ({ ${binding} }: Props) => {
  const letters = useMemo(() => Array.from(value), [value]);
  return letters.map((letter, index) => <span key={index}>{letter}</span>);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "type Contents = { readonly label: string }; type Props<Contents> = Contents;",
      "Props<{ label: ReactNode[] }>",
    ],
    [
      "type Contents = { readonly label: string }; type Props<Contents = { label: ReactNode[] }> = Contents;",
      "Props",
    ],
    ["interface Props<Unused = never> { readonly label: string }", "Props"],
  ])("keeps generic memo property types reportable: %s", (declaration, props) => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo, type ReactNode } from "react";
${declaration}
const Caption = ({ label: value }: ${props}) => {
  const letters = useMemo(() => Array.from(value), [value]);
  return letters.map((letter, index) => <span key={index}>{letter}</span>);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps the existing direct character behavior", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `const Caption = ({ label }: { label: string }) =>
  Array.from(label).map((letter, index) => <Glyph key={index} value={letter} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['import { useMemo } from "other-cache";', "", "Array.from(label)", "label", ""],
    ['import { useMemo } from "react";', "", "Array.from(records)", "records", ""],
    ['import { useMemo } from "react";', "", "Array.from(label, makeRecord)", "label", ""],
    ['import { useMemo } from "react";', "", 'label.split(" ")', "label", ""],
    ['import { useMemo } from "react";', "", "Array.from(label)", "records", ""],
    ['import { useMemo } from "react";', "", "Array.from(label)", "label", "letters.reverse();"],
    ['import { useMemo } from "react";', "", "Array.from(label)", "label", "letters.push(record);"],
    ['import { useMemo } from "react";', "", "Array.from(label)", "label", "letters[0] = record;"],
    ['import { useMemo } from "react";', "", "Array.from(label)", "label", "consume(letters);"],
    [
      'import { useMemo } from "react";',
      "",
      "Array.from(label)",
      "label",
      "const alias = letters;",
    ],
    [
      'import { useMemo } from "react";',
      "const Array = factory;",
      "Array.from(label)",
      "label",
      "",
    ],
    ['import { useMemo } from "react";', "Array.from = factory;", "Array.from(label)", "label", ""],
    [
      'import { useMemo } from "react";',
      "const useMemo = customMemo;",
      "Array.from(label)",
      "label",
      "",
    ],
    [
      'import { useMemo } from "react";',
      "const Array = { get from() { return factory; } };",
      "Array.from(label)",
      "label",
      "",
    ],
  ])(
    "preserves the boundary for %s %s %s %s %s",
    (imports, setup, calculation, dependency, usage) => {
      const result = runRule(
        noArrayIndexAsKey,
        `${imports}
const Caption = ({ label, records }: { label: string; records: RecordData[] }) => {
  ${setup}
  const letters = useMemo(() => ${calculation}, [${dependency}]);
  ${usage}
  return letters.map((letter, index) => <Glyph key={index} value={letter} />);
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    "async () => Array.from(label)",
    "function* () { return Array.from(label); }",
    "(value = records) => Array.from(value)",
    "() => { consume(label); return Array.from(label); }",
    "() => readLetters(label)",
    "() => Array.from(label).reverse()",
  ])("keeps an unsupported calculation reportable: %s", (factory) => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo } from "react";
const Caption = ({ label }: { label: string }) => {
  const letters = useMemo(${factory}, [label]);
  return letters.map((letter, index) => <Glyph key={index} value={letter} />);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ['import type { useMemo } from "react";', "", "useMemo"],
    ['import { type useMemo } from "react";', "", "useMemo"],
    ['import React from "react";', "", "React.useMemo"],
    ['import React from "react";', "React.useMemo = () => records;", "React.useMemo"],
    [
      'import { useMemo } from "react"; import React from "react";',
      "React.useMemo = () => records;",
      "useMemo",
    ],
    [
      'import { useMemo } from "react"; import * as React from "react";',
      'Object.defineProperty(React, "useMemo", { value: () => records });',
      "useMemo",
    ],
    [
      'import { useMemo } from "react"; import React from "react";',
      "const facade = React; facade.useMemo = () => records;",
      "useMemo",
    ],
    [
      'import { useMemo } from "react";',
      'Object.defineProperty(Array, "from", { get: () => () => records });',
      "useMemo",
    ],
    ['import { useMemo } from "react";', 'Reflect.set(Array, "from", () => records);', "useMemo"],
    [
      'import { useMemo } from "react";',
      "const nativeArray = Array; nativeArray.from = () => records;",
      "useMemo",
    ],
    [
      'import { useMemo } from "react";',
      'Object.defineProperty(globalThis.Array, "from", { value: () => records });',
      "useMemo",
    ],
    [
      'import { useMemo } from "react";',
      "Object.assign(globalThis, { Array: customArray });",
      "useMemo",
    ],
    [
      'import { useMemo } from "react";',
      "Object.getPrototypeOf([]).map = callback => [callback(records[0], 0)];",
      "useMemo",
    ],
    [
      'import { useMemo } from "react";',
      "[].__proto__.map = callback => [callback(records[0], 0)];",
      "useMemo",
    ],
  ])("keeps provider exposure reportable: %s %s", (imports, setup, memo) => {
    const result = runRule(
      noArrayIndexAsKey,
      `${imports}
const Caption = ({ label, records }: { label: string; records: RecordData[] }) => {
  ${setup}
  const letters = ${memo}(() => Array.from(label), [label]);
  return letters.map((letter, index) => <Glyph key={index} value={letter} />);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "(letter, index, array) => { array[index] = records[index]; return <Glyph key={index} value={array[index]} />; }",
    "function (letter, index) { const array = arguments[2]; array[index] = records[index]; return <Glyph key={index} value={array[index]} />; }",
    `(letter, index) => { eval("letters[index] = records[index]"); return <Glyph key={index} value={letter} />; }`,
  ])("keeps callback receiver aliases reportable: %s", (callback) => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo } from "react";
const Caption = ({ label, records }: { label: string; records: RecordData[] }) => {
  const letters = useMemo(() => Array.from(label), [label]);
  return letters.map(${callback});
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves a type parameter that shadows a string interface", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo } from "react";
interface Props { label: string; }
const Caption = <Props extends { label: RecordData[] }>({ label }: Props) => {
  const letters = useMemo(() => Array.from(label), [label]);
  return letters.map((record, index) => <Glyph key={index} value={record} />);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("declines a nested parameter type that shadows a module interface", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo } from "react";
interface Props { label: string; }
const makeCaption = () => {
  interface Props { label: RecordData[]; }
  return ({ label }: Props) => {
    const letters = useMemo(() => Array.from(label), [label]);
    return letters.map((record, index) => <Glyph key={index} value={record} />);
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a shadowed String conversion reportable", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { useMemo } from "react";
const Caption = ({ records }) => {
  const String = () => records;
  const label = String();
  const letters = useMemo(() => Array.from(label), [label]);
  return letters.map((record, index) => <Glyph key={index} value={record} />);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
