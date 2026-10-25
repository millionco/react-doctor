import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { noSmoothScrollWithoutReducedMotion } from "./no-smooth-scroll-without-reduced-motion.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";

interface NativeWindowScrollCase {
  readonly name: string;
  readonly source: string;
  readonly expected: number;
  readonly files: Readonly<Record<string, string>>;
}

const cases: readonly NativeWindowScrollCase[] = [
  {
    name: "local synchronous block handler",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "inline synchronous handler",
    source: 'const Panel=()=> <button onClick={()=>window.scrollTo({top:0,behavior:"smooth"})}/>;',
    expected: 1,
    files: {},
  },
  {
    name: "local expression handler",
    source:
      'const Panel=()=>{const move=()=>window.scrollTo({top:0,behavior:"smooth"});return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "sole returned call",
    source:
      'const Panel=()=>{const move=()=>{return window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "finite signed coordinates",
    source:
      'const Panel=()=>{const move=()=>window.scrollTo({left:-12,top:+3,behavior:"smooth"});return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "unrelated mapping and passive Next configuration",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 1,
    files: {
      "jsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}}}',
      "next.config.js":
        'const paths=require("node:path");module.exports={sassOptions:{includePaths:[paths.join(__dirname,"styles")]},images:{remotePatterns:[{protocol:"https",hostname:"assets.example",pathname:"**"}]}};',
    },
  },
  {
    name: "dynamic visibility does not gate click",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button className={visible?"shown":"hidden"} onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "instant behavior",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"instant"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "auto behavior",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"auto"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "preference-dependent options",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "preference if guard",
    source:
      'const Panel=()=>{const move=()=>{if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches) window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "conditional callback",
    source:
      'const Panel=()=>{const move=()=>{active&&window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "unknown prior call",
    source:
      'const Panel=()=>{const move=()=>{prepare();window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "dead callback",
    source:
      'const Panel=()=>{const move=()=>{return;window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "awaited callback",
    source:
      'const Panel=()=>{const move=async ()=>{await ready;window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "try callback",
    source:
      'const Panel=()=>{const move=()=>{try{window.scrollTo({top:0,behavior:"smooth"})}finally{};};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "unknown coordinate",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:offset,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "computed behavior",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({["behavior"]:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "spread options",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({...options,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "getter options",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({get behavior(){return "smooth"}});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "duplicate behavior",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({behavior:"instant",behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "positional arguments",
    source:
      "const Panel=()=>{const move=()=>{window.scrollTo(0,0);};return <button onClick={move}/>;};",
    expected: 0,
    files: {},
  },
  {
    name: "computed native method",
    source:
      'const Panel=()=>{const move=()=>{window["scrollTo"]({behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "optional native method",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo?.({behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "element receiver",
    source:
      'const Panel=()=>{const move=()=>{element.scrollTo({behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "globalThis receiver",
    source:
      'const Panel=()=>{const move=()=>{globalThis.scrollTo({behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "custom host",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <Action onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "spread button",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button {...props} onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "ref owner",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button ref={control} onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "inactive button",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button disabled onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "custom ancestor",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <Wrapper><button onClick={move}/></Wrapper>;};',
    expected: 0,
    files: {},
  },
  {
    name: "saved JSX",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};const element=<button onClick={move}/>;return element;};',
    expected: 0,
    files: {},
  },
  {
    name: "conditional return",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return visible?<button onClick={move}/>:null;};',
    expected: 0,
    files: {},
  },
  {
    name: "native ancestor",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <div><button onClick={move}/></div>;};',
    expected: 0,
    files: {},
  },
  {
    name: "capture callback",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move} onClickCapture={capture}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "shadowed window",
    source:
      'const window={scrollTo(){}};const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "native method replacement",
    source:
      'window.scrollTo=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "computed native replacement",
    source:
      'window[key]=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "window alias escape",
    source:
      'const browser=window;browser.scrollTo=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "reflection replacement",
    source:
      'Object.defineProperty(window,"scrollTo",{value:custom});const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "global alias reflection",
    source:
      'globalThis.Object.defineProperty(globalThis.window,"scrollTo",{value:custom});const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "method value escape",
    source:
      'consume(window.scrollTo);const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "default JSX provider shadow",
    source:
      'const React=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "handler value escape",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};consume(move);return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "handler reassignment",
    source:
      'const Panel=()=>{let move=()=>{window.scrollTo({top:0,behavior:"smooth"});};move=custom;return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "event parameter handler",
    source:
      'const Panel=()=>{const move=(event)=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "local renderer is not component",
    source:
      'const renderPanel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "source JSX pragma",
    source:
      '/** @jsx custom */\nconst Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "Babel JSON config",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "babel.config.json": "{}",
    },
  },
  {
    name: "Babel module config",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      ".babelrc.mjs": "export default {}",
    },
  },
  {
    name: "React path remap",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "jsconfig.json": '{"compilerOptions":{"paths":{"react":["./adapter"]}}}',
    },
  },
  {
    name: "custom JSX factory",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "jsconfig.json": '{"compilerOptions":{"jsxFactory":"custom"}}',
    },
  },
  {
    name: "base URL provider",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "jsconfig.json": '{"compilerOptions":{"baseUrl":"."}}',
    },
  },
  {
    name: "custom build command",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "package.json":
        '{"dependencies": {"react": "19.2.0", "next": "16.0.0"}, "scripts": {"build": "node build.mjs"}}',
    },
  },
  {
    name: "Next compiler hook",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "next.config.js": "module.exports={webpack(configuration){return configuration}};",
    },
  },
  {
    name: "erased window declaration",
    source:
      'declare const window: Window;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "erased reflection declaration",
    source:
      'declare const Reflect: unknown;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "opaque component factory",
    source:
      'const Panel=decorate(()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;});',
    expected: 0,
    files: {},
  },
  {
    name: "preference-gated earlier return",
    source:
      'const Panel=()=>{if(reduced)return null;const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "custom JSX import source",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "jsconfig.json": '{"compilerOptions":{"jsxImportSource":"custom"}}',
    },
  },
  {
    name: "extended compiler configuration",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "jsconfig.json": '{"extends":"./base.json"}',
      "base.json": "{}",
    },
  },
  {
    name: "package provider remapping",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "package.json":
        '{"dependencies":{"react":"19.2.0"},"overrides":{"react":"npm:custom@1.0.0"}}',
    },
  },
  {
    name: "package Babel compiler override",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "package.json": '{"dependencies":{"react":"19.2.0"},"babel":{}}',
    },
  },
  {
    name: "unknown compiler plugin",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "jsconfig.json": '{"compilerOptions":{"plugins":[{"name":"custom"}]}}',
    },
  },
  {
    name: "Window prototype replacement",
    source:
      'Window.prototype.scrollTo=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "window constructor replacement",
    source:
      'window.constructor.prototype.scrollTo=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "parent Window replacement",
    source:
      'window.parent.scrollTo=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "top Window replacement",
    source:
      'window.top.scrollTo=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "top Window handoff",
    source:
      'patch(window.top);const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "document defaultView replacement",
    source:
      'window.document.defaultView.scrollTo=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "global document defaultView replacement",
    source:
      'document.defaultView.scrollTo=custom;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "Window erased declaration",
    source:
      'declare const Window: unknown;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "listener capability handoff",
    source:
      'patch(window.addEventListener);const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "computed constructor capability",
    source:
      'const key="constructor";window.scrollTo[key]("return window")();const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "ordinary direct scroll observation and listener calls",
    source:
      'import {useEffect} from "react";const Panel=()=>{useEffect(()=>{const observe=()=>console.log(window.scrollY);window.addEventListener("scroll",observe,{passive:true});return()=>window.removeEventListener("scroll",observe,{passive:true});},[]);const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "parenthesized native Window",
    source:
      'const Panel=()=>{const move=()=>{(window).scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "asserted native Window",
    source:
      'const Panel=()=>{const move=()=>{(window as any).scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "nonnull native Window",
    source:
      'const Panel=()=>{const move=()=>{window!.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "transparent literal options and behavior",
    source:
      'const Panel=()=>{const move=()=>{window.scrollTo(({top:0,behavior:("smooth" as const)} satisfies ScrollToOptions));};return <button onClick={move}/>;};',
    expected: 1,
    files: {},
  },
  {
    name: "listener Window receiver replacement",
    source:
      'window.addEventListener("click",function(){this.scrollTo=custom;});const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "destructured Function constructor",
    source:
      'const {constructor:compile}=()=>{};compile("window.scrollTo=()=>{}")();const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "destructured dynamic capability",
    source:
      'const {[key]:compile}=()=>{};compile("window.scrollTo=()=>{}")();const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
  {
    name: "unresolved computed Function constructor acquisition",
    source:
      "const key=['constructor'][0];(()=>{})[key]('window.scrollTo=()=>{}')();const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:\"smooth\"});};return <button onClick={move}/>;};",
    expected: 0,
    files: {},
  },
  {
    name: "global classic JSX provider replacement",
    source:
      'React.createElement=()=>null;const Panel=()=>{const move=()=>{window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {
      "jsconfig.json": '{"compilerOptions":{"jsx":"react"}}',
    },
  },
  {
    name: "empty statement before parenthesized receiver",
    source:
      'export const ScrollPanel = () => {\n  const moveViewport = () => {\n    ;(window).scrollTo({ top: 0, behavior: "smooth" });\n  };\n  return <button onClick={moveViewport}>Back to start</button>;\n};\n',
    expected: 1,
    files: {},
  },
  {
    name: "empty statement before asserted receiver",
    source:
      'export const ScrollPanel = () => {\n  const moveViewport = () => {\n    ;(window as any).scrollTo({ top: 0, behavior: "smooth" });\n  };\n  return <button onClick={moveViewport}>Back to start</button>;\n};\n',
    expected: 1,
    files: {},
  },
  {
    name: "empty statement before nonnull receiver",
    source:
      'export const ScrollPanel = () => {\n  const moveViewport = () => {\n    ;(window!).scrollTo({ top: 0, behavior: "smooth" });\n  };\n  return <button onClick={moveViewport}>Back to start</button>;\n};\n',
    expected: 1,
    files: {},
  },
  {
    name: "literal void prologues in both functions",
    source:
      'export const ScrollPanel = () => { void 0;\n  const moveViewport = () => { void 0;\n    window.scrollTo({ top: 0, behavior: "smooth" });\n  };\n  return <button onClick={moveViewport}>Back to start</button>;\n};\n',
    expected: 1,
    files: {},
  },
  {
    name: "side effects inside void are not a no-op",
    source:
      'const Panel=()=>{const move=()=>{void prepare();window.scrollTo({top:0,behavior:"smooth"});};return <button onClick={move}/>;};',
    expected: 0,
    files: {},
  },
];

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-native-window-scroll-"));
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      dependencies: { react: "19.2.0", next: "16.0.0" },
      scripts: { dev: "next dev", build: "next build", start: "next start" },
    }),
  );
  resetManifestCaches();
  resetTsconfigAliasCaches();
  __clearParseSourceFileCacheForTests();
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe("native window scrolling from direct button handlers", () => {
  for (const fixture of cases)
    it(fixture.name, () => {
      for (const [filename, contents] of Object.entries(fixture.files))
        fs.writeFileSync(path.join(directory, filename), contents);
      const filename = path.join(directory, "app", "panel.tsx");
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, fixture.source);
      const result = runRule(noSmoothScrollWithoutReducedMotion, fixture.source, { filename });
      expect(result.parseErrors).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(fixture.expected);
    });
  it("declines a provider remap in an ancestor package outside the owning package", () => {
    const projectDirectory = path.join(directory, "project");
    fs.mkdirSync(path.join(projectDirectory, "app"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        dependencies: { react: "19.2.0", next: "16.0.0" },
        scripts: { build: "next build" },
      }),
    );
    const source = 'const Panel=()=> <button onClick={()=>window.scrollTo({behavior:"smooth"})}/>;';
    const filename = path.join(projectDirectory, "app", "panel.tsx");
    fs.writeFileSync(filename, source);
    const parsed = parseFixture(source, { filename });
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(1);
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ overrides: { react: "npm:custom@1.0.0" } }),
    );
    resetManifestCaches();
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(0);
  });
  it("refreshes manifest edits and newly closer packages at the production scan reset boundary", () => {
    const source = 'const Panel=()=> <button onClick={()=>window.scrollTo({behavior:"smooth"})}/>;';
    const filename = path.join(directory, "app", "panel.tsx");
    fs.mkdirSync(path.dirname(filename));
    fs.writeFileSync(filename, source);
    const parsed = parseFixture(source, { filename });
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(1);
    const nearestManifest = path.join(directory, "app", "package.json");
    fs.writeFileSync(
      nearestManifest,
      JSON.stringify({ dependencies: { react: "npm:custom@1.0.0" } }),
    );
    resetManifestCaches();
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(0);
    fs.unlinkSync(nearestManifest);
    resetManifestCaches();
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(1);
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { react: "19.2.0" }, browser: { react: "./replacement.js" } }),
    );
    resetManifestCaches();
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(0);
  });
  it("refuses a symbolic-link manifest provider", () => {
    const source = 'const Panel=()=> <button onClick={()=>window.scrollTo({behavior:"smooth"})}/>;';
    const filename = path.join(directory, "panel.tsx");
    fs.writeFileSync(filename, source);
    fs.renameSync(path.join(directory, "package.json"), path.join(directory, "declaration.json"));
    fs.symlinkSync("declaration.json", path.join(directory, "package.json"));
    resetManifestCaches();
    expect(
      runRule(noSmoothScrollWithoutReducedMotion, source, { filename }).diagnostics,
    ).toHaveLength(0);
  });
  it("rechecks missing, changed, and removed config with the same source AST", () => {
    const source = 'const Panel=()=> <button onClick={()=>window.scrollTo({behavior:"smooth"})}/>;';
    const filename = path.join(directory, "panel.tsx");
    fs.writeFileSync(filename, source);
    const parsed = parseFixture(source, { filename });
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(1);
    fs.writeFileSync(path.join(directory, ".babelrc"), "{}");
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(0);
    fs.unlinkSync(path.join(directory, ".babelrc"));
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(1);
    fs.writeFileSync(
      path.join(directory, "jsconfig.json"),
      '{"compilerOptions":{"jsxFactory":"custom"}}',
    );
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(0);
    fs.unlinkSync(path.join(directory, "jsconfig.json"));
    expect(
      runRuleOnParsedFixture(noSmoothScrollWithoutReducedMotion, source, parsed, { filename })
        .diagnostics,
    ).toHaveLength(1);
  });
});
