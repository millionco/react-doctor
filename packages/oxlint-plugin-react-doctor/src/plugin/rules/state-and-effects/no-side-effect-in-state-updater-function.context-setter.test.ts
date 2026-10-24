import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

interface ContextSetterCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly expectedWarnings: number;
}

const baseProjectFiles: Readonly<Record<string, string>> = {
  "package.json":
    '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0"}}',
  "index.html": '<div id="root"></div><script type="module" src="/src/entry.tsx"></script>',
  "src/context.ts":
    'import{createContext}from"react";export const SettingsContext=createContext(null);',
  "src/actions.ts":
    'import{useContext}from"react";import{SettingsContext}from"./context";export const useSettings=()=>{const{updateSettings}=useContext(SettingsContext);return{updateSettings}};',
  "src/provider.tsx":
    'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{const[value,updateSettings]=useState({enabled:false});return <SettingsContext.Provider value={{value,updateSettings}}>{children}</SettingsContext.Provider>};export default SettingsProvider;',
  "src/panel.tsx":
    'import{useState}from"react";import{useSettings}from"./actions";export const Panel=()=>{const{updateSettings}=useSettings();const[enabled,setEnabled]=useState(false);return <button onClick={()=>setEnabled(previous=>{updateSettings({enabled:!previous});return !previous})}>{String(enabled)}</button>};',
  "src/entry.tsx":
    'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
};

