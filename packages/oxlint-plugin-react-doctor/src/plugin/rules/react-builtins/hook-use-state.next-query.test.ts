import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNextQueryStateCall } from "../../utils/is-next-query-state-call.js";
import { isReactFunctionCall } from "../../utils/is-react-function-call.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { hookUseState } from "./hook-use-state.js";

interface QueryCase {
  readonly name: string;
  readonly source?: string;
  readonly files?: Readonly<Record<string, string>>;
}

const panel = `"use client";
import {useState} from "react";
export const QueryPanel=({query})=>{
  const [params]=useState(()=>{
    const result=new URLSearchParams();
    for(const key in query){result.set(key,query[key]??"");}
    return result;
  });
  return <span>{params.toString()}</span>;
};`;

const page = `import {QueryPanel} from "./query-panel";
export default async function Page({searchParams:input}){
  const query=await input;
  return <QueryPanel query={query}/>;
}`;

let directory: string;
let projectDirectory: string;
let filename: string;

const writeFixture = (name: string, source: string): void => {
  const target = path.join(directory, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
};

const queryCertificateRule = defineRule({
  ...hookUseState,
  create: (context) => ({
    CallExpression: (node: EsTreeNode) => {
      if (isReactFunctionCall(node, "useState") && !isNextQueryStateCall(node, context)) {
        context.report({ node, message: "The query snapshot certificate does not apply." });
      }
    },
  }),
});

const diagnose = (source = panel, files: Readonly<Record<string, string>> = {}) => {
  writeFixture("project/app/[item]/query-panel.tsx", source);
  for (const [name, value] of Object.entries(files)) writeFixture(name, value);
  resetFilesystemCaches();
  const result = runRule(queryCertificateRule, source, {
    filename,
    includeLocations: true,
    settings: { "react-doctor": { rootDirectory: projectDirectory } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "next-query-state-")));
  projectDirectory = path.join(directory, "project");
  filename = path.join(projectDirectory, "app/[item]/query-panel.tsx");
  writeFixture(
    "project/package.json",
    JSON.stringify({
      private: true,
      dependencies: {
        next: "16.0.10",
        react: "^19.2.3",
        "react-dom": "^19.2.3",
      },
    }),
  );
  writeFixture("project/next.config.ts", "const config={};export default config;");
  writeFixture("project/app/[item]/page.tsx", page);
  resetFilesystemCaches();
});

