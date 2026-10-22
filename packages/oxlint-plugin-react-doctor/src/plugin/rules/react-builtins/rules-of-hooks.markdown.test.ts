import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const cases = [
  {
    name: "inline genuine component entry",
    code: "import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}}}/>;}",
    expected: 0,
  },
  {
    name: "readonly const literal component map",
    code: "import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){const components={'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}};return <Markdown components={components}/>;}",
    expected: 0,
  },
  {
    name: "readonly const memo literal component map",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components=useMemo(()=>({'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}}),[]);return <Markdown components={components}/>;}",
    expected: 0,
  },
  {
    name: "memo producer remains a callback",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components=useMemo(()=>{useState(0);return {'count-item':()=> <span/>};},[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "entry nested event remains a callback",
    code: "import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){const components={'count-item':()=>{const [count]=useState(0);return <button onClick={()=>useState(0)}>{count}</button>;}};return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "conditional component hook remains invalid",
    code: "import Markdown from 'react-markdown'; import {useState} from 'react'; function View({enabled}){return <Markdown components={{'count-item':()=>{if(enabled)useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "async component hook remains invalid",
    code: "import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':async()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "foreign default import is not Markdown",
    code: "import Markdown from './markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "shadowed Markdown parameter unsupported",
    code: "import Markdown from 'react-markdown'; import {useState} from 'react'; function View({Markdown}){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "intrinsic same-name property unsupported",
    code: "import {useState} from 'react'; function View(){return <div components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "escaped component map unsupported",
    code: "import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};replace(components);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "loop try early-return hooks retain warnings",
    code: "import Markdown from 'react-markdown'; import {useState} from 'react'; function View({enabled}){return <Markdown components={{'loop-count':()=>{for(const count of [1])useState(count);return <span/>;},'try-count':()=>{try{useState(0);}catch{}return <span/>;},'early-count':()=>{if(enabled)return null;useState(0);return <span/>;}}}/>;}",
    expected: 3,
  },
  {
    name: "renamed runtime renderer import",
    code: "import Renderer from 'react-markdown'; import {useState} from 'react'; function View(){return <Renderer components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 0,
  },
  {
    name: "readonly memo callback alias unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const createComponents=()=> ({'count-item':()=>{useState(0);return <span/>;}});const components=useMemo(createComponents,[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "memo block return unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components=useMemo(()=>{return {'count-item':()=>{useState(0);return <span/>;}};},[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "map binding mutable let unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){let components={'count-item':()=>{useState(0);return <span/>;}};return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "map const alias unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};const alias=components;return <Markdown components={alias}/>;}",
    expected: 1,
  },
  {
    name: "map property assignment unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};components['count-item']=replacement;return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "map property read unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};void components['count-item'];return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "map returned escape unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};function expose(){return components;}return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "map unknown call escape unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};unknown(components);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "map second fake consumer unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};return <><Markdown components={components}/><Other components={components}/></>;}",
    expected: 1,
  },
  {
    name: "map spread unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={...other,'count-item':()=>{useState(0);return <span/>;}};return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "computed map key unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){return <Markdown components={{['count-item']:()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "prototype map key unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){return <Markdown components={{__proto__:()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "duplicate map keys unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){return <Markdown components={{count:()=>{useState(0);return <span/>;},count:()=> <span/>}}/>;}",
    expected: 1,
  },
  {
    name: "map method unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){return <Markdown components={{count(){useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "getter map entry unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){return <Markdown components={{get count(){useState(0);return ()=> <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "named expression self-binding unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){return <Markdown components={{count:function Inner(){useState(0);return <span/>;}}}/>;}",
    expected: 0,
  },
  {
    name: "renderer namespace unsupported",
    code: "import * as Renderer from 'react-markdown'; import {useState} from 'react'; function View(){return <Renderer.default components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "renderer alias unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; const Renderer=Markdown;function View(){return <Renderer components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "renderer opaque escape unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; unknown(Markdown);function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "renderer mutable binding unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; Markdown=Other;function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "renderer type-only import unsupported",
    code: "import type Markdown from 'react-markdown';import {useState} from 'react';function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "consumer spread unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}} {...props}/>;}",
    expected: 1,
  },
  {
    name: "consumer duplicate attribute unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}} components={other}/>;}",
    expected: 1,
  },
  {
    name: "native memo import shadow unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View({useMemo}){const components=useMemo(()=> ({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "native memo import type-only unsupported",
    code: "import Markdown from 'react-markdown';import type {useMemo} from 'react';import {useState} from 'react';function View(){const components=useMemo(()=> ({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "native memo mutable import unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; useMemo=replacement;function View(){const components=useMemo(()=> ({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "native memo callable escape unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; unknown(useMemo);function View(){const components=useMemo(()=> ({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "native memo default provider mutation unsupported",
    code: "import React from 'react';import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; React.useMemo=replacement;function View(){const components=useMemo(()=> ({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "native memo default provider escape unsupported",
    code: "import React from 'react';import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; unknown(React);function View(){const components=useMemo(()=> ({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "native namespace memo supported",
    code: "import React,{useState} from 'react';import Markdown from 'react-markdown';function View(){const components=React.useMemo(()=> ({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 0,
  },
  {
    name: "canonical React require side channel unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; const React=require('react');React.useMemo=replacement;function View(){const components=useMemo(()=> ({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "canonical renderer require side channel unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; const renderer=require('react-markdown');function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "direct eval lexical escape unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};eval('components.count()');return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "global Function exposure unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; const create=Function;function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "resolved global evaluator exposure unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; const name='eval';const execute=globalThis[name];function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "constructor exposure unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; const create=(()=>{}).constructor;function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "reflect exposure unsupported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; const create=Reflect.get(()=>{},'constructor');function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "type positions do not escape runtime",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; type Label=typeof Function;function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 0,
  },
  {
    name: "runtime wrapper retains evaluator exposure",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; const create=(Function as unknown);function View(){return <Markdown components={{'count-item':()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "multiple readonly consumers supported",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components={'count-item':()=>{useState(0);return <span/>;}};return <><Markdown components={components}/><Markdown components={components}/></>;}",
    expected: 0,
  },
  {
    name: "producer own hook not promoted with entry",
    code: "import Markdown from 'react-markdown'; import {useMemo,useState} from 'react'; function View(){const components=useMemo(()=>{useState(0);return {'count-item':()=>{useState(0);return <span/>;}};},[]);return <Markdown components={components}/>;}",
    expected: 2,
  },
  {
    name: "exported map remains unsupported without new coverage credit",
    code: "import Markdown from 'react-markdown';import {useState} from 'react';export const components={'count-item':()=>{if(enabled)useState(0);return <span/>;}};function View(){return <Markdown components={components}/>;}",
    expected: 0,
  },
  {
    name: "foreign memo provider is unsupported",
    code: "import Markdown from 'react-markdown';import {useMemo} from './hooks';import {useState} from 'react';function View(){const components=useMemo(()=>({'count-item':()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "unknown computed callable projection unsupported",
    code: "import Markdown from 'react-markdown';import {useState} from 'react';const pick=()=> 'constructor';const create=(()=>{})[pick()];function View(){return <Markdown components={{count:()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "unknown computed pattern projection unsupported",
    code: "import Markdown from 'react-markdown';import {useState} from 'react';const pick=()=> 'constructor';const {[pick()]: create}=()=>{};function View(){return <Markdown components={{count:()=>{useState(0);return <span/>;}}}/>;}",
    expected: 1,
  },
  {
    name: "literal numeric member read supported",
    code: "import Markdown from 'react-markdown';import {useState} from 'react';const labels=['count'];function View(){return <Markdown components={{count:()=>{useState(0);return <span>{labels[0]}</span>;}}}/>;}",
    expected: 0,
  },
  {
    name: "native loader alias exposure unsupported",
    code: "import Markdown from 'react-markdown';import {useMemo,useState} from 'react';const load=require;const React=load('react');React.useMemo=replacement;function View(){const components=useMemo(()=>({count:()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "native loader module import unsupported",
    code: "import {createRequire} from 'node:module';import Markdown from 'react-markdown';import {useMemo,useState} from 'react';const load=createRequire(import.meta.url);const React=load('react');React.useMemo=replacement;function View(){const components=useMemo(()=>({count:()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
  {
    name: "native process loader exposure unsupported",
    code: "import Markdown from 'react-markdown';import {useMemo,useState} from 'react';const React=process.mainModule.require('react');React.useMemo=replacement;function View(){const components=useMemo(()=>({count:()=>{useState(0);return <span/>;}}),[]);return <Markdown components={components}/>;}",
    expected: 1,
  },
];

describe("rules-of-hooks ReactMarkdown component maps", () => {
  for (const entry of cases) {
    it(entry.name, () => {
      const result = runRule(rulesOfHooks, entry.code, {
        filename: "markdown-profile.tsx",
        forceJsx: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(entry.expected);
    });
  }
});
