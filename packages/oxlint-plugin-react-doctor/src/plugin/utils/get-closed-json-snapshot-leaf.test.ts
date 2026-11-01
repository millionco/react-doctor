import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getClosedJsonSnapshotLeaf } from "./get-closed-json-snapshot-leaf.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

const inspectLeaf = (sourceText: string, hasAntdComponentRole = false, useLastIterator = false) => {
  const program = parseSourceText({ filename: "leaf.jsx", sourceText });
  expect(program).not.toBeNull();
  if (!program) throw new Error("Fixture must parse");
  const scopes = analyzeScopes(program);
  let iteratorCall: EsTreeNodeOfType<"CallExpression"> | null = null;
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "map" &&
      (!iteratorCall || useLastIterator)
    )
      iteratorCall = node;
  });
  if (!iteratorCall) throw new Error("Fixture must contain map");
  return getClosedJsonSnapshotLeaf({ iteratorCall, scopes, hasAntdComponentRole });
};

describe("getClosedJsonSnapshotLeaf", () => {
  it("certifies direct native text with ordinal decoration", () => {
    const certificate = inspectLeaf(`export default function Leaf(props) {
      return <section className="copy">{props.articles.map((article, position) => <p key={position}>{position + 1}. {article}</p>)}</section>;
    }`);
    expect(certificate?.targetPath).toEqual(["articles"]);
  });

  it("resolves destructured props and a nested selected path", () => {
    const certificate = inspectLeaf(
      `export const Leaf = ({ config }) => <div>{config.details.articles.map((article, position) => <p key={position}>{article}</p>)}</div>;`,
    );
    expect(certificate?.targetPath).toEqual(["config", "details", "articles"]);
    expect(certificate?.localTargetPath).toEqual(["details", "articles"]);
  });

  it("resolves directly destructured target props", () => {
    const certificate = inspectLeaf(
      `export const Leaf = ({ paragraphs }) => <div>{paragraphs.map((article, position) => <p key={position} title={\`Paragraph \${position + 1}\`}>{article}</p>)}</div>;`,
    );
    expect(certificate?.targetPath).toEqual(["paragraphs"]);
    expect(certificate?.localTargetPath).toEqual([]);
  });

  it("does not give disjoint sibling reads target capability", () => {
    expect(
      inspectLeaf(
        `export const Leaf = (props) => <div><aside>{props.heading}</aside>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</div>;`,
      ),
    ).not.toBeNull();
  });

  it("allows native presentation attributes from the index and disjoint props", () => {
    expect(
      inspectLeaf(
        `export const Leaf = (props) => <div style={props.layout} key={props.heading} contentEditable>{props.articles.map((article, position) => <span key={position} style={{ marginLeft: position * 2, color: props.color }} title={props.heading} onClick={() => {}} ref={capture}>{article}</span>)}</div>;`,
      ),
    ).not.toBeNull();
  });

  it.each([
    `style={{ marginLeft: position = 0 }}`,
    `style={{ marginLeft: ++position }}`,
    `style={{ marginLeft: position++ }}`,
    `onClick={() => position = 0}`,
    `title={props.articles}`,
    `style={{ values: props.articles }}`,
    `children={props.heading}`,
    `dangerouslySetInnerHTML={{ __html: props.heading }}`,
    `srcDoc={props.heading}`,
  ])(
    "declines presentation that writes the index or mediates selected content: %s",
    (attributes) => {
      expect(
        inspectLeaf(
          `export const Leaf = (props) => <div>{props.articles.map((article, position) => <span ${attributes} key={position}>{article}</span>)}</div>;`,
        ),
      ).toBeNull();
    },
  );

  it.each(["0", "position - position", "position % 2", "position + 1", "`${position}`"])(
    "declines keys outside the direct unique index binding: %s",
    (key) => {
      expect(
        inspectLeaf(
          `export const Leaf = (props) => <div>{props.articles.map((article, position) => <p key={${key}}>{article}</p>)}</div>;`,
        ),
      ).toBeNull();
    },
  );

  it("declines duplicate key attributes", () => {
    expect(
      inspectLeaf(
        `export const Leaf = (props) => <div>{props.articles.map((article, position) => <p key={position} key={0}>{article}</p>)}</div>;`,
      ),
    ).toBeNull();
  });

  it.each([
    `props.articles.filter(isVisible).map((article, position) => <p key={position}>{article}</p>)`,
    `props.articles.map((article, position, articles) => <p key={position}>{article}</p>)`,
    `props.articles.map(function(article, position) { return <p key={position}>{arguments[2]}</p>; })`,
    `props.articles.map(function(article, position) { return <p key={position} title={capture(arguments[2])}>{article}</p>; })`,
    `props.articles.map(function(article, position) { return <p title={arguments[1] = 0} key={position}>{article}</p>; })`,
    `[...props.articles.map((article, position) => <p key={position}>{article}</p>)]`,
  ])("declines an unproved receiver, callback capability or flattened namespace: %s", (output) => {
    expect(inspectLeaf(`export const Leaf = (props) => <div>{${output}}</div>;`)).toBeNull();
  });

  it.each([
    ["opaque attribute", `<p key={position} className={article}>{article}</p>`],
    ["custom child", `<p key={position}><Widget value={article}/></p>`],
    ["custom row", `<Widget key={position}>{article}</Widget>`],
    ["interactive row", `<button key={position}>{article}</button>`],
    ["reconstructed content", `<p key={position}>{String(article)}</p>`],
    ["item projection", `<p key={position}>{article.label}</p>`],
    ["conditional omission", `article && <p key={position}>{article}</p>`],
    ["nested output", `<p key={position}><span>{article}</span></p>`],
    ["duplicate item", `<p key={position}>{article}{article}</p>`],
    ["opaque spread", `<p key={position} {...attributes}>{article}</p>`],
  ])("declines %s", (_label, row) => {
    expect(
      inspectLeaf(
        `export const Leaf = (props) => <div>{props.articles.map((article, position) => ${row})}</div>;`,
      ),
    ).toBeNull();
  });

  it.each([
    `publish(props);`,
    `publish(props.articles);`,
    `props.articles.sort();`,
    `props.articles[0] = "changed";`,
    `const alias = props.articles; publish(alias);`,
    `const callback = () => props.articles.reverse();`,
    `publish(arguments[0]);`,
    `eval("publish(props)");`,
    `props.sibling.constructor.prototype.map = replacement;`,
    `publish(props.sibling.__proto__);`,
    `publish(props.sibling["prototype"]);`,
  ])("declines a target-reaching escape or mutation: %s", (statement) => {
    expect(
      inspectLeaf(
        `export function Leaf(props) { ${statement} return <div>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</div>; }`,
      ),
    ).toBeNull();
  });

  it("declines destructured prototype properties", () => {
    expect(
      inspectLeaf(
        `export const Leaf = ({ constructor }) => <div>{constructor.articles.map((article, position) => <p key={position}>{article}</p>)}</div>;`,
      ),
    ).toBeNull();
  });

  it("declines custom render ancestors", () => {
    expect(
      inspectLeaf(
        `export const Leaf = (props) => <Widget>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</Widget>;`,
      ),
    ).toBeNull();
  });

  it("keeps omission returns separate from the retained map namespace", () => {
    expect(
      inspectLeaf(
        `export function Leaf(props) { if (!props.visible) return null; return <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section>; }`,
      ),
    ).not.toBeNull();
  });

  it("refuses a final map after an earlier competing return in the same root", () => {
    expect(
      inspectLeaf(
        `export function Leaf(props) { if (props.visible) return <section>{props.otherArticles.map((article, position) => <p key={position}>{article}</p>)}</section>; return <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section>; }`,
        false,
        true,
      ),
    ).toBeNull();
  });

  it.each(["null", "false", "[]", "<></>"])("allows omission through %s", (alternate) => {
    expect(
      inspectLeaf(
        `export const Leaf = (props) => props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : ${alternate};`,
      ),
    ).not.toBeNull();
  });

  it("allows conditional conjunction omission", () => {
    expect(
      inspectLeaf(
        `export const Leaf = (props) => <div>{props.visible && props.articles.map((article, position) => <p key={position}>{article}</p>)}</div>;`,
      ),
    ).not.toBeNull();
  });

  it("allows distinct native roots that remount the selected list", () => {
    expect(
      inspectLeaf(
        `export const Leaf = (props) => props.visible ? <><article>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</article></> : <section>{props.otherArticles.map((article, position) => <p key={position}>{article}</p>)}</section>;`,
      ),
    ).not.toBeNull();
  });

  it("distinguishes a genuine supported router fallback from a native root", () => {
    expect(
      inspectLeaf(
        `import { Route as Fallback } from 'react-router-dom'; export const Leaf = (props) => props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <Fallback/>;`,
      ),
    ).not.toBeNull();
  });

  it("distinguishes the selected genuine AntD Carousel component through one fragment", () => {
    const source = `import { Carousel as Fallback } from 'antd'; export const Leaf = (props) => props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <><Fallback/></>;`;
    expect(inspectLeaf(source, true)).not.toBeNull();
    expect(inspectLeaf(source)).toBeNull();
  });

  it.each([
    `import Fallback from 'antd';`,
    `import { Carousel as Fallback } from './carousel';`,
    `import { Carousel as Fallback } from 'antd'; configure(Fallback);`,
    `import { Carousel as Fallback } from 'antd'; Fallback.defaultProps = {};`,
  ])("declines an unproved or published Carousel identity: %s", (prefix) => {
    expect(
      inspectLeaf(
        `${prefix} export const Leaf = (props) => props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <><Fallback/></>;`,
        true,
      ),
    ).toBeNull();
  });

  it("does not infer a Carousel type from a shadowed imported name", () => {
    expect(
      inspectLeaf(
        `import { Carousel as Fallback } from 'antd'; export function Leaf(props, Fallback) { return props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <Fallback/>; }`,
        true,
      ),
    ).toBeNull();
  });

  it.each([
    `<section>{props.visible ? props.articles.map((article, position) => <p key={position}>{article}</p>) : props.otherArticles.map((article, position) => <p key={position}>{article}</p>)}</section>`,
    `props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <section>{props.otherArticles.map((article, position) => <p key={position}>{article}</p>)}</section>`,
    `props.visible ? <><section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section></> : <section>{props.otherArticles.map((article, position) => <p key={position}>{article}</p>)}</section>`,
    `props.visible ? <><><article>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</article></></> : <section/>`,
    `props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <><article/><article/></>`,
    `<section>{props.visible || props.articles.map((article, position) => <p key={position}>{article}</p>)}</section>`,
    `props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <article {...props.options}/>`,
    `props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <Fallback/>`,
  ])("declines an unproved alternate namespace or root: %s", (output) => {
    expect(inspectLeaf(`export const Leaf = (props) => ${output};`)).toBeNull();
  });

  it("does not infer an intrinsic-incompatible type from capitalization or an unknown import", () => {
    expect(
      inspectLeaf(
        `import Fallback from './fallback'; export const Leaf = (props) => props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <Fallback/>;`,
      ),
    ).toBeNull();
  });

  it("does not infer a router type from a shadowed imported name", () => {
    expect(
      inspectLeaf(
        `import { Route as Fallback } from 'react-router-dom'; export function Leaf(props, Fallback) { return props.visible ? <section>{props.articles.map((article, position) => <p key={position}>{article}</p>)}</section> : <Fallback/>; }`,
      ),
    ).toBeNull();
  });
});
