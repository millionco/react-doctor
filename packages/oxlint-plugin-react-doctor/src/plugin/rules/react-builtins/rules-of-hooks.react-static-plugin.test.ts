import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

let temporaryDirectory: string;
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-static-plugin-"));
  resetFilesystemCaches();
});
afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const cases = [
  {
    label: "root-render-function",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [],
  },
  {
    label: "routes-render-function",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Routes:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [],
  },
  {
    label: "inner-conditional",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{if(props.enabled)useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 118,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "inner-loop",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{for(const entry of props.items)useState(entry);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 132,
        line: 1,
        message:
          "`useState` can run a different number of times inside a loop, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "inner-try",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{try{useState(0)}catch(error){}return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 105,
        line: 1,
        message:
          "`useState` can be skipped by try/catch/finally control flow, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "inner-early-return",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{if(props.hidden)return null;useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 129,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "async-inner",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>async props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 107,
        line: 1,
        message:
          "`useState` runs inside an async function, so React cannot guarantee the same Hook order during render.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "nested-callback",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const callback=()=>{useState(0);return <Previous/>};consume(callback);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 121,
        line: 1,
        message:
          "`useState` runs inside `callback`, which is not a component or Hook, so React cannot attach Hook state to a render.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "iife-return",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>(()=>props=>{useState(0);return <Previous/>;})()});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 106,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "usememo-factory",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>React.useMemo(()=>props=>{useState(0);return <Previous/>;},[])});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 119,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "ordinary-component-returning-callback",
    code: 'import React,{useState,useEffectEvent} from "react";export function Panel(){return props=>{useState(0);return <div/>;};}',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 91,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "fake-root-name",
    code: 'import React,{useState,useEffectEvent} from "react";const unrelated={Root:Previous=>props=>{useState(0);return <Previous/>;}};consume(unrelated);',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 92,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "wrong-path",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/ordinary.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 115,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "wrong-manifest",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-package",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
      },
    },
    diagnostics: [
      {
        column: 115,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "wrong-entry",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "ordinary.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 115,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "missing-manifest",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: null,
    diagnostics: [
      {
        column: 115,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "plugin-record-spread",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({...other,Root:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 110,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "duplicate-root",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{useState(0);return <Previous/>;},Root:other});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 101,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "unknown-property",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{useState(0);return <Previous/>;},Unknown:other});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 101,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "computed-key",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({["Root"]:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [],
  },
  {
    label: "outer-own-hook-default",
    code: 'import React,{useState,useEffectEvent} from "react";export default (options=useState(0))=>({Root:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 115,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "property-factory-own-hook",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>{useState(0);return props=>{useState(0);return <Previous/>;};}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 121,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "outer-async",
    code: 'import React,{useState,useEffectEvent} from "react";export default async options=>({Root:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 107,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "no-own-jsx",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{useState(0);return createUnknown();}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 101,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "jsx-in-nested-only",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{useState(0);const nested=()=> <Previous/>;return unknown;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 101,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "effect-event-inner-scope",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const event=useEffectEvent(()=>{});useState(0);return <Previous onClick={event}/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 174,
        line: 1,
        message:
          "`event` comes from useEffectEvent, so it only works when called from Effects in the same component. It also breaks if saved in a variable or passed around.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "effect-event-sibling-capture",
    code: 'import React,{useState,useEffectEvent} from "react";let leaked;export default options=>({Root:Previous=>props=>{leaked=useEffectEvent(()=>{});return <Previous/>;},Routes:Previous=>props=>{useState(0);leaked();return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 119,
        line: 1,
        message:
          "A function from useEffectEvent only works inside Effects in the same component, so passing it around breaks the event/dependency split.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "visible-react-write",
    code: 'import React,{useState,useEffectEvent} from "react";React.useState=fake;export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 135,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "visible-react-alias-write",
    code: 'import React,{useState,useEffectEvent} from "react";const runtime=React;runtime.useState=fake;export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 157,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "outer-record-helper-return",
    code: 'import React,{useState,useEffectEvent} from "react";const hooks={Root:Previous=>props=>{useState(0);return <Previous/>;}};export default options=>hooks;',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 88,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "wrong-react-static-major",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^8.0.0",
      },
    },
    diagnostics: [
      {
        column: 115,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "unknown-react-static-range",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{const [value]=useState(0);return <Previous>{value}</Previous>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "not-a-semver-range",
      },
    },
    diagnostics: [
      {
        column: 115,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "jsx-return-owned-by-local-helper",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{useState(0);const renderBody=()=> <Previous/>;return renderBody();}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 101,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "jsx-return-through-alias",
    code: 'import React,{useState,useEffectEvent} from "react";export default options=>({Root:Previous=>props=>{useState(0);const output=<Previous/>;return output;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 101,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "namespace-legacy-getter",
    code: 'import React,{useState,useEffectEvent} from "react";import * as R from "react";R.__defineGetter__("useState",()=>()=>0);export default options=>({Root:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 169,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "namespace-valueof-escape",
    code: 'import React,{useState,useEffectEvent} from "react";import * as R from "react";R.valueOf().useState=fake;export default options=>({Root:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 154,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "unimported-global-react-write",
    code: 'import R,{useState} from "react";React.useState=fake;export default options=>({Root:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 102,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "constructor-pattern-capability",
    code: 'import React,{useState,useEffectEvent} from "react";const {constructor:makeCode}=(()=>{});makeCode("globalThis.React={}")();export default options=>({Root:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 173,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
  {
    label: "reflective-constructor-capability",
    code: 'import {useState} from "react";Reflect.get(()=>{},"constructor")("globalThis.React={}")();export default options=>({Root:Previous=>props=>{useState(0);return <Previous/>;}});',
    relativeFilename: "src/browser.api.js",
    manifest: {
      name: "synthetic-react-static-adapter",
      main: "browser.api.js",
      peerDependencies: {
        react: "^17.0.0",
        "react-static": "^7.6.2",
      },
    },
    diagnostics: [
      {
        column: 139,
        line: 1,
        message:
          "`useState` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.",
        nodeType: "Identifier",
      },
    ],
  },
];

const writeSource = (relativeFilename: string, code: string): string => {
  const filename = path.join(temporaryDirectory, relativeFilename);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, code);
  return filename;
};

const acceptedManifest = {
  name: "synthetic-static-plugin",
  main: "browser.api.js",
  peerDependencies: { react: "^17.0.0", "react-static": "^7.6.2" },
};
const acceptedCode =
  'import {useState} from "react";export default ()=>({Root:Previous=>({children})=>{const [value]=useState(0);return <Previous>{children}{value}</Previous>;}});';
const runAt = (filename: string, code: string) =>
  runRule(rulesOfHooks, code, { filename, forceJsx: true, includeLocations: true });

const writeManifest = (value: unknown): void => {
  fs.writeFileSync(path.join(temporaryDirectory, "package.json"), JSON.stringify(value));
};

describe("rules-of-hooks React Static plugin render roles", () => {
  it.each(cases)("$label", ({ code, relativeFilename, manifest, diagnostics }) => {
    if (manifest) writeManifest(manifest);
    const filename = writeSource(relativeFilename, code);
    const result = runAt(filename, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(diagnostics);
  });

  it("tracks manifest edits at the filesystem reset boundary", () => {
    writeManifest(acceptedManifest);
    const filename = writeSource("src/browser.api.js", acceptedCode);
    expect(runAt(filename, acceptedCode).diagnostics).toEqual([]);
    writeManifest({
      ...acceptedManifest,
      peerDependencies: { react: "^17.0.0", "react-static": "^8.0.0" },
    });
    resetFilesystemCaches();
    expect(runAt(filename, acceptedCode).diagnostics).not.toEqual([]);
  });

  it("tracks deletion, appearance and a closer package at the reset boundary", () => {
    writeManifest(acceptedManifest);
    const filename = writeSource("src/browser.api.js", acceptedCode);
    expect(runAt(filename, acceptedCode).diagnostics).toEqual([]);
    fs.unlinkSync(path.join(temporaryDirectory, "package.json"));
    resetFilesystemCaches();
    expect(runAt(filename, acceptedCode).diagnostics).not.toEqual([]);
    writeManifest(acceptedManifest);
    resetFilesystemCaches();
    expect(runAt(filename, acceptedCode).diagnostics).toEqual([]);
    fs.writeFileSync(
      path.join(temporaryDirectory, "src/package.json"),
      JSON.stringify({ name: "ordinary-package" }),
    );
    resetFilesystemCaches();
    expect(runAt(filename, acceptedCode).diagnostics).not.toEqual([]);
  });

  it("composes manifest probes with existing relative hook import dependencies", () => {
    writeManifest(acceptedManifest);
    const filename = writeSource(
      "src/browser.api.js",
      'import {useEntry} from "./entry";useEntry();export default ()=>({});',
    );
    const dependency = writeSource("src/entry.js", "export const useEntry = () => 0;");
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: fs.readFileSync(filename, "utf8"),
      ruleIds: ["rules-of-hooks"],
    });
    expect(trace).not.toBeNull();
    expect(trace?.contentPaths.has(path.join(temporaryDirectory, "package.json"))).toBe(true);
    expect(trace?.existencePaths.has(path.join(temporaryDirectory, "src/package.json"))).toBe(true);
    expect(trace?.contentPaths.has(dependency)).toBe(true);
  });
});