afterEach(() => {
  resetFilesystemCaches();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("Next query state certificate", () => {
  it("allows an omitted setter without requiring the query certificate", () => {
    const result = runRule(hookUseState, panel, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("allows a complete native query snapshot from an unchanged page input", () => {
    expect(diagnose()).toEqual([]);
  });

  it("uses the framework role when the query type includes native string arrays", () => {
    expect(
      diagnose(
        panel.replace("({query})", "({query}:{query:Record<string,string|string[]|undefined>})"),
      ),
    ).toEqual([]);
  });

  it("keeps React provider reexports erased when they are type-only", () => {
    expect(
      diagnose(panel, { "project/app/types.ts": 'export type {ReactNode} from "react";' }),
    ).toEqual([]);
  });

  it("excludes a separate scalar snapshot from the query certificate", () => {
    const source = panel
      .replace("({query})", "({query,item})")
      .replace(
        "  const [params]",
        "  const [initialItem]=useState(()=>decodeURIComponent(item));\n  const [params]",
      )
      .replace("{params.toString()}", "{initialItem}:{params.toString()}");
    const routePage = page
      .replace("({searchParams:input})", "({params,searchParams:input})")
      .replace("  const query=", "  const {item}=await params;\n  const query=")
      .replace("query={query}", "item={item} query={query}");
    const diagnostics = diagnose(source, { "project/app/[item]/page.tsx": routePage });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(4);
  });

  it.each<QueryCase>([
    {
      name: "ordinary typed props without an authoritative page",
      files: {
        "project/app/[item]/page.tsx": page.replace(
          "export default async function Page",
          "export const Parent=async function",
        ),
      },
    },
    {
      name: "own getter input",
      files: {
        "project/app/[item]/page.tsx":
          'import {QueryPanel} from "./query-panel";export default function Page(){const query={get term(){throw Error("custom")}};return <QueryPanel query={query}/>;}',
      },
    },
    {
      name: "a query input escape",
      files: {
        "project/app/[item]/page.tsx": page.replace(
          "const query=await input;",
          "alter(input);const query=await input;",
        ),
      },
    },
    {
      name: "an overridden query attribute",
      files: {
        "project/app/[item]/page.tsx": page.replace("query={query}", "query={query} {...other}"),
      },
    },
    {
      name: "a second own caller",
      files: {
        "project/app/other.tsx":
          'import {QueryPanel} from "./[item]/query-panel";export const Other=()=> <QueryPanel query={custom()}/>;',
      },
    },
    {
      name: "an explicitly imported testlike caller",
      files: {
        "project/app/entry.ts": 'import "./other.test";',
        "project/app/other.test.tsx":
          'import {QueryPanel} from "./[item]/query-panel";export const Other=()=> <QueryPanel query={custom()}/>;',
      },
    },
    {
      name: "an unresolved own runtime edge",
      files: { "project/app/entry.ts": 'import "./missing";' },
    },
    {
      name: "an unindexed dynamic module",
      files: { "project/app/entry.ts": 'const load=()=>import("./missing");' },
    },
    {
      name: "Array join replacement",
      files: { "project/app/alter.ts": 'Array.prototype.join=()=>"changed";' },
    },
    {
      name: "Array toString escape",
      files: {
        "project/app/alter.ts": 'const prototype=Array.prototype;prototype.toString=()=>"changed";',
      },
    },
    {
      name: "bare query constructor reassignment",
      files: { "project/app/alter.ts": "URLSearchParams=custom;" },
    },
    {
      name: "global query constructor replacement",
      files: { "project/app/alter.ts": "globalThis.URLSearchParams=custom;" },
    },
    {
      name: "document Window constructor replacement",
      files: { "project/app/alter.ts": "document.defaultView.URLSearchParams=custom;" },
    },
    {
      name: "frame Window constructor replacement",
      files: { "project/app/alter.ts": "frame.contentWindow.URLSearchParams=custom;" },
    },
    {
      name: "computed Window loader",
      files: { "project/app/alter.ts": 'document.defaultView["Function"]("return custom")();' },
    },
    {
      name: "query set replacement",
      files: { "project/app/alter.ts": "URLSearchParams.prototype.set=custom;" },
    },
    {
      name: "query constructor escape",
      files: { "project/app/alter.ts": 'import {alter} from "vendor";alter(URLSearchParams);' },
    },
    {
      name: "query instance escape",
      source: panel.replace("for(const key", "consume(result);for(const key"),
    },
    {
      name: "a different query key",
      source: panel.replace('query[key]??""', 'query[otherKey]??""'),
    },
    { name: "a different query record", source: panel.replace('query[key]??""', 'other[key]??""') },
    { name: "a callable query value", source: panel.replace('query[key]??""', "query[key]()") },
    {
      name: "a nonempty constructor",
      source: panel.replace("new URLSearchParams()", 'new URLSearchParams("term=value")'),
    },
    {
      name: "an extra initializer evaluation",
      source: panel.replace("const result=", "run();const result="),
    },
    {
      name: "an earlier sibling provider hazard",
      source: panel.replace(
        "const [params]",
        "const [earlier]=useState(()=>source[key]());const [params]",
      ),
    },
    {
      name: "a constructor prototype alias",
      files: { "project/app/alter.ts": "const provider=[].constructor;alter(provider);" },
    },
    {
      name: "a custom Next compiler",
      files: {
        "project/next.config.ts": "export default {webpack(config){return alter(config)}};",
      },
    },
    {
      name: "an additional mts config",
      files: {
        "project/next.config.mts": "export default {webpack(config){return alter(config)}};",
      },
    },
    {
      name: "an explicit JSX runtime provider",
      files: {
        "project/app/alter.ts": 'import * as runtime from "react/jsx-runtime";runtime.jsx=custom;',
      },
    },
    {
      name: "a classic JSX provider replacement",
      files: { "project/app/alter.ts": 'import React from "react";React.createElement=custom;' },
    },
    {
      name: "a value reexport of the React provider",
      files: {
        "project/app/react-bridge.ts": 'export {default} from "react";',
        "project/app/alter.ts": 'import React from "./react-bridge";React.useState=()=>[0,()=>{}];',
      },
    },
    {
      name: "a value reexport of the JSX runtime",
      files: {
        "project/app/runtime-bridge.ts": 'export {default} from "react/jsx-runtime";',
        "project/app/alter.ts":
          'import runtime from "./runtime-bridge";const makeElement=runtime.jsx;runtime.jsx=(tag,props,key)=>makeElement(tag,{...props,query:{}},key);',
      },
    },
    {
      name: "a star reexport of the development JSX runtime",
      files: { "project/app/runtime-bridge.ts": 'export * from "react/jsx-dev-runtime";' },
    },
    {
      name: "a native VM code-loader module",
      files: { "project/app/alter.ts": 'import vm from "node:vm";vm.runInThisContext("void 0");' },
    },
    {
      name: "a layout inline script",
      files: {
        "project/app/layout.tsx":
          'export default function Layout({children}){return <html><body><script>{"URLSearchParams=class {set(){}}"}</script>{children}</body></html>;}',
      },
    },
    {
      name: "an aliased native script element",
      files: {
        "project/app/layout.tsx":
          'const Tag="script";export default function Layout({children}){return <html><body><Tag>{"URLSearchParams=class {set(){}}"}</Tag>{children}</body></html>;}',
      },
    },
    {
      name: "a layout active HTML payload",
      files: {
        "project/app/layout.tsx":
          'export default function Layout({children}){return <html><body><div dangerouslySetInnerHTML={{__html:"<script>run()</script>"}}/>{children}</body></html>;}',
      },
    },
    {
      name: "an own frame source document",
      files: {
        "project/app/frame.tsx":
          'export const Frame=()=> <iframe srcDoc="<script>parent.URLSearchParams=custom</script>"/>;',
      },
    },
    {
      name: "the Next script runtime API",
      files: {
        "project/app/script.tsx":
          'import Script from "next/script";export const Loader=()=> <Script>{"URLSearchParams=custom"}</Script>;',
      },
    },
    {
      name: "a package import remap",
      files: {
        "project/package.json":
          '{"private":true,"dependencies":{"next":"16.0.10","react":"19.2.3","react-dom":"19.2.3"},"imports":{"#query":"./custom.ts"}}',
      },
    },
  ])("declines the certificate for $name", ({ source, files }) => {
    expect(diagnose(source, files).length).toBeGreaterThan(0);
  });

  it("follows a bounded outside UI import chain that receives data only", () => {
    const source =
      'import {ExternalView} from "../../../shared-ui";\n' +
      panel
        .replace('"use client";', "")
        .replace(
          "return <span>{params.toString()}</span>;",
          "return <ExternalView params={params}/>;",
        );
    expect(
      diagnose('"use client";\n' + source, {
        "shared-ui/index.ts": 'export {ExternalView} from "./view";',
        "shared-ui/view.tsx":
          "export const ExternalView=({params})=><span>{params.toString()}</span>;",
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "an outside direct caller",
      'import {QueryPanel} from "../project/app/[item]/query-panel";export const ExternalView=()=> <QueryPanel query={custom()}/>;',
    ],
    ["an outside reexport chain", 'export {ExternalView} from "./bridge";'],
    ["an outside missing relative edge", 'import "./missing";export const ExternalView=()=>null;'],
    [
      "an outside runtime import-equals loader",
      'import Panel=require("../project/app/[item]/query-panel");export const ExternalView=()=>Panel.QueryPanel({query:custom()});',
    ],
    [
      "an outside dynamic loader",
      'export const ExternalView=()=>import("../project/app/[item]/query-panel");',
    ],
    [
      "an outside computed native loader",
      'globalThis["Function"]("return custom")();export const ExternalView=()=>null;',
    ],
    [
      "an outside Array prototype replacement",
      'Array.prototype.join=()=>"changed";export const ExternalView=()=>null;',
    ],
    [
      "an outside query prototype replacement",
      "URLSearchParams.prototype.set=custom;export const ExternalView=()=>null;",
    ],
    [
      "an outside bare query provider replacement",
      "URLSearchParams=custom;export const ExternalView=()=>null;",
    ],
    [
      "an outside dynamic reflection lookup",
      'const derive=Object["get"+"PrototypeOf"];const prototype=derive([]);prototype.join=()=>"changed";export const ExternalView=()=>null;',
    ],
    [
      "an outside fresh native computed receiver",
      'const name=["__","proto__"].join("");const prototype=[][name];prototype.join=()=>"changed";export const ExternalView=()=>null;',
    ],
    [
      "an outside legacy prototype getter",
      'const read=[].__lookupGetter__("__proto__");const prototype=read.call([]);prototype.join=()=>"changed";export const ExternalView=()=>null;',
    ],
    ["an outside package-import remap", 'export {ExternalView} from "#panel";'],
    [
      "an outside native VM code loader",
      'import vm from "node:vm";vm.runInThisContext("void 0");export const ExternalView=()=>null;',
    ],
    ["an outside React provider reexport", 'export {default as ExternalView} from "react";'],
    [
      "an outside React provider replacement",
      'import React from "react";React.useState=()=>[0,()=>{}];export const ExternalView=()=>null;',
    ],
    [
      "an outside classic JSX replacement",
      'import React from "react";React.createElement=()=>null;export const ExternalView=()=>null;',
    ],
    [
      "an outside JSX runtime value import",
      'import * as runtime from "react/jsx-runtime";runtime.jsx=()=>null;export const ExternalView=()=>null;',
    ],
    [
      "an outside computed Window provider lookup",
      'const root=window;const name="URL"+"SearchParams";const provider=root[name];export const ExternalView=()=>provider;',
    ],
  ])("declines the certificate for %s", (_name, ui) => {
    const source =
      '"use client";\nimport {ExternalView} from "../../../shared-ui";\n' +
      panel
        .replace('"use client";', "")
        .replace(
          "return <span>{params.toString()}</span>;",
          "return <ExternalView params={params}/>;",
        );
    expect(
      diagnose(source, {
        "shared-ui/index.tsx": ui,
        "shared-ui/bridge.tsx":
          'import {QueryPanel} from "../project/app/[item]/query-panel";export const ExternalView=()=> <QueryPanel query={custom()}/>;',
        "shared-ui/package.json":
          '{"name":"shared-ui","private":true,"type":"module","imports":{"#panel":"./bridge.tsx"}}',
      }).length,
    ).toBeGreaterThan(0);
  });

  it("disables per-file fingerprinting before either a passing or failing caller proof", () => {
    diagnose();
    const capture = () =>
      collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: panel,
        ruleIds: ["hook-use-state"],
      });
    expect(capture()).toBeNull();
    writeFixture(
      "project/next.config.ts",
      "export default {webpack(config){return alter(config)}};",
    );
    resetFilesystemCaches();
    expect(capture()).toBeNull();
  });

  it("retains an empty dependency trace for a source-local noncandidate", () => {
    const source = 'import {useState} from "react";const [initialCount]=useState(7);';
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: source,
      ruleIds: ["hook-use-state"],
    });
    expect(trace?.contentPaths.size).toBe(0);
    expect(trace?.existencePaths.size).toBe(0);
  });

  it("notices an mts config appearing without changing the selected source", () => {
    expect(diagnose()).toEqual([]);
    fs.unlinkSync(path.join(projectDirectory, "next.config.ts"));
    writeFixture(
      "project/next.config.mts",
      "export default {webpack(config){return alter(config)}};",
    );
    expect(diagnose().length).toBeGreaterThan(0);
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: panel,
      ruleIds: ["hook-use-state"],
    });
    expect(trace).toBeNull();
  });
});
