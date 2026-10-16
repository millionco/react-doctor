import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vite-plus/test";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { noCallComponentAsFunction } from "./no-call-component-as-function.js";

interface CallbackParameterTestCase {
  name: string;
  code: string;
  expected: number;
}

const commonOptions: RunRuleOptions = {
  filename: "src/example.tsx",
  forceJsx: true,
  includeLocations: true,
};

const testCases: CallbackParameterTestCase[] = [
  {
    name: "array-pattern-callback-rendered-and-called-in-event",
    code: "export const Example = ({ entries }) => <div>{entries.map(([label, Item]) => <button onClick={() => Item({ label })}><Item /></button>)}</div>;\n",
    expected: 1,
  },
  {
    name: "simple-callback-parameter-rendered-and-called",
    code: "export const Example = ({ items }) => <div>{items.map((Item) => <>{Item({})}<Item /></>)}</div>;\n",
    expected: 1,
  },
  {
    name: "renamed-object-pattern-callback-parameter",
    code: "export const Example = ({ items }) => <div>{items.map(({ component: Item }) => <>{Item({})}<Item /></>)}</div>;\n",
    expected: 1,
  },
  {
    name: "ordinary-function-expression-callback",
    code: "export const Example = ({ items }) => <div>{items.map(function (Item) { return <>{Item({})}<Item /></>; })}</div>;\n",
    expected: 1,
  },
  {
    name: "shadowed-inner-parameter-not-rendered-binding",
    code: "export const Example = ({ items }) => <div>{items.map((Item) => { const helper = (Item) => Item({}); return <Item helper={helper} />; })}</div>;\n",
    expected: 0,
  },
  {
    name: "separate-callbacks-do-not-share-name-evidence",
    code: "export const Example = ({ items }) => { const rendered = items.map((Item) => <Item />); const values = items.map((Item) => Item({})); return <div>{rendered}{values}</div>; };\n",
    expected: 0,
  },
  {
    name: "unrendered-pascal-callback-helper",
    code: 'export const Example = ({ items }) => <div>{items.map((Format) => Format({ text: "label" }))}</div>;\n',
    expected: 0,
  },
  {
    name: "custom-create-element-does-not-prove-component",
    code: "const createElement = (value) => value;\nexport const Example = ({ items }) => <div>{items.map((Item) => <>{Item({})}{createElement(Item)}</>)}</div>;\n",
    expected: 0,
  },
  {
    name: "legacy-hook-free-nested-render-helper",
    code: "export const Example = () => { const Section = () => <span />; return <div>{Section()}</div>; };\n",
    expected: 0,
  },
  {
    name: "legacy-module-component-direct-call",
    code: "const Item = () => <span />;\nexport const Example = () => <div>{Item({})}<Item /></div>;\n",
    expected: 1,
  },
  {
    name: "legacy-imported-rendered-component-direct-call",
    code: 'import Item from "./item";\nexport const Example = () => <div>{Item({})}<Item /></div>;\n',
    expected: 1,
  },
  {
    name: "legacy-positional-formatter-exception",
    code: 'const Format = (text, prefix) => <span>{prefix}{text}</span>;\nexport const Example = () => <div>{Format("body", "prefix")}</div>;\n',
    expected: 0,
  },
  {
    name: "legacy-async-component-exception",
    code: 'const Item = async (props) => <span>{props.text}</span>;\nexport const Example = () => <div>{Item({ text: "body" })}<Item text="body" /></div>;\n',
    expected: 0,
  },
  {
    name: "existing-use-callback-adapter-exception",
    code: 'import { useCallback } from "react";\nexport const Example = ({ items }) => <div>{items.map((Item) => { const Adapter = useCallback(() => Item({}), []); return <><Item /><Adapter /></>; })}</div>;\n',
    expected: 0,
  },
  {
    name: "direct-parameter-write-abstains",
    code: "export const Example = ({ items, replacement }) => <div>{items.map((Item) => { const rendered = <Item />; Item = replacement; return <>{rendered}{Item({})}</>; })}</div>;\n",
    expected: 0,
  },
  {
    name: "destructuring-parameter-write-abstains",
    code: "export const Example = ({ items, replacements }) => <div>{items.map((Item) => { const rendered = <Item />; [Item] = replacements; return <>{rendered}{Item({})}</>; })}</div>;\n",
    expected: 0,
  },
  {
    name: "noncallback-function-parameter-outside-new-profile",
    code: "function renderWith(Item) { return <>{Item({})}<Item /></>; }\nexport const Example = () => <div />;\n",
    expected: 0,
  },
  {
    name: "unresolved-eval-read-abstains",
    code: "export const Example = ({ items }) => <div>{items.map((Item) => { void eval; return <>{Item({})}<Item /></>; })}</div>;\n",
    expected: 0,
  },
  {
    name: "runtime-enum-parameter-write-abstains",
    code: "export const Example = ({ items, replacement }) => <div>{items.map((Item) => { enum Change { Value = (Item = replacement, 0) } return <>{Item({})}<Item /></>; })}</div>;\n",
    expected: 0,
  },
  {
    name: "canonical-create-element-only-parameter-is-unsupported",
    code: 'import { createElement } from "react";\nexport const Example = ({ items }) => <div>{items.map((Item) => <>{Item({})}{createElement(Item, null)}</>)}</div>;\n',
    expected: 0,
  },
  {
    name: "module-ordinary-callback-benign-arguments-read-abstains",
    code: "export const Example = ({ items }) => <div>{items.map(function (Item) { void arguments; return <>{Item({})}<Item /></>; })}</div>;\n",
    expected: 0,
  },
  {
    name: "module-ordinary-callback-nested-arguments-alias-abstains",
    code: "export const Example = ({ items, replacement }) => <div>{items.map(function (Item) { const change = () => { const values = arguments; values[0] = replacement; }; change(); return <>{Item({})}<Item /></>; })}</div>;\n",
    expected: 0,
  },
  {
    name: "callback-owner-two-parameters-not-component-arity",
    code: "export const Example = ({ items }) => <div>{items.map((Item, index) => <section key={index}>{Item({})}<Item /></section>)}</div>;\n",
    expected: 1,
  },
  {
    name: "erased-interface-and-parameter-annotations-preserve-jsx-witness",
    code: "interface Entry { title: string }\ninterface Props { entries: Array<[string, (props: Entry) => JSX.Element]> }\nexport const Example = ({ entries }: Props) => { const index: number = 0; return <section>{entries.map(([title, Item]) => <button onClick={() => Item({ title })}><Item title={title} /></button>)}</section>; };\n",
    expected: 1,
  },
];