const cases: ReadonlyArray<ContextSetterCase> = [
  {
    name: "direct-native-context-setter",
    files: baseProjectFiles,
    expectedWarnings: 1,
  },
  {
    name: "renamed-selected-binding",
    files: {
      ...baseProjectFiles,
      "src/panel.tsx":
        'import{useState}from"react";import{useSettings}from"./actions";export const Panel=()=>{const{updateSettings:commit}=useSettings();const[enabled,setEnabled]=useState(false);return <button onClick={()=>setEnabled(previous=>{commit({enabled:!previous});return !previous})}>{String(enabled)}</button>};',
    },
    expectedWarnings: 1,
  },
  {
    name: "pure-context-and-provider-barrels",
    files: {
      ...baseProjectFiles,
      "src/actions.ts":
        'import{useContext}from"react";import{SettingsContext}from"./contexts";export const useSettings=()=>{const{updateSettings}=useContext(SettingsContext);return{updateSettings}};',
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider-barrel";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
      "src/contexts.ts": 'export{SettingsContext}from"./context";',
      "src/provider-barrel.ts": 'export{default}from"./provider";',
    },
    expectedWarnings: 1,
  },
  {
    name: "own-source-directory-alias",
    files: {
      ...baseProjectFiles,
      "src/panel.tsx":
        'import{useState}from"react";import{useSettings}from"@/actions";export const Panel=()=>{const{updateSettings}=useSettings();const[enabled,setEnabled]=useState(false);return <button onClick={()=>setEnabled(previous=>{updateSettings({enabled:!previous});return !previous})}>{String(enabled)}</button>};',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 1,
  },
  {
    name: "ordinary-declared-theme-owner",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";import{ThemeProvider}from"@mui/material";const root=createRoot(document.getElementById("root"));root.render(<ThemeProvider theme={{}}><SettingsProvider><Panel/></SettingsProvider></ThemeProvider>);',
    },
    expectedWarnings: 1,
  },
  {
    name: "disconnected-missing-runtime-import",
    files: {
      ...baseProjectFiles,
      "src/disconnected.ts": 'import{missing}from"./not-present";export const value=missing;',
    },
    expectedWarnings: 1,
  },
  {
    name: "provider-local-element-replacement",
    files: {
      ...baseProjectFiles,
      "src/provider.tsx":
        'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{const[value,updateSettings]=useState({enabled:false});const element=<SettingsContext.Provider value={{value,updateSettings}}>{children}</SettingsContext.Provider>;element.props.value.updateSettings=()=>{};return element;};export default SettingsProvider;',
    },
    expectedWarnings: 0,
  },
  {
    name: "direct-provider-call-returned-element-replacement",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));const element=SettingsProvider({children:<Panel/>});element.props.value.updateSettings=()=>{};root.render(element);',
    },
    expectedWarnings: 0,
  },
  {
    name: "own-jsx-wrapper-type-props-transform",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const Rewrite=({children})=>{const element=children.type(children.props);element.props.value.updateSettings=()=>{};return children};const root=createRoot(document.getElementById("root"));root.render(<Rewrite><SettingsProvider><Panel/></SettingsProvider></Rewrite>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "wrapper-inherited-projection-poison",
    files: {
      ...baseProjectFiles,
      "src/panel.tsx":
        'Object.defineProperty(Object.prototype,"inspect",{get(){this.updateSettings=()=>{};return 0},configurable:true});import{useState}from"react";import{useSettings}from"./actions";export const Panel=()=>{const{inspect,updateSettings}=useSettings();const[enabled,setEnabled]=useState(false);return <button onClick={()=>setEnabled(previous=>{updateSettings({enabled:!previous});return !previous})}>{String(enabled)}</button>};',
    },
    expectedWarnings: 0,
  },
  {
    name: "context-inherited-projection-poison",
    files: {
      ...baseProjectFiles,
      "src/actions.ts":
        'Object.defineProperty(Object.prototype,"inspect",{get(){this.updateSettings=()=>{};return 0},configurable:true});import{useContext}from"react";import{SettingsContext}from"./context";export const useSettings=()=>{const{inspect,updateSettings}=useContext(SettingsContext);return{updateSettings}};',
    },
    expectedWarnings: 0,
  },
  {
    name: "wrapper-unowned-projection-without-visible-poison",
    files: {
      ...baseProjectFiles,
      "src/panel.tsx":
        'import{useState}from"react";import{useSettings}from"./actions";export const Panel=()=>{const{inspect,updateSettings}=useSettings();const[enabled,setEnabled]=useState(false);return <button onClick={()=>setEnabled(previous=>{updateSettings({enabled:!previous});return !previous})}>{String(enabled)}</button>};',
    },
    expectedWarnings: 0,
  },
  {
    name: "other-reached-context-consumer-unowned-key",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";import{Observer}from"./observer";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/><Observer/></SettingsProvider>);',
      "src/observer.tsx":
        'import{useContext}from"react";import{SettingsContext}from"./context";export const Observer=()=>{const{inspect}=useContext(SettingsContext);return <span>{inspect}</span>};',
    },
    expectedWarnings: 0,
  },
  {
    name: "all-projected-keys-are-own",
    files: {
      ...baseProjectFiles,
      "src/actions.ts":
        'import{useContext}from"react";import{SettingsContext}from"./context";export const useSettings=()=>{const{updateSettings}=useContext(SettingsContext);return{inspect:0,updateSettings}};',
      "src/panel.tsx":
        'import{useState}from"react";import{useSettings}from"./actions";export const Panel=()=>{const{inspect,updateSettings}=useSettings();const[enabled,setEnabled]=useState(false);return <button onClick={()=>setEnabled(previous=>{updateSettings({enabled:!previous});return !previous})}>{String(enabled)}</button>};',
    },
    expectedWarnings: 1,
  },
  {
    name: "prototype-setter-provider-literal",
    files: {
      ...baseProjectFiles,
      "src/provider.tsx":
        'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{const[value,updateSettings]=useState({enabled:false});return <SettingsContext.Provider value={{__proto__:{},value,updateSettings}}>{children}</SettingsContext.Provider>};export default SettingsProvider;',
    },
    expectedWarnings: 0,
  },
  {
    name: "prototype-setter-wrapper-literal",
    files: {
      ...baseProjectFiles,
      "src/actions.ts":
        'import{useContext}from"react";import{SettingsContext}from"./context";export const useSettings=()=>{const{updateSettings}=useContext(SettingsContext);return{__proto__:{},updateSettings}};',
    },
    expectedWarnings: 0,
  },
  {
    name: "duplicate-provider-value",
    files: {
      ...baseProjectFiles,
      "src/provider.tsx":
        'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{const[value,updateSettings]=useState({enabled:false});return <SettingsContext.Provider value={{value,updateSettings}} value={{updateSettings:()=>{}}}>{children}</SettingsContext.Provider>};export default SettingsProvider;',
    },
    expectedWarnings: 0,
  },
  {
    name: "provider-spread-attributes",
    files: {
      ...baseProjectFiles,
      "src/provider.tsx":
        'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{const[value,updateSettings]=useState({enabled:false});return <SettingsContext.Provider {...{value:{updateSettings:()=>{}}}} value={{value,updateSettings}}>{children}</SettingsContext.Provider>};export default SettingsProvider;',
    },
    expectedWarnings: 0,
  },
  {
    name: "provider-ref-transport",
    files: {
      ...baseProjectFiles,
      "src/provider.tsx":
        'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{const[value,updateSettings]=useState({enabled:false});return <SettingsContext.Provider ref={capture} value={{value,updateSettings}}>{children}</SettingsContext.Provider>};export default SettingsProvider;',
    },
    expectedWarnings: 0,
  },
  {
    name: "provider-namespace-direct-call",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import*as bindings from"./provider";import{Panel}from"./panel";const element=bindings.default({children:<Panel/>});const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "provider-owner-value-escape",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";unknownTransport(SettingsProvider);const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "provider-transformed-return",
    files: {
      ...baseProjectFiles,
      "src/provider.tsx":
        'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{const[value,updateSettings]=useState({enabled:false});return transform(<SettingsContext.Provider value={{value,updateSettings}}>{children}</SettingsContext.Provider>)};export default SettingsProvider;',
    },
    expectedWarnings: 0,
  },
  {
    name: "unknown-external-owner",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";import Wrapper from"unknown-ui";const root=createRoot(document.getElementById("root"));root.render(<Wrapper><SettingsProvider><Panel/></SettingsProvider></Wrapper>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "missing-canonical-alias-react",
    files: {
      ...baseProjectFiles,
      "tsconfig.json":
        '{"compilerOptions": {"baseUrl": ".", "paths": {"react": ["./missing-provider"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "missing-canonical-alias-react-dom-client",
    files: {
      ...baseProjectFiles,
      "tsconfig.json":
        '{"compilerOptions": {"baseUrl": ".", "paths": {"react-dom/client": ["./missing-provider"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "missing-canonical-alias-mui-material",
    files: {
      ...baseProjectFiles,
      "tsconfig.json":
        '{"compilerOptions": {"baseUrl": ".", "paths": {"@mui/material": ["./missing-provider"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "reachable-missing-runtime-import",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import"./not-present";import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "literal-lazy-own-side-effect",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'const load=()=>import("./poison");import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
      "src/poison.ts": 'import React from"react";React.useState=()=>[0,()=>{}];',
    },
    expectedWarnings: 0,
  },
  {
    name: "opaque-lazy-entry",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'const load=(source)=>import(source);import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "node-loader-source",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import"node:vm";import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "worker-loader",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'new Worker("./worker.js");import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "import-meta-glob",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'const files=import.meta.glob("./*.tsx");import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "current-source-jsx-pragma",
    files: {
      ...baseProjectFiles,
      "src/panel.tsx":
        '/** @jsxImportSource alternate */\nimport{useState}from"react";import{useSettings}from"./actions";export const Panel=()=>{const{updateSettings}=useSettings();const[enabled,setEnabled]=useState(false);return <button onClick={()=>setEnabled(previous=>{updateSettings({enabled:!previous});return !previous})}>{String(enabled)}</button>};',
    },
    expectedWarnings: 0,
  },
  {
    name: "inline-html-loader",
    files: {
      ...baseProjectFiles,
      "index.html": '<script>import("/src/entry.tsx")</script>',
    },
    expectedWarnings: 0,
  },
  {
    name: "react-dom-provider-write",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import ReactDOM from"react-dom/client";ReactDOM.createRoot=()=>({render(){}});import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "selected-setter-not-native",
    files: {
      ...baseProjectFiles,
      "src/provider.tsx":
        'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{const[value]=useState({enabled:false});const updateSettings=()=>{};return <SettingsContext.Provider value={{value,updateSettings}}>{children}</SettingsContext.Provider>};export default SettingsProvider;',
    },
    expectedWarnings: 0,
  },
  {
    name: "selected-setter-binding-write",
    files: {
      ...baseProjectFiles,
      "src/provider.tsx":
        'import{useState}from"react";import{SettingsContext}from"./context";const SettingsProvider=({children})=>{let[value,updateSettings]=useState({enabled:false});updateSettings=()=>{};return <SettingsContext.Provider value={{value,updateSettings}}>{children}</SettingsContext.Provider>};export default SettingsProvider;',
    },
    expectedWarnings: 0,
  },
  {
    name: "outer-api-not-expanded",
    files: {
      ...baseProjectFiles,
      "src/panel.tsx":
        'import{useState}from"react";import{useSettings}from"./actions";export const Panel=()=>{const{updateSettings}=useSettings();const[enabled,setEnabled]=useState(false);return <button onClick={()=>unknownSetter(previous=>{updateSettings({enabled:!previous});return !previous})}>{String(enabled)}</button>};',
    },
    expectedWarnings: 0,
  },
  {
    name: "stored-owner-jsx-value-escape",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));const element=<SettingsProvider><Panel/></SettingsProvider>;inspect(element);root.render(element);',
    },
    expectedWarnings: 0,
  },
  {
    name: "owner-jsx-render-prop-escape",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<Unknown render={()=> <SettingsProvider><Panel/></SettingsProvider>}/>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "literal-vite-alias-agrees-with-typescript",
    files: {
      ...baseProjectFiles,
      "package.json":
        '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0", "vite": "4.2.2", "@vitejs/plugin-react": "3.1.0", "vite-tsconfig-paths": "4.2.0", "vite-plugin-svgr": "2.4.0", "vite-plugin-pwa": "0.14.7"}, "scripts": {"dev": "vite", "build": "vite build", "preview": "vite preview"}}',
      "vite.config.ts":
        'import react from"@vitejs/plugin-react";import path from"path";import{defineConfig}from"vite";import{VitePWA}from"vite-plugin-pwa";import svgr from"vite-plugin-svgr";import paths from"vite-tsconfig-paths";export default defineConfig({base:"",resolve:{alias:{"@":path.resolve(__dirname,"./src")}},plugins:[react(),paths(),svgr(),VitePWA({manifest:{name:"Example",icons:[{src:"/icon.png",sizes:"128x128",type:"image/png"}]}})]});',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 1,
  },
  {
    name: "vite-own-alias-disagrees-with-typescript",
    files: {
      ...baseProjectFiles,
      "package.json":
        '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0", "vite": "4.2.2", "@vitejs/plugin-react": "3.1.0", "vite-tsconfig-paths": "4.2.0", "vite-plugin-svgr": "2.4.0", "vite-plugin-pwa": "0.14.7"}, "scripts": {"dev": "vite", "build": "vite build", "preview": "vite preview"}}',
      "vite.config.ts":
        'import react from"@vitejs/plugin-react";import path from"path";import{defineConfig}from"vite";import{VitePWA}from"vite-plugin-pwa";import svgr from"vite-plugin-svgr";import paths from"vite-tsconfig-paths";export default defineConfig({base:"",resolve:{alias:{"@":path.resolve(__dirname,"./shim")}},plugins:[react(),paths(),svgr(),VitePWA({manifest:{name:"Example",icons:[{src:"/icon.png",sizes:"128x128",type:"image/png"}]}})]});',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "vite-missing-canonical-alias-react",
    files: {
      ...baseProjectFiles,
      "package.json":
        '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0", "vite": "4.2.2", "@vitejs/plugin-react": "3.1.0", "vite-tsconfig-paths": "4.2.0", "vite-plugin-svgr": "2.4.0", "vite-plugin-pwa": "0.14.7"}, "scripts": {"dev": "vite", "build": "vite build", "preview": "vite preview"}}',
      "vite.config.ts":
        'import react from"@vitejs/plugin-react";import path from"path";import{defineConfig}from"vite";import{VitePWA}from"vite-plugin-pwa";import svgr from"vite-plugin-svgr";import paths from"vite-tsconfig-paths";export default defineConfig({base:"",resolve:{alias:{"react":"./missing"}},plugins:[react(),paths(),svgr(),VitePWA({manifest:{name:"Example",icons:[{src:"/icon.png",sizes:"128x128",type:"image/png"}]}})]});',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "vite-missing-canonical-alias-react-dom-client",
    files: {
      ...baseProjectFiles,
      "package.json":
        '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0", "vite": "4.2.2", "@vitejs/plugin-react": "3.1.0", "vite-tsconfig-paths": "4.2.0", "vite-plugin-svgr": "2.4.0", "vite-plugin-pwa": "0.14.7"}, "scripts": {"dev": "vite", "build": "vite build", "preview": "vite preview"}}',
      "vite.config.ts":
        'import react from"@vitejs/plugin-react";import path from"path";import{defineConfig}from"vite";import{VitePWA}from"vite-plugin-pwa";import svgr from"vite-plugin-svgr";import paths from"vite-tsconfig-paths";export default defineConfig({base:"",resolve:{alias:{"react-dom/client":"./missing"}},plugins:[react(),paths(),svgr(),VitePWA({manifest:{name:"Example",icons:[{src:"/icon.png",sizes:"128x128",type:"image/png"}]}})]});',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "vite-missing-canonical-alias-mui-material",
    files: {
      ...baseProjectFiles,
      "package.json":
        '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0", "vite": "4.2.2", "@vitejs/plugin-react": "3.1.0", "vite-tsconfig-paths": "4.2.0", "vite-plugin-svgr": "2.4.0", "vite-plugin-pwa": "0.14.7"}, "scripts": {"dev": "vite", "build": "vite build", "preview": "vite preview"}}',
      "vite.config.ts":
        'import react from"@vitejs/plugin-react";import path from"path";import{defineConfig}from"vite";import{VitePWA}from"vite-plugin-pwa";import svgr from"vite-plugin-svgr";import paths from"vite-tsconfig-paths";export default defineConfig({base:"",resolve:{alias:{"@mui/material":"./missing"}},plugins:[react(),paths(),svgr(),VitePWA({manifest:{name:"Example",icons:[{src:"/icon.png",sizes:"128x128",type:"image/png"}]}})]});',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "vite-dynamic-factory",
    files: {
      ...baseProjectFiles,
      "package.json":
        '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0", "vite": "4.2.2", "@vitejs/plugin-react": "3.1.0", "vite-tsconfig-paths": "4.2.0", "vite-plugin-svgr": "2.4.0", "vite-plugin-pwa": "0.14.7"}, "scripts": {"dev": "vite", "build": "vite build", "preview": "vite preview"}}',
      "vite.config.ts":
        'import react from"@vitejs/plugin-react";import path from"path";import{defineConfig}from"vite";import{VitePWA}from"vite-plugin-pwa";import svgr from"vite-plugin-svgr";import paths from"vite-tsconfig-paths";export default defineConfig(()=>({base:"",resolve:{alias:{"@":path.resolve(__dirname,"./src")}},plugins:[react(),paths(),svgr(),VitePWA({manifest:{name:"Example",icons:[{src:"/icon.png",sizes:"128x128",type:"image/png"}]}})]}));',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "vite-custom-cli-config",
    files: {
      ...baseProjectFiles,
      "package.json":
        '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0", "vite": "4.2.2", "@vitejs/plugin-react": "3.1.0", "vite-tsconfig-paths": "4.2.0", "vite-plugin-svgr": "2.4.0", "vite-plugin-pwa": "0.14.7"}, "scripts": {"build": "vite build --config custom.ts"}}',
      "vite.config.ts":
        'import react from"@vitejs/plugin-react";import path from"path";import{defineConfig}from"vite";import{VitePWA}from"vite-plugin-pwa";import svgr from"vite-plugin-svgr";import paths from"vite-tsconfig-paths";export default defineConfig({base:"",resolve:{alias:{"@":path.resolve(__dirname,"./src")}},plugins:[react(),paths(),svgr(),VitePWA({manifest:{name:"Example",icons:[{src:"/icon.png",sizes:"128x128",type:"image/png"}]}})]});',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "vite-unknown-plugin",
    files: {
      ...baseProjectFiles,
      "package.json":
        '{"private": true, "type": "module", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "@mui/material": "5.15.0", "vite": "4.2.2", "@vitejs/plugin-react": "3.1.0", "vite-tsconfig-paths": "4.2.0", "vite-plugin-svgr": "2.4.0", "vite-plugin-pwa": "0.14.7"}, "scripts": {"dev": "vite", "build": "vite build", "preview": "vite preview"}}',
      "vite.config.ts":
        'import react from"unknown-transformer";import path from"path";import{defineConfig}from"vite";import{VitePWA}from"vite-plugin-pwa";import svgr from"vite-plugin-svgr";import paths from"vite-tsconfig-paths";export default defineConfig({base:"",resolve:{alias:{"@":path.resolve(__dirname,"./src")}},plugins:[react(),paths(),svgr(),VitePWA({manifest:{name:"Example",icons:[{src:"/icon.png",sizes:"128x128",type:"image/png"}]}})]});',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}',
    },
    expectedWarnings: 0,
  },
  {
    name: "dom-script-loader",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'const script=document.createElement("script");script.src="/another.js";document.body.appendChild(script);import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "literal-string-timer-loader",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'setTimeout("import(\\"/another.js\\")",0);import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const root=createRoot(document.getElementById("root"));root.render(<SettingsProvider><Panel/></SettingsProvider>);',
    },
    expectedWarnings: 0,
  },
  {
    name: "custom-build-script-can-change-vite-resolution",
    files: {
      ...baseProjectFiles,
      "package.json": JSON.stringify({
        private: true,
        type: "module",
        dependencies: { react: "18.2.0", "react-dom": "18.2.0", vite: "4.2.2" },
        scripts: { build: "node ./tooling/build.mjs" },
      }),
      "tooling/build.mjs":
        'import {build} from "vite";build({resolve:{alias:{react:"./custom-react"}}});',
    },
    expectedWarnings: 0,
  },
  {
    name: "custom-prebuild-script-can-change-vite-resolution",
    files: {
      ...baseProjectFiles,
      "package.json": JSON.stringify({
        private: true,
        type: "module",
        dependencies: { react: "18.2.0", "react-dom": "18.2.0", vite: "4.2.2" },
        scripts: { prebuild: "node ./tooling/configure.mjs", build: "vite build" },
      }),
      "tooling/configure.mjs":
        'import {writeFileSync} from "node:fs";writeFileSync("vite.config.ts", "export default " + JSON.stringify({resolve:{alias:{react:"./custom-react"}}}));',
    },
    expectedWarnings: 0,
  },
  {
    name: "parenthesized-native-owner-return",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const Shell=({children})=>{return (<main>{children}</main>)};const root=createRoot(document.getElementById("root"));root.render(<Shell><SettingsProvider><Panel/></SettingsProvider></Shell>);',
    },
    expectedWarnings: 1,
  },
  {
    name: "parenthesized-theme-owner-return",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";import{ThemeProvider}from"@mui/material";const Shell=({children})=>{return (<ThemeProvider theme={{}}>{children}</ThemeProvider>)};const root=createRoot(document.getElementById("root"));root.render(<Shell><SettingsProvider><Panel/></SettingsProvider></Shell>);',
    },
    expectedWarnings: 1,
  },
  {
    name: "parenthesized-transformed-owner-return",
    files: {
      ...baseProjectFiles,
      "src/entry.tsx":
        'import{createRoot}from"react-dom/client";import SettingsProvider from"./provider";import{Panel}from"./panel";const Shell=({children})=>{return (reshape(<main>{children}</main>))};const root=createRoot(document.getElementById("root"));root.render(<Shell><SettingsProvider><Panel/></SettingsProvider></Shell>);',
    },
    expectedWarnings: 0,
  },
];

let directory = "";

const writeFile = (relativePath: string, source: string): string => {
  const filename = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};

const writeProject = (files: Readonly<Record<string, string>>): void => {
  for (const [relativePath, source] of Object.entries(files)) writeFile(relativePath, source);
};

const runSelected = () => {
  const filename = path.join(directory, "src/panel.tsx");
  return runRule(noSideEffectInStateUpdaterFunction, fs.readFileSync(filename, "utf8"), {
    filename,
    settings: { "react-doctor": { rootDirectory: directory } },
  });
};

const collectSelected = () => {
  const filename = path.join(directory, "src/panel.tsx");
  return collectCrossFileDependencyProbes({
    absoluteFilePath: filename,
    sourceText: fs.readFileSync(filename, "utf8"),
    ruleIds: ["no-side-effect-in-state-updater-function"],
  });
};

const expectUnfingerprintableOutcome = (expectedWarnings: number): void => {
  resetFilesystemCaches();
  expect(collectSelected()).toBeNull();
  const warmResult = runSelected();
  expect(warmResult.parseErrors).toEqual([]);
  expect(warmResult.diagnostics).toHaveLength(expectedWarnings);
  expect(runSelected()).toEqual(warmResult);
  expect(collectSelected()).toBeNull();
  resetFilesystemCaches();
  expect(runSelected()).toEqual(warmResult);
  expect(collectSelected()).toBeNull();
};

beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "rd-context-setter-")));
  resetFilesystemCaches();
});

