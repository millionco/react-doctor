import { describe, expect, it } from "vite-plus/test";
import type { Rule } from "../../utils/rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { inkCtrlCHandlerRequiresExitOption } from "./ink-ctrl-c-handler-requires-exit-option.js";
import { inkNewlineInsideText } from "./ink-newline-inside-text.js";
import { inkNoBareProcessExit } from "./ink-no-bare-process-exit.js";
import { inkNoDirectRawMode } from "./ink-no-direct-raw-mode.js";
import { inkNoDomHostElements } from "./ink-no-dom-host-elements.js";
import { inkNoDomRouter } from "./ink-no-dom-router.js";
import { inkNoFocusInRender } from "./ink-no-focus-in-render.js";
import { inkNoLayoutInsideText } from "./ink-no-layout-inside-text.js";
import { inkNoLiveHooksInRenderToString } from "./ink-no-live-hooks-in-render-to-string.js";
import { inkNoMeasureElementInRender } from "./ink-no-measure-element-in-render.js";
import { inkNoMultipleStatic } from "./ink-no-multiple-static.js";
import { inkNoRawText } from "./ink-no-raw-text.js";
import { inkNoRepeatedRender } from "./ink-no-repeated-render.js";
import { inkPreferUseAnimation } from "./ink-prefer-use-animation.js";
import { inkPreferUsePaste } from "./ink-prefer-use-paste.js";
import { inkStaticIsAppendOnly } from "./ink-static-is-append-only.js";
import { inkStaticRequiresKey } from "./ink-static-requires-key.js";
import { inkSuspenseRequiresConcurrent } from "./ink-suspense-requires-concurrent.js";
import { inkUseReactiveWindowSize } from "./ink-use-reactive-window-size.js";
import { inkUseStringWidthForCursor } from "./ink-use-string-width-for-cursor.js";
import { inkUseSuspendTerminal } from "./ink-use-suspend-terminal.js";
import { inkValidAriaSemantics } from "./ink-valid-aria-semantics.js";

interface InkRuleCase {
  name: string;
  rule: Rule;
  invalid: string;
  valid: string;
}

