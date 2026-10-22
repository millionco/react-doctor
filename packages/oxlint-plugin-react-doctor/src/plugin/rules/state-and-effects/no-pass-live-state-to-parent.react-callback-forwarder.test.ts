import { MODULE_SCOPE_SNIPPET_POOL } from "../../../../../fuzz/src/snippet-pools.js";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

interface ReactCallbackForwarderCase {
  name: string;
  source: string;
  expected: number;
}

const cases: ReactCallbackForwarderCase[] = [
  {
    name: "genuine default React callback forwards selected state",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 1,
  },
  {
    name: "genuine namespace React callback forwards selected state",
    source:
      'import {useCallback,useEffect,useState}from"react";import * as React from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 1,
  },
  {
    name: "genuine default-as React callback forwards selected state",
    source:
      'import {default as React,useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 1,
  },
  {
    name: "named wrapper current control",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 1,
  },
  {
    name: "single explicit return callback",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>{return onChange(value);},[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 1,
  },
  {
    name: "ignored callback parameter",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange("fixed"),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "different captured prop forwarded",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange(other),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "argument remapping is not interpreted",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange(transform(value)),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "callback parameter assignment",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>{value=other;return onChange(value);},[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "extra callback parameter",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback((value,extra)=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "extra outer argument",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected,other);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "async wrapper callback",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(async value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "local non React namespace factory",
    source:
      'import {useCallback,useEffect,useState}from"react";const React={useCallback:callback=>()=>null};\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "explicit dirty React callback provider",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n React.useCallback=custom;const notify=React.useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "accessor dirty default wrapper known hold",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n React.__defineGetter__("useCallback",()=>callback=>()=>null);const notify=React.useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "callback returns function",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>()=>onChange(value),[onChange]);\n useEffect(()=>{notify(selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "returned getter in native local template stays inverse",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({getLabel,other}){\n const[selected,setSelected]=useState("start");\n const[status,setStatus]=useState("");const notify=React.useCallback(value=>getLabel(value),[getLabel]);\n useEffect(()=>{setStatus(`${notify(selected)} selected`);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{status}</button>;\n}\n',
    expected: 0,
  },
  {
    name: "outer spread does not establish direct argument identity",
    source:
      'import React,{useCallback,useEffect,useState}from"react";\nexport default function Panel({onChange,other}){\n const[selected,setSelected]=useState("start");\n const notify=React.useCallback(value=>onChange(value),[onChange]);\n useEffect(()=>{notify(...selected);},[notify,selected]);\n return <button onClick={()=>setSelected("next")}>{selected}</button>;\n}\n',
    expected: 0,
  },
];

describe("direct React namespace callback state forwarding", () => {
  it.each(cases)("$name", ({ source, expected }) => {
    const result = runRule(noPassLiveStateToParent, source, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});

describe("React namespace callback module-pool transport", () => {
  it("reports forwarded state and retains a literal-argument inverse", () => {
    const snippet = MODULE_SCOPE_SNIPPET_POOL.find((entry) =>
      entry.includes("FuzzReactNamespaceStateNotification"),
    );
    expect(snippet).toBeDefined();
    if (!snippet) throw new Error("Expected React namespace callback module snippet");
    expect(snippet).toContain("notify(selection);");
    const notification = runRule(noPassLiveStateToParent, snippet, { filename: "fixture.tsx" });
    expect(notification.parseErrors).toEqual([]);
    expect(notification.diagnostics).toHaveLength(1);
    const literalArgument = runRule(
      noPassLiveStateToParent,
      snippet.replace("notify(selection);", 'notify("fixed");'),
      { filename: "fixture.tsx" },
    );
    expect(literalArgument.parseErrors).toEqual([]);
    expect(literalArgument.diagnostics).toEqual([]);
  });
});
