import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoStateInUseFrame } from "./r3f-no-state-in-use-frame.js";

describe("r3f early-return callback identity", () => {
  it.each([
    {
      name: "named receiver recursion",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);this.current();});return null};",
      expected: 1,
    },
    {
      name: "anonymous receiver recursion",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function(){if(active)return;setActive(true);this.current();});return null};",
      expected: 1,
    },
    {
      name: "computed receiver recursion",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);this['current']();});return null};",
      expected: 1,
    },
    {
      name: "receiver function alias",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);const invoke=this.current;invoke();});return null};",
      expected: 1,
    },
    {
      name: "receiver object escape",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);retain(this);});return null};",
      expected: 1,
    },
    {
      name: "lexical receiver arrow",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);(()=>this.current())();});return null};",
      expected: 1,
    },
    {
      name: "unknown receiver lookup",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);this[key]();});return null};",
      expected: 1,
    },
    {
      name: "receiver function metadata",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);void this.current.name;});return null};",
      expected: 0,
    },
    {
      name: "receiver function typeof",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);void(typeof this.current);});return null};",
      expected: 0,
    },
    {
      name: "receiver unrelated property",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);void this.position;});return null};",
      expected: 0,
    },
    {
      name: "unrelated object member",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);const other={current(){}};other.current();});return null};",
      expected: 0,
    },
    {
      name: "arrow lexical receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(() =>{if(active)return;setActive(true);void this;});return null};",
      expected: 0,
    },
    {
      name: "unused nested ordinary receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);function unrelated(){this.current();}});return null};",
      expected: 0,
    },
    {
      name: "dead receiver recursion",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);if(false)this.current();});return null};",
      expected: 0,
    },
    {
      name: "named implicit callee",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);arguments.callee();});return null};",
      expected: 1,
    },
    {
      name: "anonymous implicit callee",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function(){if(active)return;setActive(true);arguments.callee();});return null};",
      expected: 1,
    },
    {
      name: "computed implicit callee",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);arguments['callee']();});return null};",
      expected: 1,
    },
    {
      name: "implicit arguments alias",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);const args=arguments;args.callee();});return null};",
      expected: 1,
    },
    {
      name: "lexical arguments arrow",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);(()=>arguments.callee())();});return null};",
      expected: 1,
    },
    {
      name: "callee metadata",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);void arguments.callee.name;});return null};",
      expected: 0,
    },
    {
      name: "arguments typeof",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);void(typeof arguments);});return null};",
      expected: 0,
    },
    {
      name: "arguments count",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);void arguments.length;});return null};",
      expected: 0,
    },
    {
      name: "shadowed arguments parameter",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(arguments){if(active)return;setActive(true);arguments.callee();});return null};",
      expected: 0,
    },
    {
      name: "dead callee recursion",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);if(false)arguments.callee();});return null};",
      expected: 0,
    },
    {
      name: "receiver valueOf identity escape",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);this.valueOf().current();});return null};",
      expected: 1,
    },
    {
      name: "arguments valueOf identity escape",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);arguments.valueOf().callee();});return null};",
      expected: 1,
    },
    {
      name: "module callee remains outside sufficient certificate",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);arguments.callee();});return null};",
      expected: 1,
    },
    {
      name: "strict CJS callee remains outside sufficient certificate",
      filename: "scene.cjs",
      source:
        "\"use strict\";const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);arguments.callee();});return null};",
      expected: 1,
    },
    {
      name: "non-simple callee remains outside sufficient certificate",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(state = {}){if(active)return;setActive(true);arguments.callee();});return null};",
      expected: 1,
    },
    {
      name: "literal argument observation does not expose callback identity",
      filename: "scene.cjs",
      source:
        "const{useState}=require('react');const{useFrame}=require('@react-three/fiber');const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);void arguments[0];});return null};",
      expected: 0,
    },
    {
      name: "class computed method key uses callback receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);class Local{[this.current()](){}};});return null};",
      expected: 1,
    },
    {
      name: "class heritage uses callback receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);class Local extends this.current(){};});return null};",
      expected: 1,
    },
    {
      name: "class computed field key uses callback receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);class Local{[this.current()]=0;};});return null};",
      expected: 1,
    },
    {
      name: "class method body owns receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);class Local{method(){this.current();}};});return null};",
      expected: 0,
    },
    {
      name: "class instance field owns receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);class Local{field=this.current();};});return null};",
      expected: 0,
    },
    {
      name: "class static field owns receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);class Local{static field=this.current();};});return null};",
      expected: 0,
    },
    {
      name: "class static block owns receiver",
      filename: "scene.mjs",
      source:
        "import{useState}from'react';import{useFrame}from'@react-three/fiber';const Scene=()=>{const[active,setActive]=useState(false);useFrame(function frame(){if(active)return;setActive(true);class Local{static{this.current();}};});return null};",
      expected: 0,
    },
  ])("$name", ({ source, filename, expected }) => {
    const result = runRule(r3fNoStateInUseFrame, source, { filename, includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