const RULE_CASES: ReadonlyArray<InkRuleCase> = [
  {
    name: "raw text",
    rule: inkNoRawText,
    invalid: `import {Box as Layout} from "ink"; const App=()=> <Layout>hello</Layout>;`,
    valid: `import {Box, Text} from "ink"; const App=()=> <Box><Text>hello</Text>{children}</Box>;`,
  },
  {
    name: "layout inside text",
    rule: inkNoLayoutInsideText,
    invalid: `import {Text, Box} from "ink"; const App=()=> <Text><><Box /></></Text>;`,
    valid: `import {Text, Box} from "ink"; const App=()=> <Box><Text>ok</Text></Box>;`,
  },
  {
    name: "newline placement",
    rule: inkNewlineInsideText,
    invalid: `import {Box, Newline} from "ink"; const App=()=> <Box><Newline /></Box>;`,
    valid: `import {Text, Newline} from "ink"; const App=()=> <Text><Newline /></Text>;`,
  },
  {
    name: "Static key",
    rule: inkStaticRequiresKey,
    invalid: `import {Static, Text} from "ink"; const App=({items})=> <Static items={items}>{item => <Text>{item}</Text>}</Static>;`,
    valid: `import {Static, Text} from "ink"; const App=({items})=> <Static items={items}>{(item,index) => <Text key={index}>{item}</Text>}</Static>;`,
  },
  {
    name: "measureElement render phase",
    rule: inkNoMeasureElementInRender,
    invalid: `import {measureElement as measure, Text} from "ink"; const App=({node})=> { measure(node); return <Text />; };`,
    valid: `import {measureElement, Text} from "ink"; import {useLayoutEffect} from "react"; const App=({node})=> { useLayoutEffect(()=>measureElement(node), [node]); return <Text />; };`,
  },
  {
    name: "focus render phase",
    rule: inkNoFocusInRender,
    invalid: `import {useFocusManager, Text} from "ink"; const App=()=> { const manager=useFocusManager(); manager.focus("name"); return <Text />; };`,
    valid: `import {useFocusManager, useInput, Text} from "ink"; const App=()=> { const manager=useFocusManager(); useInput(()=>manager.focus("name")); return <Text />; };`,
  },
  {
    name: "DOM router",
    rule: inkNoDomRouter,
    invalid: `import {Box} from "ink"; import {Link} from "react-router-dom"; const App=()=> <Box><Link to="/" /></Box>;`,
    valid: `import {Box} from "ink"; import {MemoryRouter, Route, Routes} from "react-router"; const App=()=> <MemoryRouter><Box><Routes><Route path="/" element={null} /></Routes></Box></MemoryRouter>;`,
  },
  {
    name: "raw mode",
    rule: inkNoDirectRawMode,
    invalid: `import {useStdin, Text} from "ink"; const App=()=> { const {setRawMode}=useStdin(); setRawMode(true); return <Text />; };`,
    valid: `import {useInput, Text} from "ink"; const App=()=> { useInput(()=>{}); return <Text />; };`,
  },
  {
    name: "terminal suspension",
    rule: inkUseSuspendTerminal,
    invalid: `import {useInput} from "ink"; import {spawn} from "node:child_process"; const App=()=> { useInput(()=>spawn("vim", [], {stdio:"inherit"})); return null; };`,
    valid: `import {useApp, useInput} from "ink"; import {spawn} from "node:child_process"; const App=()=> { const {suspendTerminal}=useApp(); useInput(()=>suspendTerminal(()=>spawn("vim", [], {stdio:"inherit"}))); return null; };`,
  },
  {
    name: "append-only Static",
    rule: inkStaticIsAppendOnly,
    invalid: `import {Static} from "ink"; const App=({items})=> <Static items={items.toReversed()}>{item => null}</Static>;`,
    valid: `import {Static} from "ink"; const App=({items})=> <Static items={items}>{item => null}</Static>;`,
  },
  {
    name: "multiple Static regions",
    rule: inkNoMultipleStatic,
    invalid: `import {Static} from "ink"; const App=()=> <><Static items={[]} /> <Static items={[]} /></>;`,
    valid: `import {Static} from "ink"; const App=()=> <Static items={[]} />;`,
  },
  {
    name: "repeated render",
    rule: inkNoRepeatedRender,
    invalid: `import {render as mount} from "ink"; mount(null); mount(null);`,
    valid: `import {render} from "ink"; const instance=render(null); instance.rerender(null);`,
  },
  {
    name: "bare process exit",
    rule: inkNoBareProcessExit,
    invalid: `import {useInput} from "ink"; const App=()=> { useInput(()=>process.exit(0)); return null; };`,
    valid: `import {useApp, useInput} from "ink"; const App=()=> { const {exit}=useApp(); useInput(()=>exit()); return null; };`,
  },
  {
    name: "Ctrl-C option",
    rule: inkCtrlCHandlerRequiresExitOption,
    invalid: `import {render, useInput} from "ink"; const App=()=> { useInput((input,key)=> { if (key.ctrl && input === "c") work(); }); return null; }; render(<App />);`,
    valid: `import {render, useInput} from "ink"; const App=()=> { useInput((input,key)=> { if (key.ctrl && input === "c") work(); }); return null; }; render(<App />, {exitOnCtrlC:false});`,
  },
  {
    name: "Suspense concurrent mode",
    rule: inkSuspenseRequiresConcurrent,
    invalid: `import {render, Text} from "ink"; import {Suspense} from "react"; render(<Suspense fallback={null}><Text /></Suspense>);`,
    valid: `import {render, Text} from "ink"; import {Suspense} from "react"; render(<Suspense fallback={null}><Text /></Suspense>, {concurrent:true});`,
  },
  {
    name: "renderToString live hooks",
    rule: inkNoLiveHooksInRenderToString,
    invalid: `import {renderToString, useInput, Text} from "ink"; const App=()=> { useInput(()=>{}); return <Text />; }; renderToString(<App />);`,
    valid: `import {renderToString, Text} from "ink"; const App=()=> <Text>snapshot</Text>; renderToString(<App />);`,
  },
  {
    name: "cursor width",
    rule: inkUseStringWidthForCursor,
    invalid: `import {useCursor} from "ink"; const App=({label})=> { const cursor=useCursor(); cursor.setCursorPosition({x:label.length,y:0}); return null; };`,
    valid: `import {useCursor} from "ink"; import stringWidth from "string-width"; const App=({label})=> { const cursor=useCursor(); cursor.setCursorPosition({x:stringWidth(label),y:0}); return null; };`,
  },
  {
    name: "reactive window size",
    rule: inkUseReactiveWindowSize,
    invalid: `import {Text} from "ink"; const App=()=> <Text>{process.stdout.columns}</Text>;`,
    valid: `import {useWindowSize, Text} from "ink"; const App=()=> { const {columns}=useWindowSize(); return <Text>{columns}</Text>; };`,
  },
  {
    name: "paste hook",
    rule: inkPreferUsePaste,
    invalid: `import {useInput} from "ink"; const App=()=> { useInput(input=> { if (input.includes("\\n")) paste(input); }); return null; };`,
    valid: `import {usePaste} from "ink"; const App=()=> { usePaste(input=>paste(input)); return null; };`,
  },
  {
    name: "DOM host elements",
    rule: inkNoDomHostElements,
    invalid: `import {Box} from "ink"; const App=()=> <Box><div /></Box>;`,
    valid: `import {Box, Text} from "ink"; const App=()=> <Box><Text>ok</Text></Box>;`,
  },
  {
    name: "ARIA semantics",
    rule: inkValidAriaSemantics,
    invalid: `import {Text} from "ink"; const App=()=> <Text aria-role="dialog">open</Text>;`,
    valid: `import {Box,Text} from "ink"; const App=()=> <Box aria-role="button" aria-label="Open"><Text>open</Text></Box>;`,
  },
  {
    name: "animation hook",
    rule: inkPreferUseAnimation,
    invalid: `import {useEffect, useState} from "react"; import {Text} from "ink"; const App=()=> { const [frame,setFrame]=useState(0); useEffect(()=> { const timer=setInterval(()=>setFrame(value=>value+1), 80); return ()=>clearInterval(timer); }, []); return <Text>{frame}</Text>; };`,
    valid: `import {useAnimation, Text} from "ink"; const App=()=> { const {frame}=useAnimation({interval:80}); return <Text>{frame}</Text>; };`,
  },
];

