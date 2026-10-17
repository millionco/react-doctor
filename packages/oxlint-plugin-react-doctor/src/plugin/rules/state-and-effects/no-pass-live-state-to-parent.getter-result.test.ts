import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

interface GetterResultCase {
  name: string;
  source: string;
  expected: number;
}

const cases: GetterResultCase[] = [
  {
    name: "direct prop result in local status template",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");useEffect(()=>{setStatus(`${getLabel(selected)} chosen`);},[selected,getLabel]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "concise value getter",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "two concise readonly getters",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel?getLabel(value):value.label,[getLabel]);const shown=useCallback(value=>typeof value==="object"?label(value):value,[label]);useEffect(()=>{setStatus(`${shown(selected)} chosen`);},[selected,shown]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "single explicit return getter",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>{return getLabel(value);},[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "readonly scalar getter alias",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);const shown=label;useEffect(()=>{setStatus(`${shown(selected)} chosen`);},[selected,shown]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "getter and independent same-callee notification",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);getLabel(selected);},[selected,label,getLabel]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "getter and independent onChange",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);onChange(selected);},[selected,label,onChange]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "bare concise helper",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const notify=useCallback(value=>onChange(value),[onChange]);useEffect(()=>{notify(selected);},[selected,notify]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "concise effect notification",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");useEffect(()=>onChange(selected),[selected,onChange]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "discarded explicit-return helper",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const notify=useCallback(value=>{return onChange(value);},[onChange]);useEffect(()=>{notify(selected);},[selected,notify]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "unconsumed template",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{`${label(selected)} chosen`;},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "if-test call",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{if(label(selected))setStatus("ready");},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "sequence discarded call",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${(label(selected),"chosen")}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "logical-left callback condition",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)&&"chosen"}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "getter with separate notification",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>{onChange(value);return getLabel(value);},[onChange,getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "getter test-only callback",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>onChange(value)?value.label:"empty",[onChange]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "getter sequence side effect",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>(onChange(value),value.label),[onChange]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "tagged template",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(tag`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "opaque sink",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{consume(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "opaque returned helper",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>derive(getLabel(value)),[getLabel]);useEffect(()=>{setStatus(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "opaque getter callable alias",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=external(getLabel);useEffect(()=>{setStatus(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "mutable getter",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");let label=value=>getLabel(value);label=onChange;useEffect(()=>{setStatus(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "recursive helper",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>value?label(value):getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "nested returned arrow value",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>()=>onChange(value),[onChange]);useEffect(()=>{setStatus(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "parameter reassignment",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>{value=selected;return getLabel(value);},[selected,getLabel]);useEffect(()=>{setStatus(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "default producer parameter",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback((value=readInput())=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "extra arguments",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected,extra)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "method .call",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label.call(null,selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "async getter",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(async value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)}`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "existing captured variable control",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");useEffect(()=>{const label=getLabel(selected);setStatus(label);},[selected,getLabel]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "existing direct argument control",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");useEffect(()=>{setStatus(getLabel(selected));},[selected,getLabel]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "harmless native state metadata",
    source:
      'import React from "react";import {useCallback,useEffect,useState} from "react";useState.description = "metadata"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "default provider mutation",
    source:
      'import React from "react";import {useCallback,useEffect,useState} from "react";React.useState = custom; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "named hook opaque escape",
    source:
      'import React from "react";import {useCallback,useEffect,useState} from "react";install(useState); function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "getter default producer",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback((value=loadValue())=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "setter replacement",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});let [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);setStatus=custom;useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "setter metadata",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);setStatus.description="metadata";useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "native callback mutation",
    source:
      'import React from "react";import {useCallback,useEffect,useState} from "react";React.useCallback = custom; function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "namespace opaque escape",
    source:
      'import React from "react";import {useCallback,useEffect,useState} from "react";install(React); function Panel({getLabel,onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "unrelated sibling prop default",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel,onChange,heading="Text"}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 0,
  },
  {
    name: "getter producer default",
    source:
      'import {useCallback,useEffect,useState} from "react"; function Panel({getLabel=loadGetter(),onChange}){const [selected,setSelected]=useState({label:"start"});const [status,setStatus]=useState("");const label=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setStatus(`${label(selected)} chosen`);},[selected,label]);return <button onClick={()=>setSelected({label:"next"})}>{status}</button>;}',
    expected: 1,
  },
  {
    name: "keeps alternate preact/compat status sink unmodified unsupported",
    source:
      "import {useEffect,useState} from 'react';import StateProvider,{useState as createState} from 'preact/compat';function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "keeps alternate preact/compat status sink direct replacement unsupported",
    source:
      "import {useEffect,useState} from 'react';import StateProvider,{useState as createState} from 'preact/compat';StateProvider.useState=customState;function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "keeps alternate preact/compat status sink pattern replacement unsupported",
    source:
      "import {useEffect,useState} from 'react';import StateProvider,{useState as createState} from 'preact/compat';({sink:StateProvider.useState}=replacement);function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "keeps alternate preact/compat status sink loop replacement unsupported",
    source:
      "import {useEffect,useState} from 'react';import StateProvider,{useState as createState} from 'preact/compat';for(StateProvider.useState of replacements){}function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "keeps alternate @wordpress/element status sink unmodified unsupported",
    source:
      "import {useEffect,useState} from 'react';import StateProvider,{useState as createState} from '@wordpress/element';function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "keeps alternate @wordpress/element status sink direct replacement unsupported",
    source:
      "import {useEffect,useState} from 'react';import StateProvider,{useState as createState} from '@wordpress/element';StateProvider.useState=customState;function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "keeps alternate @wordpress/element status sink pattern replacement unsupported",
    source:
      "import {useEffect,useState} from 'react';import StateProvider,{useState as createState} from '@wordpress/element';({sink:StateProvider.useState}=replacement);function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "keeps alternate @wordpress/element status sink loop replacement unsupported",
    source:
      "import {useEffect,useState} from 'react';import StateProvider,{useState as createState} from '@wordpress/element';for(StateProvider.useState of replacements){}function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "supports canonical renamed status state import",
    source:
      "import {useEffect,useState,useState as createState} from 'react';function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=createState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 0,
  },
  {
    name: "supports canonical default namespace status state call",
    source:
      "import StateProvider,{useEffect,useState} from 'react';function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=StateProvider.useState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 0,
  },
  {
    name: "supports canonical namespace import status state call",
    source:
      "import {useEffect,useState} from 'react';import * as StateProvider from 'react';function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=StateProvider.useState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 0,
  },
  {
    name: "keeps canonical require status sink outside first import scope",
    source:
      "import {useEffect,useState} from 'react';const StateProvider=require('react');function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=StateProvider.useState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
  {
    name: "keeps canonical namespace alias status sink unsupported",
    source:
      "import StateProvider,{useEffect,useState} from 'react';const StateAlias=StateProvider;function Panel({getLabel}){const[selected,setSelected]=useState('start');const[status,setStatus]=StateAlias.useState('');useEffect(()=>{setStatus(`${getLabel(selected)} selected`);},[selected]);return <button onClick={()=>setSelected('next')}>{status}</button>}",
    expected: 1,
  },
];

describe("local status getter result roles", () => {
  it.each(cases)("$name", ({ source, expected }) => {
    const result = runRule(noPassLiveStateToParent, source, {
      filename: "fixture.jsx",
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
