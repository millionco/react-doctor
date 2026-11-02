import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { collectOwnedNativeRefUses } from "./collect-owned-native-ref-uses.js";

interface NativeRefFixture {
  readonly name: string;
  readonly source: string;
  readonly refs: ReadonlyArray<string>;
  readonly approvedNativeUseCount: number;
}

const component = (work: string, publication = "<ul ref={list}/>"): string => `
import {useRef,useState} from 'react';
const Panel=()=>{const list=useRef(null);${work}return <div>${publication}</div>};`;

const fixtures: ReadonlyArray<NativeRefFixture> = [
  {
    name: "known template string index setter",
    source: component(
      "const [position,updatePosition]=useState(0);updatePosition(`__proto__`);const run=()=>list.current.children[position].focus();",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "sequence string index setter",
    source: component(
      'const [position,updatePosition]=useState(0);updatePosition((0,"__proto__"));const run=()=>list.current.children[position].focus();',
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "known numeric index setter",
    source: component(
      "const [position,updatePosition]=useState(0);updatePosition(position+1);const run=()=>list.current.children[position].focus();",
    ),
    refs: ["list"],
    approvedNativeUseCount: 1,
  },
  {
    name: "known string index setter",
    source: component(
      'const [position,updatePosition]=useState(0);updatePosition("__proto__");const run=()=>list.current.children[position].focus();',
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "readonly aliased object index setter",
    source: component(
      "const [position,updatePosition]=useState(0);const value={valueOf(){return 0}};const alias=value;updatePosition(alias);const run=()=>list.current.children[position].focus();",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "own zero argument publication event",
    source: component("const toggle=()=>setShown(true);", "<ul ref={list} onClick={toggle}/>"),
    refs: ["list"],
    approvedNativeUseCount: 0,
  },
  {
    name: "inline zero argument publication event",
    source: component("", "<ul ref={list} onClick={()=>setShown(true)}/>"),
    refs: ["list"],
    approvedNativeUseCount: 0,
  },
  {
    name: "publication event native target mutation",
    source: component(
      "",
      "<ul ref={list} onFocus={event=>{event.currentTarget[opaque]=replacement}}/>",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "publication event target argument refusal",
    source: component(
      "const handler=event=>configure(event.target);",
      "<ul ref={list} onFocus={handler}/>",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "unknown publication event callback",
    source: component("", "<ul ref={list} onClick={foreign}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "escaped publication callback",
    source: component(
      "const toggle=()=>setShown(true);foreign(toggle);",
      "<ul ref={list} onClick={toggle}/>",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "non-event publication callback caller",
    source: component(
      "const toggle=()=>setShown(true);toggle();",
      "<ul ref={list} onClick={toggle}/>",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "publication callback implicit arguments",
    source: component("", "<ul ref={list} onFocus={function(){configure(arguments[0].target)}}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "publication callback native this",
    source: component("", "<ul ref={list} onFocus={function(){this[opaque]=replacement}}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "publication callback implicit global event",
    source: component("", "<ul ref={list} onFocus={()=>configure(event.target)}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "async publication callback",
    source: component("", "<ul ref={list} onClick={async()=>setShown(true)}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "callback default parameter",
    source: component("", "<ul ref={list} onClick={(event=foreign())=>setShown(true)}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "undefined initial",
    source: component("").replace("useRef(null)", "useRef(undefined)"),
    refs: ["list"],
    approvedNativeUseCount: 0,
  },
  {
    name: "direct focus",
    source: component("const run=()=>list.current?.focus();"),
    refs: ["list"],
    approvedNativeUseCount: 0,
  },
  {
    name: "foreign contains active element",
    source: component("const run=()=>list.current?.contains(document.activeElement);"),
    refs: ["list"],
    approvedNativeUseCount: 0,
  },
  {
    name: "contains event target",
    source: component("const run=event=>list.current?.contains(event.target);"),
    refs: ["list"],
    approvedNativeUseCount: 0,
  },
  {
    name: "conditional publication",
    source: component("const shown=true;", "{shown&&<ul ref={list}/>}"),
    refs: ["list"],
    approvedNativeUseCount: 0,
  },
  {
    name: "literal child index",
    source: component("const run=()=>list.current.children[0].focus();"),
    refs: ["list"],
    approvedNativeUseCount: 1,
  },
  {
    name: "readonly own index",
    source: component("const index=1;const run=()=>list.current.children[index].focus();"),
    refs: ["list"],
    approvedNativeUseCount: 1,
  },
  {
    name: "own state index purpose",
    source: component(
      "const [index,setIndex]=useState(-1);const run=()=>list.current.children[index].focus();",
    ),
    refs: ["list"],
    approvedNativeUseCount: 1,
  },
  {
    name: "pure direct snapshot",
    source: component(
      "const run=()=>[...list.current.children].findIndex(item=>item===document.activeElement);",
    ),
    refs: ["list"],
    approvedNativeUseCount: 1,
  },
  {
    name: "readonly snapshot alias",
    source: component(
      "const run=()=>{const nodes=[...list.current.children];return nodes.findIndex(item=>item===document.activeElement)};",
    ),
    refs: ["list"],
    approvedNativeUseCount: 1,
  },
  {
    name: "node name search",
    source: component(
      'const run=()=>[...list.current.children].findIndex(item=>item.nodeName==="INPUT");',
    ),
    refs: ["list"],
    approvedNativeUseCount: 1,
  },
  {
    name: "sole return callback",
    source: component(
      "const run=()=>[...list.current.children].findIndex(item=>{return item===document.activeElement});",
    ),
    refs: ["list"],
    approvedNativeUseCount: 1,
  },
  {
    name: "raw alias",
    source: component("const alias=list;"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "current alias",
    source: component("const alias=list.current;"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  { name: "raw escape", source: component("foreign(list);"), refs: [], approvedNativeUseCount: 0 },
  {
    name: "current escape",
    source: component("foreign(list.current);"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "current write",
    source: component("list.current=foreign;"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "method write",
    source: component("list.current.focus=foreign;"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "pattern write",
    source: component("[list.current]=values;"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "method extraction",
    source: component("const focus=list.current.focus;"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "method transport",
    source: component("list.current.focus.call(other);"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "nonnumeric child key",
    source: component('const key="constructor";list.current.children[key].focus();'),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "object child key",
    source: component("const index={valueOf(){return 0}};list.current.children[index].focus();"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "call child key",
    source: component("list.current.children[read()].focus();"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "index call source",
    source: component("const index=read();list.current.children[index].focus();"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "multiple publications",
    source: component("", "<><ul ref={list}/><ul ref={list}/></>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "duplicate ref",
    source: component("", "<ul ref={list} ref={other}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "spread publication",
    source: component("", "<ul ref={list} {...props}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "polymorphic publication",
    source: component("", '<ul ref={list} as="custom-host"/>'),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "dollar polymorphism",
    source: component("", '<ul ref={list} $as="custom-host"/>'),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "customized native",
    source: component("", '<ul ref={list} is="custom-list"/>'),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "unknown host",
    source: component("", "<Custom ref={list}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "custom ancestor",
    source: component("", "<Custom><ul ref={list}/></Custom>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "attribute-only JSX",
    source: component("", "<div data-child={<ul ref={list}/>}/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "unattached saved JSX",
    source: component("const saved=<ul ref={list}/>;", "<div/>"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "array escape",
    source: component("const nodes=[...list.current.children];foreign(nodes);"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "array mutation",
    source: component("const nodes=[...list.current.children];nodes.reverse();"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "array extra element",
    source: component(
      "const nodes=[other,...list.current.children];nodes.findIndex(item=>item===document.activeElement);",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "snapshot method override",
    source: component(
      "const nodes=[...list.current.children];nodes.findIndex=foreign;nodes.findIndex(item=>item===document.activeElement);",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "item escape",
    source: component("const run=()=>[...list.current.children].findIndex(item=>foreign(item));"),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "callback extra work",
    source: component(
      "const run=()=>[...list.current.children].findIndex(item=>{foreign();return item===document.activeElement});",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "async callback",
    source: component(
      "const run=()=>[...list.current.children].findIndex(async item=>item===document.activeElement);",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "default callback parameter",
    source: component(
      "const run=()=>[...list.current.children].findIndex((item=foreign())=>item===document.activeElement);",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "rest callback parameter",
    source: component(
      "const run=()=>[...list.current.children].findIndex((...items)=>items===document.activeElement);",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "shadow document",
    source: component(
      "const document=foreign;const run=()=>[...list.current.children].findIndex(item=>item===document.activeElement);",
    ),
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "fake ref hook",
    source:
      "const useRef=()=>({current:null});const Panel=()=>{const list=useRef(null);return <ul ref={list}/>}",
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "reassigned ref hook",
    source:
      "import {useRef} from 'react';useRef=foreign;const Panel=()=>{const list=useRef(null);return <ul ref={list}/>}",
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "mixed provider replacement",
    source:
      "import React,{useRef} from 'react';React.useRef=foreign;const Panel=()=>{const list=useRef(null);return <ul ref={list}/>}",
    refs: [],
    approvedNativeUseCount: 0,
  },
  {
    name: "nonempty initial target",
    source: component("").replace("useRef(null)", "useRef(foreign)"),
    refs: [],
    approvedNativeUseCount: 0,
  },
];

describe("collectOwnedNativeRefUses", () => {
  for (const fixture of fixtures)
    it(fixture.name, () => {
      const parsed = parseFixture(fixture.source);
      expect(parsed.errors).toEqual([]);
      expect(isNodeOfType(parsed.program, "Program")).toBe(true);
      if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program");
      attachParentReferences(parsed.program);
      const module = {
        filePath: "/invented/panel.tsx",
        programNode: parsed.program,
        scopes: analyzeScopes(parsed.program),
      };
      const result = collectOwnedNativeRefUses({
        module,
        resolveHostName: (opening) =>
          isNodeOfType(opening.name, "JSXIdentifier") && HTML_TAGS.has(opening.name.name)
            ? opening.name.name
            : null,
      });
      expect([...result.nativeRefs].map((symbol) => symbol.name).sort()).toEqual(fixture.refs);
      expect(result.approvedNativeUseNodes.size).toBe(fixture.approvedNativeUseCount);
    });
});