describe("Ink rules", () => {
  for (const ruleCase of RULE_CASES) {
    it(`reports ${ruleCase.name}`, () => {
      expect(runRule(ruleCase.rule, ruleCase.invalid).diagnostics).toHaveLength(1);
    });

    it(`accepts valid ${ruleCase.name}`, () => {
      expect(runRule(ruleCase.rule, ruleCase.valid).diagnostics).toHaveLength(0);
    });
  }

  it("ignores same-named local APIs", () => {
    const code = `const Text=({children}) => <span>{children}</span>; const measureElement=()=>{}; const App=()=> { measureElement(); return <Text>hello</Text>; };`;
    expect(runRule(inkNoRawText, code).diagnostics).toHaveLength(0);
    expect(runRule(inkNoMeasureElementInRender, code).diagnostics).toHaveLength(0);
  });

  it("stops at local JSX wrappers whose rendered host is unknown", () => {
    const code = `import {Box,Text} from "ink"; const Wrapper=({children}) => <Text>{children}</Text>; const App=()=> <Box><Wrapper>hello</Wrapper></Box>;`;
    expect(runRule(inkNoRawText, code).diagnostics).toHaveLength(0);
  });

  it("ignores imported names shadowed by local bindings", () => {
    const renderCode = `import {render} from "ink"; const run=(render)=>{render(null);render(null)};`;
    const jsxCode = `import {Box} from "ink"; const App=(Box)=> <Box>hello</Box>;`;
    const routerCode = `import {Box} from "ink"; import {Link} from "react-router-dom"; const App=(Link)=> <Box><Link /></Box>;`;
    expect(runRule(inkNoRepeatedRender, renderCode).diagnostics).toHaveLength(0);
    expect(runRule(inkNoRawText, jsxCode).diagnostics).toHaveLength(0);
    expect(runRule(inkNoDomRouter, routerCode).diagnostics).toHaveLength(0);
  });

  it("recognizes Ink namespace imports", () => {
    const renderCode = `import * as Ink from "ink"; Ink.render(null); Ink.render(null);`;
    const jsxCode = `import * as Ink from "ink"; const App=()=> <Ink.Box>hello</Ink.Box>;`;
    expect(runRule(inkNoRepeatedRender, renderCode).diagnostics).toHaveLength(1);
    expect(runRule(inkNoRawText, jsxCode).diagnostics).toHaveLength(1);
  });

  it("preserves receiver diagnostics through transparent TypeScript wrappers", () => {
    const code = `
      import {useCursor,useFocusManager,useInput} from "ink";
      const App=({label})=> {
        const cursor=useCursor();
        const manager=useFocusManager();
        (manager as any).focus("name");
        (cursor!).setCursorPosition({x:label.length,y:0});
        useInput(input=>{if((input as any).includes("\\n")) paste(input)});
        return null;
      };
    `;
    expect(runRule(inkNoFocusInRender, code).diagnostics).toHaveLength(1);
    expect(runRule(inkUseStringWidthForCursor, code).diagnostics).toHaveLength(1);
    expect(runRule(inkPreferUsePaste, code).diagnostics).toHaveLength(1);
  });

  it("recognizes block-bodied frame updater arrows", () => {
    const code = `
      import {useEffect,useState} from "react";
      import {Text} from "ink";
      const App=()=> {
        const [frame,setFrame]=useState(0);
        useEffect(()=>{setInterval(()=>setFrame(value=>{return value+1}),80)},[]);
        return <Text>{frame}</Text>;
      };
    `;
    expect(runRule(inkPreferUseAnimation, code).diagnostics).toHaveLength(1);
  });

  it("ignores JSX attribute values when checking Box text children", () => {
    const code = `import {Box,Text} from "ink"; const App=()=> <Box paddingX={1}><Text>ok</Text></Box>;`;
    expect(runRule(inkNoRawText, code).diagnostics).toHaveLength(0);
  });

  it("ignores mutually exclusive and separately owned render calls", () => {
    const code = `
      import {render} from "ink";
      const choose=(server)=> { if (!server) render(null); else render(null); };
      const first=()=>render(null);
      const second=()=>render(null);
    `;
    expect(runRule(inkNoRepeatedRender, code).diagnostics).toHaveLength(0);
  });

  it("allows a fresh renderer after unmount", () => {
    const code = `import {render} from "ink"; const first=render(null); first.unmount(); render(null);`;
    expect(runRule(inkNoRepeatedRender, code).diagnostics).toHaveLength(0);
  });

  it("allows separate renderers on different output streams", () => {
    const validCode = `import {render} from "ink"; const run=(firstOutput,secondOutput)=> { render(null,{stdout:firstOutput}); render(null,{stdout:secondOutput}); };`;
    const invalidCode = `import {render} from "ink"; const run=(output)=> { render(null,{stdout:output}); render(null,{stdout:output}); };`;
    const shadowedCode = `import {render} from "ink"; const run=(firstOutput,secondOutput)=> { {const output=firstOutput; render(null,{stdout:output})} {const output=secondOutput; render(null,{stdout:output})} };`;
    const explicitDefaultCode = `import {render} from "ink"; render(null); render(null,{stdout:process.stdout});`;
    expect(runRule(inkNoRepeatedRender, validCode).diagnostics).toHaveLength(0);
    expect(runRule(inkNoRepeatedRender, invalidCode).diagnostics).toHaveLength(1);
    expect(runRule(inkNoRepeatedRender, shadowedCode).diagnostics).toHaveLength(0);
    expect(runRule(inkNoRepeatedRender, explicitDefaultCode).diagnostics).toHaveLength(1);
  });

  it("counts Static regions per component", () => {
    const code = `import {Static} from "ink"; const First=()=> <Static items={[]} />; const Second=()=> <Static items={[]} />;`;
    expect(runRule(inkNoMultipleStatic, code).diagnostics).toHaveLength(0);
  });

  it("allows mutually exclusive Static regions", () => {
    const separateReturns = `import {Static} from "ink"; const App=({compact})=> compact ? <Static items={[]} /> : <Static items={[]} />;`;
    const sharedRoot = `import {Static} from "ink"; const App=({compact})=> <>{compact ? <Static items={[]} /> : <Static items={[]} />}</>;`;
    const logicalBranches = `import {Static} from "ink"; const App=({compact})=> <>{compact && <Static items={[]} />}{!compact && <Static items={[]} />}</>;`;
    expect(runRule(inkNoMultipleStatic, separateReturns).diagnostics).toHaveLength(0);
    expect(runRule(inkNoMultipleStatic, sharedRoot).diagnostics).toHaveLength(0);
    expect(runRule(inkNoMultipleStatic, logicalBranches).diagnostics).toHaveLength(0);
  });

  it("allows stable derived collections in Static", () => {
    const filteredCode = `import {Static} from "ink"; const App=()=> <Static items={[1,2,3].filter(Boolean)}>{item=>null}</Static>;`;
    const sortedCode = `import {Static} from "ink"; const App=()=> <Static items={[3,1,2].toSorted()}>{item=>null}</Static>;`;
    expect(runRule(inkStaticIsAppendOnly, filteredCode).diagnostics).toHaveLength(0);
    expect(runRule(inkStaticIsAppendOnly, sortedCode).diagnostics).toHaveLength(0);
  });

  it("accepts Ink's complete ARIA role set and rejects unsupported states", () => {
    const validCode = `import {Box} from "ink"; const App=()=> <><Box aria-role="listbox" /><Box aria-role="table" /></>;`;
    const invalidCode = `import {Box} from "ink"; const App=()=> <Box aria-state={{pressed:true}} />;`;
    expect(runRule(inkValidAriaSemantics, validCode).diagnostics).toHaveLength(0);
    expect(runRule(inkValidAriaSemantics, invalidCode).diagnostics).toHaveLength(1);
  });

  it("associates renderer options with the component each call mounts", () => {
    const suspenseCode = `
      import {render,Text} from "ink";
      import {Suspense} from "react";
      const Safe=()=> <Suspense fallback={null}><Text>safe</Text></Suspense>;
      const Unsafe=()=> <Suspense fallback={null}><Text>unsafe</Text></Suspense>;
      render(<Safe/>,{concurrent:true});
      render(<Unsafe/>);
    `;
    const ctrlCCode = `
      import {render,useInput} from "ink";
      const Safe=()=> { useInput((input,key)=>{if(key.ctrl&&input==="c") work()}); return null; };
      const Unsafe=()=> { useInput((input,key)=>{if(key.ctrl&&input==="c") work()}); return null; };
      render(<Safe/>,{exitOnCtrlC:false});
      render(<Unsafe/>);
    `;
    expect(runRule(inkSuspenseRequiresConcurrent, suspenseCode).diagnostics).toHaveLength(1);
    expect(runRule(inkCtrlCHandlerRequiresExitOption, ctrlCCode).diagnostics).toHaveLength(1);
  });

  it("associates renderer options through same-file component wrappers", () => {
    const suspenseCode = `
      import {render,Text} from "ink";
      import {Suspense} from "react";
      const SafeBoundary=()=> <Suspense fallback={null}><Text>safe</Text></Suspense>;
      const UnsafeBoundary=()=> <Suspense fallback={null}><Text>unsafe</Text></Suspense>;
      const SafeRoot=()=> <SafeBoundary/>;
      const UnsafeRoot=()=> <UnsafeBoundary/>;
      render(<SafeRoot/>,{concurrent:true});
      render(<UnsafeRoot/>);
    `;
    const ctrlCCode = `
      import {render,useInput} from "ink";
      const SafeInput=()=> { useInput((input,key)=>{if(key.ctrl&&input==="c") work()}); return null; };
      const UnsafeInput=()=> { useInput((input,key)=>{if(key.ctrl&&input==="c") work()}); return null; };
      const SafeRoot=()=> <SafeInput/>;
      const UnsafeRoot=()=> <UnsafeInput/>;
      render(<SafeRoot/>,{exitOnCtrlC:false});
      render(<UnsafeRoot/>);
    `;
    expect(runRule(inkSuspenseRequiresConcurrent, suspenseCode).diagnostics).toHaveLength(1);
    expect(runRule(inkCtrlCHandlerRequiresExitOption, ctrlCCode).diagnostics).toHaveLength(1);
  });

  it("does not associate renderer options through unused nested components or JSX props", () => {
    const suspenseCode = `
      import {render,Text} from "ink";
      import {Suspense} from "react";
      const Root=()=> { const Unused=()=> <Suspense fallback={null}><Text /></Suspense>; return <Text />; };
      render(<Root/>);
    `;
    const ctrlCCode = `
      import {render,useInput} from "ink";
      const Unused=()=> { useInput((input,key)=>{if(key.ctrl&&input==="c") work()}); return null; };
      const Root=()=> null;
      render(<Root unused={<Unused/>}/>);
    `;
    expect(runRule(inkSuspenseRequiresConcurrent, suspenseCode).diagnostics).toHaveLength(0);
    expect(runRule(inkCtrlCHandlerRequiresExitOption, ctrlCCode).diagnostics).toHaveLength(0);
  });

  it("fails closed for unresolved renderer options", () => {
    const suspenseCode = `
      import {render,Text} from "ink";
      import {Suspense} from "react";
      const App=()=> <Suspense fallback={null}><Text /></Suspense>;
      const options={concurrent:true};
      render(<App/>,options);
    `;
    const ctrlCCode = `
      import {render,useInput} from "ink";
      const App=()=> { useInput((input,key)=>{if(key.ctrl&&input==="c") work()}); return null; };
      const options={exitOnCtrlC:false};
      render(<App/>,{...options});
    `;
    expect(runRule(inkSuspenseRequiresConcurrent, suspenseCode).diagnostics).toHaveLength(0);
    expect(runRule(inkCtrlCHandlerRequiresExitOption, ctrlCCode).diagnostics).toHaveLength(0);
  });

  it("allows live hooks in components that also have a live renderer", () => {
    const code = `
      import {render,renderToString,useInput} from "ink";
      const App=()=> { useInput(()=>{}); return null; };
      render(<App/>);
      renderToString(<App/>);
    `;
    expect(runRule(inkNoLiveHooksInRenderToString, code).diagnostics).toHaveLength(0);
  });

  it("allows supported renderToString hook defaults and externally reusable components", () => {
    const supportedDefaultsCode = `
      import {renderToString,useApp,useStdout,useWindowSize} from "ink";
      const App=()=> { const {stdout}=useStdout(); const {columns}=useWindowSize(); const {exit}=useApp(); return null; };
      renderToString(<App/>);
    `;
    const exportedComponentCode = `
      import {renderToString,useInput} from "ink";
      const App=()=> { useInput(()=>{}); return null; };
      export {App};
      renderToString(<App/>);
    `;
    expect(runRule(inkNoLiveHooksInRenderToString, supportedDefaultsCode).diagnostics).toHaveLength(
      0,
    );
    expect(runRule(inkNoLiveHooksInRenderToString, exportedComponentCode).diagnostics).toHaveLength(
      0,
    );
  });

  it("requires active Ink input ownership before suggesting terminal suspension", () => {
    const code = `
      import {Text} from "ink";
      import {spawn} from "node:child_process";
      export const launchEditor=()=>spawn("vim",[],{stdio:"inherit"});
      export const App=()=> <Text>Ready</Text>;
    `;
    expect(runRule(inkUseSuspendTerminal, code).diagnostics).toHaveLength(0);
  });

  it("ignores ordinary input length checks and shadowed nested input", () => {
    const ordinaryLengthCode = `import {useInput} from "ink"; const App=()=> { useInput(input=>{if(input.length>=1) accept(input)}); return null; };`;
    const shadowedInputCode = `import {useInput} from "ink"; const App=()=> { useInput(input=>{["a"].some(input=>input.includes("\\n")); consume(input)}); return null; };`;
    expect(runRule(inkPreferUsePaste, ordinaryLengthCode).diagnostics).toHaveLength(0);
    expect(runRule(inkPreferUsePaste, shadowedInputCode).diagnostics).toHaveLength(0);
  });

  it("requires an Ink frame animation before suggesting useAnimation", () => {
    const domCode = `import {useEffect,useState} from "react"; const Dashboard=()=> { const [frame,setFrame]=useState(0); useEffect(()=>{const timer=setInterval(()=>setFrame(value=>value+1),80); return()=>clearInterval(timer)},[]); return <div>{frame}</div>; };`;
    const indexCode = `import {Text} from "ink"; import {useEffect,useState} from "react"; const App=()=> { const [index,setIndex]=useState(0); useEffect(()=>{const timer=setInterval(()=>setIndex(value=>value+1),80); return()=>clearInterval(timer)},[]); return <Text>{index}</Text>; };`;
    const localTimerCode = `import {Text} from "ink"; import {useEffect,useState} from "react"; const App=()=> { const [frame,setFrame]=useState(0); const setInterval=(callback)=>callback(); useEffect(()=>{setInterval(()=>setFrame(value=>value+1))},[]); return <Text>{frame}</Text>; };`;
    expect(runRule(inkPreferUseAnimation, domCode).diagnostics).toHaveLength(0);
    expect(runRule(inkPreferUseAnimation, indexCode).diagnostics).toHaveLength(0);
    expect(runRule(inkPreferUseAnimation, localTimerCode).diagnostics).toHaveLength(0);
  });

  it("allows process stdout dimensions with an explicit resize subscription", () => {
    const code = `
      import {Text} from "ink";
      import {useEffect,useState} from "react";
      const App=()=> {
        const [columns,setColumns]=useState(process.stdout.columns);
        useEffect(()=> {
          const update=()=>setColumns(process.stdout.columns);
          process.stdout.on("resize",update);
          return()=>process.stdout.off("resize",update);
        },[]);
        return <Text>{columns}</Text>;
      };
    `;
    expect(runRule(inkUseReactiveWindowSize, code).diagnostics).toHaveLength(0);
  });

  it("allows cursor lengths for provably ASCII-only strings", () => {
    const code = `import {useCursor} from "ink"; const App=()=> { const label="Ready"; const cursor=useCursor(); cursor.setCursorPosition({x:label.length,y:0}); return null; };`;
    expect(runRule(inkUseStringWidthForCursor, code).diagnostics).toHaveLength(0);
  });

  it("requires Ctrl-C operands to share a condition", () => {
    const code = `
      import {render,useInput} from "ink";
      const App=()=> {
        useInput((input,key)=>{if(key.ctrl) toggle(); if(input==="c") work()});
        return null;
      };
      render(<App/>);
    `;
    expect(runRule(inkCtrlCHandlerRequiresExitOption, code).diagnostics).toHaveLength(0);
  });

  it("follows renderToString through same-file component wrappers", () => {
    const invalidCode = `
      import {renderToString,useInput} from "ink";
      const Live=()=> {useInput(()=>{}); return null};
      const Root=()=> <Live/>;
      renderToString(<Root/>);
    `;
    const validCode = `
      import {renderToString,useInput} from "ink";
      const Unmounted=()=> {useInput(()=>{}); return null};
      const Root=()=> null;
      renderToString(<Root/>);
    `;
    expect(runRule(inkNoLiveHooksInRenderToString, invalidCode).diagnostics).toHaveLength(1);
    expect(runRule(inkNoLiveHooksInRenderToString, validCode).diagnostics).toHaveLength(0);
  });

  it("follows renderToString through direct fragment children", () => {
    const code = `
      import {renderToString,useInput,Box} from "ink";
      const Live=()=> {useInput(()=>{}); return null};
      renderToString(<><Box><Live/></Box></>);
    `;
    expect(runRule(inkNoLiveHooksInRenderToString, code).diagnostics).toHaveLength(1);
  });

  it("does not associate a lone render call with unmounted components", () => {
    const ctrlCCode = `
      import {render,useInput} from "ink";
      const Root=()=> null;
      const Unmounted=()=> {useInput((input,key)=>{if(key.ctrl&&input==="c") work()}); return null};
      render(<Root/>);
    `;
    const suspenseCode = `
      import {render,Text} from "ink";
      import {Suspense} from "react";
      const Root=()=> <Text>root</Text>;
      const Unmounted=()=> <Suspense fallback={null}><Text>unused</Text></Suspense>;
      render(<Root/>);
    `;
    expect(runRule(inkCtrlCHandlerRequiresExitOption, ctrlCCode).diagnostics).toHaveLength(0);
    expect(runRule(inkSuspenseRequiresConcurrent, suspenseCode).diagnostics).toHaveLength(0);
  });
});
