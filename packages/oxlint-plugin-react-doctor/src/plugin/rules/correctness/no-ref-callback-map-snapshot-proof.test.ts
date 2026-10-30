import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";
import { hasOwnedCallbackMapSnapshot } from "./utils/has-owned-callback-map-snapshot.js";

interface SnapshotProofRegressionCase {
  name: string;
  code: string;
  expected: number;
  expectedLine?: number;
  expectedAdmissions?: boolean[];
}

const cases: readonly SnapshotProofRegressionCase[] = [
  {
    name: "baseline-readonly-property",
    code: "\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); \n const item = {id:'first'};\n \n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 0,
  },
  {
    name: "erased-global-map-interface",
    code: "interface Map {}\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); \n const item = {id:'first'};\n \n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 0,
  },
  {
    name: "erased-global-map-type-alias",
    code: "type Map = {};\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); \n const item = {id:'first'};\n \n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 0,
  },
  {
    name: "real-ref-merged-interface",
    code: "\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); interface entries {}\n const item = {id:'first'};\n \n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 0,
  },
  {
    name: "genuine-local-map-provider",
    code: "class Map { set(){} delete(){} }\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); \n const item = {id:'first'};\n \n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 1,
  },
  {
    name: "key-container-direct-mutator",
    code: "\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); \n const item = {id:'first'};\n const changeKey=(target)=>{target.id='second'};React.useEffect(()=>{changeKey(item)},[]);\n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 1,
  },
  {
    name: "key-container-opaque-call",
    code: "\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); \n const item = {id:'first'};\n React.useEffect(()=>{inspect(item)},[]);\n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 1,
  },
  {
    name: "selected-leaf-readonly-observation",
    code: "\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); \n const item = {id:'first'};\n React.useEffect(()=>{inspect(item.id)},[]);\n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 0,
  },
  {
    name: "unrelated-branch-readonly-observation",
    code: "\nimport * as React from 'react';\nexport const EntryPanel = () => {\n const entries = React.useRef(new Map()); \n const item = {id:'first'};\n React.useEffect(()=>{inspect(item.other)},[]);\n return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id)}}}>Entry</li>;\n};",
    expected: 0,
  },
  {
    name: "nominal",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "global-require-react-replacement",
    code: 'import * as React from "react";\nrequire("react").useRef = () => ({ current: new Map() });\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 1,
  },
  {
    name: "real-local-loader-replacement",
    code: 'import * as React from "react";\nconst require = (_name: string) => ({ useRef: () => null });\nrequire("react").useRef = () => null;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "merged-react-namespace-interface",
    code: 'import * as React from "react";\ninterface React {}\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "retains-exact-three-statement-boundary-merged-callback-input-interface",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    interface element {}\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 1,
  },
  {
    name: "retains-exact-three-statement-boundary-merged-snapshot-interface",
    code: 'import * as React from "react";\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    interface snapshot {}\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 1,
  },
  {
    name: "global-module-react-replacement",
    code: 'import * as React from "react";\nmodule.require("react").useRef = () => ({ current: new Map() });\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 1,
  },
  {
    name: "readonly-static-key-nominal",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 0,
  },
  {
    name: "opaque-key-object-escape",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};retain(item);return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 1,
  },
  {
    name: "readonly-selected-primitive-key-observation",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};retain(item.id);return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 0,
  },
  {
    name: "readonly-unrelated-primitive-field-observation",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};retain(item.label);return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 0,
  },
  {
    name: "different-null-key",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete("other");return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 1,
  },
  {
    name: "different-cleanup-key",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete("other");};}}>Entry</li>;};',
    expected: 1,
  },
  {
    name: "mixed-cleanup-receiver",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{entries.current.delete(item.id);};}}>Entry</li>;};',
    expected: 1,
  },
  {
    name: "snapshot-opaque-escape",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};return <li ref={(element)=>{const snapshot=entries.current;retain(snapshot);if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 1,
  },
  {
    name: "selected-key-write",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};item.id="other";return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 1,
  },
  {
    name: "ref-replacement",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};entries.current=new Map();return <li ref={(element)=>{const snapshot=entries.current;if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 1,
  },
  {
    name: "attach-before-snapshot",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{const entries=React.useRef<Map<string,HTMLLIElement>>(new Map());const item={id:"card",label:"Label"};return <li ref={(element)=>{if(element)snapshot.set(item.id,element);else snapshot.delete(item.id);const snapshot=entries.current;return()=>{snapshot.delete(item.id);};}}>Entry</li>;};',
    expected: 1,
  },
  {
    name: "readonly-required-react-member",
    code: 'import * as React from "react";\nvoid require("react").useRef;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "readonly-module-react-member",
    code: 'import * as React from "react";\nvoid module.require("react").useRef;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "foreign-required-member-write",
    code: 'import * as React from "react";\nrequire("foreign-provider").useRef=()=>null;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "foreign-module-member-write",
    code: 'import * as React from "react";\nmodule.require("foreign-provider").useRef=()=>null;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "genuine-local-module-provider",
    code: 'import * as React from "react";\nconst module={require:(_name:string)=>({useRef:()=>null})};module.require("react").useRef=()=>null;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "inert-global-loader-observations",
    code: 'import * as React from "react";\nvoid require;typeof module;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "opaque-global-loader-alias",
    code: 'import * as React from "react";\nconst loadProvider=require;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 1,
  },
  {
    name: "dynamic-global-loader",
    code: 'import * as React from "react";\nrequire(providerName);\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 1,
  },
  {
    name: "erased-require-react-write",
    code: 'import * as React from "react";\ninterface require {} require("react").useRef=()=>null;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 1,
  },
  {
    name: "erased-module-react-write",
    code: 'import * as React from "react";\ntype module=unknown;module.require("react").useRef=()=>null;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 1,
  },
  {
    name: "real-local-loader-merged-interface",
    code: 'import * as React from "react";\nconst require=(_name:string)=>({useRef:()=>null});interface require {} require("react").useRef=()=>null;\ninterface PanelProps { onInspect?: (value: unknown) => void; attributes?: React.HTMLAttributes<HTMLLIElement>; }\nexport const EntryPanel = ({ onInspect, attributes }: PanelProps) => {\n  const entries = React.useRef<Map<string, HTMLLIElement>>(new Map());\n  const entryKey = "card";\n  \n  return <li ref={(element) => {\n    const snapshot = entries.current;\n    if (element) snapshot.set(entryKey, element);\n    else snapshot.delete(entryKey);\n    return () => { snapshot.delete(entryKey); };\n  }}>Entry</li>;\n};\n',
    expected: 0,
  },
  {
    name: "cache-context-tag-then-nested-id",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{\nconst item={nested:{id:"card"},tag:"x"};\nconst tagEntries=React.useRef<Map<string,HTMLLIElement>>(new Map());\nconst nestedEntries=React.useRef<Map<string,HTMLLIElement>>(new Map());\ninspect(item.nested);\nreturn <ul>\n<li data-path="tag" ref={(element)=>{const snapshot=tagEntries.current;if(element)snapshot.set(item.tag,element);else snapshot.delete(item.tag);return()=>{snapshot.delete(item.tag);};}}>Entry</li>\n<li data-path="nested.id" ref={(element)=>{const snapshot=nestedEntries.current;if(element)snapshot.set(item.nested.id,element);else snapshot.delete(item.nested.id);return()=>{snapshot.delete(item.nested.id);};}}>Entry</li>\n</ul>;};',
    expected: 1,
    expectedLine: 9,
    expectedAdmissions: [true, false],
  },
  {
    name: "cache-context-nested-id-then-tag",
    code: 'import * as React from "react";\nexport const EntryPanel=()=>{\nconst item={nested:{id:"card"},tag:"x"};\nconst tagEntries=React.useRef<Map<string,HTMLLIElement>>(new Map());\nconst nestedEntries=React.useRef<Map<string,HTMLLIElement>>(new Map());\ninspect(item.nested);\nreturn <ul>\n<li data-path="nested.id" ref={(element)=>{const snapshot=nestedEntries.current;if(element)snapshot.set(item.nested.id,element);else snapshot.delete(item.nested.id);return()=>{snapshot.delete(item.nested.id);};}}>Entry</li>\n<li data-path="tag" ref={(element)=>{const snapshot=tagEntries.current;if(element)snapshot.set(item.tag,element);else snapshot.delete(item.tag);return()=>{snapshot.delete(item.tag);};}}>Entry</li>\n</ul>;};',
    expected: 1,
    expectedLine: 8,
    expectedAdmissions: [false, true],
  },
];

describe("callback Map snapshot proof boundaries", () => {
  it.each(cases)("$name", ({ name, code, expected, expectedLine, expectedAdmissions }) => {
    const result = runRule(noRefCallbackCleanupBeforeReact19, code, {
      filename: `/synthetic/map-snapshot-proof/${name}.tsx`,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
    if (expectedLine !== undefined) expect(result.diagnostics[0]?.line).toBe(expectedLine);
    if (expectedAdmissions) {
      const parsed = parseFixture(code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const attributes: EsTreeNode[] = [];
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "JSXAttribute") &&
          isNodeOfType(node.name, "JSXIdentifier") &&
          node.name.name === "ref"
        )
          attributes.push(node);
      });
      expect(
        attributes.map((attribute) => hasOwnedCallbackMapSnapshot({ attribute, scopes })),
      ).toEqual(expectedAdmissions);
    }
  });
});
