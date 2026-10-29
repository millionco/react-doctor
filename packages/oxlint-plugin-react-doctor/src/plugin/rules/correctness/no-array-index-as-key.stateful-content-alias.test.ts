import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface StatefulContentAliasCase {
  name: string;
  body: string;
  count: number;
  prelude?: string;
  collection?: string;
  outerMethod?: string;
}

const cases: StatefulContentAliasCase[] = [
  {
    name: "reports native input through a const content alias",
    body: "const content = item.parts.map(part => <input defaultValue={part.name}/>); return <div key={index}>{content}</div>;",
    count: 1,
  },
  {
    name: "reports custom component through a const content alias",
    body: "const content = item.parts.map(part => <Editor value={part.name}/>); return <div key={index}>{content}</div>;",
    count: 1,
  },
  {
    name: "reports member component through a const content alias",
    body: "const content = item.parts.map(part => <Widgets.Editor value={part.name}/>); return <div key={index}>{content}</div>;",
    count: 1,
  },
  {
    name: "reports editable text through a const content alias",
    body: "const content = item.parts.map(part => <span contentEditable>{part.name}</span>); return <div key={index}>{content}</div>;",
    count: 1,
  },
  {
    name: "reports native media through a const content alias",
    body: "const content = item.parts.map(part => <video src={part.url}/>); return <div key={index}>{content}</div>;",
    count: 1,
  },
  {
    name: "reports nested input through a const content alias",
    body: "const content = item.parts.map(part => <section><label><input defaultValue={part.name}/></label></section>); return <div key={index}>{content}</div>;",
    count: 1,
  },
  {
    name: "reports fragment input through a const content alias",
    body: "const content = item.parts.map(part => <><input defaultValue={part.name}/><span>{part.name}</span></>); return <div key={index}>{content}</div>;",
    count: 1,
  },
  {
    name: "keeps pure native text quiet",
    body: "const content=item.parts.map(part=><span>{part.name}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps a conditional callback outside the profile",
    body: "const content=item.parts.map(part=>part.enabled ? <input/>:<span>{part.name}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps a literal dead input branch quiet",
    body: "const content=item.parts.map(part=>false ? <input/>:<span>{part.name}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps a nested dead input branch quiet",
    body: "const content=item.parts.map(part=><span>{false && <input/>}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps logical attributes outside the profile",
    body: 'const content=item.parts.map(part=><input defaultValue={part.name || ""}/>);return <div key={index}>{content}</div>;',
    count: 0,
  },
  {
    name: "keeps conditional attributes outside the profile",
    body: 'const content=item.parts.map(part=><input defaultValue={part.enabled ? "a":"b"}/>);return <div key={index}>{content}</div>;',
    count: 0,
  },
  {
    name: "keeps mutable aliases quiet",
    body: 'let content=item.parts.map(part=><input/>);content="label";return <div key={index}>{content}</div>;',
    count: 0,
  },
  {
    name: "keeps unreassigned let aliases outside the profile",
    body: "let content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps array length writes quiet",
    body: "const content=item.parts.map(part=><input/>);content.length=0;return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps indexed replacements quiet",
    body: 'const content=item.parts.map(part=><input/>);content[0]="label";return <div key={index}>{content}</div>;',
    count: 0,
  },
  {
    name: "keeps computed mutator calls quiet",
    body: 'const content=item.parts.map(part=><input/>);content["splice"](0);return <div key={index}>{content}</div>;',
    count: 0,
  },
  {
    name: "keeps escaped array aliases quiet",
    body: "const content=item.parts.map(part=><input/>);const replacement=content;replacement.length=0;return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps unknown consumers outside the profile",
    body: "const content=item.parts.map(part=><input/>);observe(content);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps block callbacks outside the profile",
    body: "const content=item.parts.map(part=>{return <input/>;});return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps function callbacks outside the profile",
    body: "const content=item.parts.map(function(part){return <input/>;});return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps named callbacks outside the profile",
    body: "const renderPart=part=><input/>;const content=item.parts.map(renderPart);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps flatMap outside the profile",
    body: "const content=item.parts.flatMap(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps dynamic methods outside the profile",
    body: "const content=item.parts[method](part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "reports direct stateful children unchanged",
    body: "return <div key={index}><input defaultValue={item.name}/></div>;",
    count: 1,
  },
  {
    name: "keeps explicitly noneditable text quiet",
    body: "const content=item.parts.map(part=><span contentEditable={false}>{part.name}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "reports transparent callback output wrappers",
    body: "const content=item.parts.map(part=>(<input defaultValue={part.name}/> as ReactNode));return <div key={index}>{content}</div>;",
    count: 1,
  },
  {
    name: "keeps an overbudget output quiet",
    body: "const content=item.parts.map(part=><section><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><span>label</span><input/></section>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "declines an explicit custom outer map with empty nested output",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records={map:callback=>callback({parts:{map:()=>[]}},0)};",
    collection: "records",
  },
  {
    name: "declines a mutable custom outer map provider",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "let records={map:callback=>callback({parts:{map:()=>[]}},0)};",
    collection: "records",
  },
  {
    name: "declines a local factory result with a custom outer map",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude:
      "const makeRecords=()=>({map:callback=>callback({parts:{map:()=>[]}},0)});const records=makeRecords();",
    collection: "records",
  },
  {
    name: "declines a function-owned custom outer map",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "function records(){}records.map=callback=>callback({parts:{map:()=>[]}},0);",
    collection: "records",
  },
  {
    name: "declines an inline object-owned outer map",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    collection: "({map:callback=>callback({parts:{map:()=>[]}},0)})",
  },
  {
    name: "declines a known own custom map",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records=[{parts:{map:()=>[]}}];",
    collection: "records",
  },
  {
    name: "declines a getter map implementation",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records=[{parts:{get map(){return ()=>[]}}}];",
    collection: "records",
  },
  {
    name: "declines an accessor field provider",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records=[{get parts(){return {map:()=>[]}}}];",
    collection: "records",
  },
  {
    name: "declines a spread-conflicted field provider",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records=[{parts:[],...unknown}];",
    collection: "records",
  },
  {
    name: "declines a missing field provider",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records=[{}];",
    collection: "records",
  },
  {
    name: "reports known own array fields",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 1,
    prelude: 'const records=[{parts:[{name:"label"}]}];',
    collection: "records",
  },
  {
    name: "keeps local field aliases outside the closed provider profile",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'const fields=[{name:"label"}];const records=[{parts:fields}];',
    collection: "records",
  },
  {
    name: "keeps outer collection aliases outside the closed provider profile",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'const source=[{parts:[{name:"label"}]}];const records=source;',
    collection: "records",
  },
  {
    name: "declines custom map through const outer collection aliases",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const source=[{parts:{map:()=>[]}}];const records=source;",
    collection: "records",
  },
  {
    name: "declines unresolved local field aliases",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "let fields=[];const records=[{parts:fields}];",
    collection: "records",
  },
  {
    name: "keeps named React Fragment outside the new profile",
    body: "const content=item.parts.map(part=><Fragment>{part.name}</Fragment>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'import {Fragment} from "react";',
    collection: "items",
  },
  {
    name: "keeps renamed React Fragment outside the new profile",
    body: "const content=item.parts.map(part=><Group>{part.name}</Group>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'import {Fragment as Group} from "react";',
    collection: "items",
  },
  {
    name: "keeps namespace React Fragment outside the new profile",
    body: "const content=item.parts.map(part=><React.Fragment>{part.name}</React.Fragment>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'import * as React from "react";',
    collection: "items",
  },
  {
    name: "keeps default React Fragment outside the new profile",
    body: "const content=item.parts.map(part=><React.Fragment>{part.name}</React.Fragment>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'import React from "react";',
    collection: "items",
  },
  {
    name: "keeps nested named React Fragment outside the new profile",
    body: "const content=item.parts.map(part=><section><Fragment>{part.name}</Fragment></section>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'import {Fragment} from "react";',
    collection: "items",
  },
  {
    name: "keeps stateful named React Fragment outside the new profile",
    body: "const content=item.parts.map(part=><Fragment><input/></Fragment>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'import {Fragment} from "react";',
    collection: "items",
  },
  {
    name: "reports an imported custom Fragment",
    body: "const content=item.parts.map(part=><Fragment>{part.name}</Fragment>);return <div key={index}>{content}</div>;",
    count: 1,
    prelude: 'import {Fragment} from "./widgets";',
    collection: "items",
  },
  {
    name: "keeps shorthand pure text fragments quiet",
    body: "const content=item.parts.map(part=><>{part.name}</>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "",
    collection: "items",
  },
  {
    name: "keeps custom component prop escapes quiet",
    body: "const content=item.parts.map(part=><input/>);const view=<Consumer value={content}/>;observe(view);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps native attribute reads outside the profile",
    body: "const content=item.parts.map(part=><input/>);const view=<span title={content}/>;observe(view);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps nested function publications outside the profile",
    body: "const content=item.parts.map(part=><input/>);const Nested=()=> <span>{content}</span>;observe(Nested);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps source-known empty fields quiet",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records=[{parts:[]}];",
    collection: "records",
  },
  {
    name: "keeps source-known empty outer arrays quiet",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records=[];",
    collection: "records",
  },
  {
    name: "keeps source-known sparse empty fields quiet",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: "const records=[{parts:[,,]}];",
    collection: "records",
  },
  {
    name: "keeps an overwritten record field quiet",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'const records=[{parts:[{name:"label"}]}];records[0].parts={map:()=>[]};',
    collection: "records",
  },
  {
    name: "keeps field-array map replacements quiet",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'const fields=[{name:"label"}];fields.map=()=>[];const records=[{parts:fields}];',
    collection: "records",
  },
  {
    name: "keeps a row-owned method replacement quiet",
    body: "item.parts.map=()=>[];const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    prelude: 'const records=[{parts:[{name:"label"}]}];',
    collection: "records",
  },
  {
    name: "keeps reflective row-field changes quiet",
    body: 'Object.defineProperty(item,"parts",{value:{map:()=>[]}});const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;',
    count: 0,
    prelude: 'const records=[{parts:[{name:"label"}]}];',
    collection: "records",
  },
  {
    name: "keeps forEach outer callbacks outside the profile",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    outerMethod: "forEach",
  },
  {
    name: "keeps flatMap outer callbacks outside the profile",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content}</div>;",
    count: 0,
    outerMethod: "flatMap",
  },
  {
    name: "keeps custom component children escapes quiet",
    prelude: "const Clear=({children})=>{children.length=0;return null;};",
    body: "const content=item.parts.map(part=><input/>);return <><Clear>{content}</Clear><div key={index}>{content}</div></>;",
    count: 0,
  },
  {
    name: "keeps saved React element props escapes quiet",
    body: "const content=item.parts.map(part=><input/>);const saved=<span>{content}</span>;saved.props.children.length=0;return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps transported native JSX values quiet",
    body: "const content=item.parts.map(part=><input/>);consume(<span>{content}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps custom ancestors of native publications quiet",
    prelude: "const Clear=({children})=>{children.props.children.length=0;return null;};",
    body: "const content=item.parts.map(part=><input/>);return <><Clear><span>{content}</span></Clear><div key={index}>{content}</div></>;",
    count: 0,
  },
  {
    name: "reports direct nested native return publications",
    body: "const content=item.parts.map(part=><input/>);return <section><article><div key={index}><span>{content}</span></div></article></section>;",
    count: 1,
  },
  {
    name: "reports transparent return wrappers",
    body: "const content=item.parts.map(part=><input/>);return ((<section><div key={index}>{content}</div></section>)) as ReactNode;",
    count: 1,
  },
  {
    name: "preserves existing wrapped-child collector behavior",
    body: "const content=item.parts.map(part=><input/>);return <div key={index}>{content as ReactNode}</div>;",
    count: 0,
  },
  {
    name: "keeps String text quiet without explicit stateful JSX",
    body: "const content=item.parts.map(part=><span>{String(part.name)}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps Number text quiet without explicit stateful JSX",
    body: "const content=item.parts.map(part=><span>{Number(part.order)}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps unknown calls quiet without explicit stateful JSX",
    body: "const content=item.parts.map(part=><span>{formatLabel(part)}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps unknown bare values quiet without explicit stateful JSX",
    body: "const content=item.parts.map(part=><span>{label}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
  {
    name: "keeps unknown member values quiet without explicit stateful JSX",
    body: "const content=item.parts.map(part=><span>{external.label}</span>);return <div key={index}>{content}</div>;",
    count: 0,
  },
];

describe("stateful list content aliases", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const source = `${testCase.prelude ?? ""} export const Rows = ({ items }) => <section>{${testCase.collection ?? "items"}.${testCase.outerMethod ?? "map"}((item, index) => { ${testCase.body} })}</section>`;
      const result = runRule(noArrayIndexAsKey, source);
      expect(result.parseErrors).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
});
