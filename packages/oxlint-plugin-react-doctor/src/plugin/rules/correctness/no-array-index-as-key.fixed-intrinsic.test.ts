import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";
import { JSX_DESCENDANT_SCAN_NODE_BUDGET } from "../../constants/thresholds.js";

const FIXED_INPUT_MAP = `[<input name="alpha" defaultValue="a" />, <input name="beta" defaultValue="b" />].map((child, index) => <span key={index}>{child}</span>)`;
const REVERSED_INPUT_MAP = `[<input name="beta" defaultValue="b" />, <input name="alpha" defaultValue="a" />].map((child, index) => <span key={index}>{child}</span>)`;
const CLOSED_LITERAL_MAPS = [
  `[<label>Alpha<input defaultValue={"a"} /></label>, <textarea defaultValue="b" />].map((child, index) => <div key={index}><section>{child}</section></div>)`,
  `([<input disabled />, <input required={true} />] as const).map((child, index) => <label key={index}>{child}</label>)`,
];

describe("correctness/no-array-index-as-key fixed intrinsic arrays", () => {
  it("allows fixed intrinsic children with uncontrolled state", () => {
    const result = runRule(noArrayIndexAsKey, `const Fields = () => ${FIXED_INPUT_MAP};`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(CLOSED_LITERAL_MAPS)("allows closed literal trees in a component: %s", (source) => {
    const result = runRule(noArrayIndexAsKey, `const Fields = () => ${source};`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(CLOSED_LITERAL_MAPS)("declines the original bare-expression profile: %s", (source) => {
    const result = runRule(noArrayIndexAsKey, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `const Fields = () => { return ${FIXED_INPUT_MAP}; };`,
    `const Fields = () => <form><section>{${FIXED_INPUT_MAP}}</section></form>;`,
    `export const Fields = () => ${FIXED_INPUT_MAP};`,
    `const Fields = () => ${FIXED_INPUT_MAP}; const App = () => <Fields />;`,
  ])("allows direct component return paths: %s", (source) => {
    const result = runRule(noArrayIndexAsKey, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [`const Fields = () => swap ? ${FIXED_INPUT_MAP} : ${REVERSED_INPUT_MAP};`, 2],
    [`const Fields = () => <form>{swap ? ${FIXED_INPUT_MAP} : ${REVERSED_INPUT_MAP}}</form>;`, 2],
    [`const Fields = () => swap && ${FIXED_INPUT_MAP};`, 1],
    [
      `const Fields = () => { if (swap) return ${FIXED_INPUT_MAP}; return ${REVERSED_INPUT_MAP}; };`,
      2,
    ],
    [
      `const Fields = () => { switch (mode) { case "first": return ${FIXED_INPUT_MAP}; default: return ${REVERSED_INPUT_MAP}; } };`,
      2,
    ],
    [
      `const Fields = () => { const first = ${FIXED_INPUT_MAP}; const second = ${REVERSED_INPUT_MAP}; return swap ? second : first; };`,
      2,
    ],
    [
      `const first = ${FIXED_INPUT_MAP}; const second = ${REVERSED_INPUT_MAP}; const Fields = () => swap ? second : first;`,
      2,
    ],
    [
      `const first = () => ${FIXED_INPUT_MAP}; const second = () => ${REVERSED_INPUT_MAP}; const Fields = () => swap ? second() : first();`,
      2,
    ],
    [
      `const First = () => ${FIXED_INPUT_MAP}; const Second = () => ${REVERSED_INPUT_MAP}; const Fields = () => swap ? Second() : First();`,
      2,
    ],
    [`const Fields = () => forward(${FIXED_INPUT_MAP});`, 1],
    [`const Fields = () => <Forward>{${FIXED_INPUT_MAP}}</Forward>;`, 1],
    [`const Fields = () => <div children={${FIXED_INPUT_MAP}} />;`, 1],
    [`const Fields = () => [...${FIXED_INPUT_MAP}];`, 1],
    [`const Fields = () => [${FIXED_INPUT_MAP}];`, 1],
    [`const Fields = memo(() => ${FIXED_INPUT_MAP});`, 1],
    [`let Fields = () => ${FIXED_INPUT_MAP};`, 1],
    [`function Fields() { return ${FIXED_INPUT_MAP}; }`, 1],
    [`export default () => ${FIXED_INPUT_MAP};`, 1],
    [`const Fields = () => ${FIXED_INPUT_MAP}; const alias = Fields;`, 1],
    [`const Fields = () => ${FIXED_INPUT_MAP}; render(Fields);`, 1],
    [
      `const Fields = () => ${FIXED_INPUT_MAP}; const read = (value = Fields()) => { var Fields; };`,
      1,
    ],
    [
      `const Fields = () => ${FIXED_INPUT_MAP}; const read = (value = <Fields />) => { var Fields; };`,
      1,
    ],
    [`const Fields = (value = load()) => ${FIXED_INPUT_MAP};`, 1],
    [FIXED_INPUT_MAP, 1],
    [
      `const Fields = () => [<input />, <input />].map((child, index) => <span key={index} key="fixed">{child}</span>);`,
      1,
    ],
  ])("declines selectors, escapes and unsupported owners: %s", (source, expectedCount) => {
    const result = runRule(noArrayIndexAsKey, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each([
    `<section>${"<input />".repeat(JSX_DESCENDANT_SCAN_NODE_BUDGET)}</section>`,
    `${"<section>".repeat(JSX_DESCENDANT_SCAN_NODE_BUDGET)}<input />${"</section>".repeat(JSX_DESCENDANT_SCAN_NODE_BUDGET)}`,
  ])("declines over-budget source trees", (tree) => {
    const result = runRule(
      noArrayIndexAsKey,
      `const Fields = () => [${tree}, <input />].map((child, index) => <span key={index}>{child}</span>);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("shares the source and mapper budget", () => {
    const source = `<section>${"<input />".repeat(JSX_DESCENDANT_SCAN_NODE_BUDGET / 2)}</section>`;
    const mapper = `<span key={index}>{child}${"<input />".repeat(JSX_DESCENDANT_SCAN_NODE_BUDGET / 2)}</span>`;
    const result = runRule(
      noArrayIndexAsKey,
      `const Fields = () => [${source}, <input />].map((child, index) => ${mapper});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `[<input defaultValue={value} />, <input defaultValue="b" />].map((child, index) => <span key={index}>{child}</span>)`,
    `[<input {...attributes} />, <input />].map((child, index) => <span key={index}>{child}</span>)`,
    `[<input ref={reference} />, <input />].map((child, index) => <span key={index}>{child}</span>)`,
    `[<Field />, <Field />].map((child, index) => <span key={index}>{child}</span>)`,
    `[<input />, ...children].map((child, index) => <span key={index}>{child}</span>)`,
    `[<input />, , <input />].map((child, index) => <span key={index}>{child}</span>)`,
    `[condition ? <input name="a" /> : <input name="b" />, <input />].map((child, index) => <span key={index}>{child}</span>)`,
    `(${FIXED_INPUT_MAP.replace(".map", ".reverse().map")})`,
    `[<input />, <input />].map((child, index) => <Field key={index} child={child} />)`,
    `[<input />, <input />].map((child, index) => <span key={index}>{condition ? child : <input defaultValue="other" />}</span>)`,
    `[<input />, <input />].map((child, index) => <span key={index}>{render(child)}</span>)`,
    `[<input />, <input />].map((child, index, children) => <span key={index}>{children[condition ? 1 - index : index]}</span>)`,
    `[<input />, <input />].map((child, index) => { mutate(); return <span key={index}>{child}</span>; })`,
    `const children = [<input />, <input />]; children.map((child, index) => <span key={index}>{child}</span>)`,
    `children.map((child, index) => <span key={index}>{child}</span>)`,
    `(condition ? [<input name="a" />, <input name="b" />] : [<input name="b" />, <input name="a" />]).map((child, index) => <span key={index}>{child}</span>)`,
  ])("keeps existing diagnostics outside the closed map: %s", (source) => {
    const result = runRule(noArrayIndexAsKey, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `Array.prototype.map = replacement;`,
    `const prototype = Object.getPrototypeOf([]); prototype.map = replacement;`,
    `const prototype = [].__proto__; prototype.map = replacement;`,
    `const constructor = [].constructor; constructor.prototype.map = replacement;`,
    `const { Array: constructor } = unknownHost; constructor.prototype.map = replacement;`,
    `unknownHost.Array.prototype.map = replacement;`,
    `Object.defineProperty(Array.prototype, "map", { value: replacement });`,
    `Reflect.set(Array.prototype, "map", replacement);`,
    `Array[unknownProperty] = replacement;`,
    `mutate(Array);`,
    `const holder = { constructor: Array }; mutate(holder);`,
    `const install = (value = mutate(Array)) => { var Array; };`,
    `const install = (value = mutate(unknownHost)) => { var unknownHost; };`,
    `eval(source);`,
  ])("declines visible intrinsic uncertainty: %s", (prefix) => {
    const result = runRule(
      noArrayIndexAsKey,
      `${prefix}\nconst Fields = () => ${FIXED_INPUT_MAP};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