afterEach(() => {
  resetFilesystemCaches();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("native setters projected through local context providers", () => {
  it.each(cases)("$name", ({ files, expectedWarnings }) => {
    writeProject(files);
    const result = runSelected();
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedWarnings);
  });
});

describe("context setter dependency-cache contract", () => {
  it("rechecks a changed Provider return with unchanged selected source", () => {
    writeProject(baseProjectFiles);
    const selectedSource = fs.readFileSync(path.join(directory, "src/panel.tsx"), "utf8");
    const providerSource = fs.readFileSync(path.join(directory, "src/provider.tsx"), "utf8");
    expectUnfingerprintableOutcome(1);
    writeFile(
      "src/provider.tsx",
      providerSource.replace(
        "value={{value,updateSettings}}",
        "value={{value,updateSettings:()=>{}}}",
      ),
    );
    expectUnfingerprintableOutcome(0);
    writeFile("src/provider.tsx", providerSource);
    expectUnfingerprintableOutcome(1);
    expect(fs.readFileSync(path.join(directory, "src/panel.tsx"), "utf8")).toBe(selectedSource);
  });

  it("rechecks an entry edge connecting a previously disconnected missing module", () => {
    writeProject(baseProjectFiles);
    writeFile("src/extra.ts", "import './missing';");
    expectUnfingerprintableOutcome(1);
    writeFile("src/entry.tsx", "import './extra';" + baseProjectFiles["src/entry.tsx"]);
    expectUnfingerprintableOutcome(0);
    writeFile("src/entry.tsx", baseProjectFiles["src/entry.tsx"]);
    expectUnfingerprintableOutcome(1);
  });

  it("rechecks canonical alias declaration before and after missing target creation", () => {
    writeProject(baseProjectFiles);
    expectUnfingerprintableOutcome(1);
    const configuration = writeFile(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "react-dom/client": ["./custom-runtime"] } },
      }),
    );
    expectUnfingerprintableOutcome(0);
    const provider = writeFile("custom-runtime.ts", "export const createRoot = alternate;");
    expectUnfingerprintableOutcome(0);
    fs.unlinkSync(provider);
    expectUnfingerprintableOutcome(0);
    fs.unlinkSync(configuration);
    expectUnfingerprintableOutcome(1);
  });

  it("rechecks all Context extraction keys in a newly reached module", () => {
    writeProject(baseProjectFiles);
    expectUnfingerprintableOutcome(1);
    const observer = writeFile(
      "src/observer.ts",
      "import{useContext}from'react';import{SettingsContext}from'./context';export const useObserver=()=>{const{missing}=useContext(SettingsContext);return missing};",
    );
    writeFile("src/entry.tsx", "import './observer';" + baseProjectFiles["src/entry.tsx"]);
    expectUnfingerprintableOutcome(0);
    fs.unlinkSync(observer);
    writeFile("src/entry.tsx", baseProjectFiles["src/entry.tsx"]);
    expectUnfingerprintableOutcome(1);
  });

  it("keeps failed extraction shapes nonfingerprintable", () => {
    writeProject(baseProjectFiles);
    writeFile(
      "src/panel.tsx",
      baseProjectFiles["src/panel.tsx"].replace(
        "{updateSettings}=useSettings()",
        "{updateSettings=()=>{}}=useSettings()",
      ),
    );
    expect(collectSelected()).toBeNull();
    expect(runSelected().diagnostics).toHaveLength(0);
  });
  it("rechecks literal Vite aliases across equal-size equal-mtime content changes", () => {
    const fixture = cases.find(
      (candidate) => candidate.name === "literal-vite-alias-agrees-with-typescript",
    );
    if (!fixture) throw new Error("Missing Vite fixture");
    writeProject(fixture.files);
    const filename = path.join(directory, "vite.config.ts");
    const original = fs.readFileSync(filename, "utf8");
    const metadata = fs.statSync(filename);
    expectUnfingerprintableOutcome(1);
    const changed = original.replace("./src", "./bad");
    expect(changed.length).toBe(original.length);
    fs.writeFileSync(filename, changed);
    fs.utimesSync(filename, metadata.atime, metadata.mtime);
    expectUnfingerprintableOutcome(0);
    fs.writeFileSync(filename, original);
    fs.utimesSync(filename, metadata.atime, metadata.mtime);
    expectUnfingerprintableOutcome(1);
  });
});