const scriptTestCases: CallbackParameterTestCase[] = [
  {
    name: "sloppy-script-mapped-arguments-direct-write",
    code: "function Example(items, replacement) { return items.map(function (Item) { const rendered = <Item />; arguments[0] = replacement; return <>{rendered}{Item({})}</>; }); }\n",
    expected: 0,
  },
  {
    name: "sloppy-script-mapped-arguments-nested-alias",
    code: "function Example(items, replacement) { return items.map(function (Item) { const rendered = <Item />; const change = () => { const values = arguments; values[0] = replacement; }; change(); return <>{rendered}{Item({})}</>; }); }\n",
    expected: 0,
  },
  {
    name: "script-with-selected-call-lookup",
    code: "function Example(items, other) { return items.map((Item) => { const rendered = <Item />; with (other) { Item({}); } return rendered; }); }\n",
    expected: 0,
  },
  {
    name: "script-shadowed-eval-read-abstains-conservatively",
    code: "function Example(items, evaluate) { return items.map((Item) => { const eval = evaluate; void eval; return <>{Item({})}<Item /></>; }); }\n",
    expected: 0,
  },
];

describe("no-call-component-as-function callback parameters", () => {
  for (const testCase of testCases) {
    it(testCase.name, () => {
      const result = runRule(noCallComponentAsFunction, testCase.code, commonOptions);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
  for (const testCase of scriptTestCases) {
    it(testCase.name, () => {
      const parsed = parseSync("src/example.jsx", testCase.code, {
        sourceType: "script",
        lang: "jsx",
        astType: "ts",
        preserveParens: false,
      });
      const result = runRuleOnParsedFixture(
        noCallComponentAsFunction,
        testCase.code,
        {
          program: parsed.program as unknown as EsTreeNode,
          errors: parsed.errors.map((error) => ({ message: error.message })),
        },
        commonOptions,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});
