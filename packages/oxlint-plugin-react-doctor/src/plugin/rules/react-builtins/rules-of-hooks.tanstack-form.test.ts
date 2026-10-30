import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const directFactory = `
  import {createFormHook} from "@tanstack/react-form";
  import {useState} from "react";
  const {withForm} = createFormHook({});
`;

const directForm = (render: string): string =>
  `${directFactory} const Panel = withForm({render: () => {${render}}});`;

const runTsx = (code: string) =>
  runRule(rulesOfHooks, `${code} const mounted = <Panel/>;`, { filename: "fixture.tsx" });

describe("TanStack createFormHook render ownership", () => {
  it.each([
    directForm("useState(0); return <div/>;"),
    `import {createFormHook as make} from "@tanstack/react-form";
     import {useState} from "react";
     const {withForm: decorate} = make({});
     const Panel = decorate({render: () => {useState(0); return <div/>;}});`,
    `import {createFormHook} from "@tanstack/react-form";
     import {useState} from "react";
     const {useAppForm, withForm} = createFormHook({});
     const Panel = withForm({defaultValues: {label: ""}, render: ({form}) => {
       useState(form); return <div/>;
     }});`,
    `${directFactory} const Panel = withForm({render: ({form}: {form: object}) => {
       useState(form); return <div/>;
     }});`,
  ])("recognizes only the genuine factory result render role: %s", (code) => {
    const result = runTsx(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    directForm("if(enabled)useState(0); return <div/>;"),
    directForm("if(enabled)return null; useState(0); return <div/>;"),
    directForm("for(const item of items)useState(item); return <div/>;"),
    directForm("try{useState(0)}catch{} return <div/>;"),
    directForm("const click=()=>useState(0); return <button onClick={click}/>;"),
    `${directFactory} const Panel=withForm({render: async()=>{useState(0);return <div/>}});`,
    `import {useState} from "react"; const withForm=(options)=>options.render;
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `import {createFormHook} from "unrelated-forms"; import {useState} from "react";
     const {withForm}=createFormHook({});
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `import {createFormHook} from "@tanstack/react-form"; import {useState} from "react";
     const make=createFormHook; const {withForm}=make({});
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `import {createFormHook} from "@tanstack/react-form"; import {useState} from "react";
     const {withForm=unrelated}=createFormHook({});
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `import {createFormHook} from "@tanstack/react-form"; import {useState} from "react";
     const {withForm,...rest}=createFormHook({});
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `import {createFormHook} from "@tanstack/react-form"; import {useState} from "react";
     const {["withForm"]: withForm}=createFormHook({});
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `${directFactory} const Panel=withForm({...defaults,render:()=>{useState(0);return <div/>}});`,
    `${directFactory} const Panel=withForm({render:unrelated,render:()=>{useState(0);return <div/>}});`,
    `${directFactory} ({withForm}=replacement);
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `${directFactory} ({createFormHook}=replacement);
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `import type {createFormHook} from "@tanstack/react-form"; import {useState} from "react";
     const {withForm}=createFormHook({});
     const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `${directFactory} const Panel=withForm({render:()=>null,defaultValues:()=>useState(0)});`,
  ])("preserves ordering and unsupported binding reports: %s", (code) => {
    const result = runTsx(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["./form", "@/form"])("follows one readonly local facade through %s", (source) => {
    const directory = mkdtempSync(join(tmpdir(), "rd-form-facade-"));
    try {
      writeFileSync(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
        }),
      );
      writeFileSync(
        join(directory, "form.ts"),
        `
        import {createFormHook} from "@tanstack/react-form";
        export const {useAppForm,withForm: makePanel}=createFormHook({});
      `,
      );
      resetFilesystemCaches();
      const result = runRule(
        rulesOfHooks,
        `
        import {makePanel} from "${source}"; import {useState} from "react";
        const Panel=makePanel({render:()=>{useState(0);return <div/>}});
        const mounted=<Panel></Panel>;
      `,
        { filename: join(directory, "panel.tsx") },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      resetFilesystemCaches();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    `import {createFormHook} from "unrelated-forms";
     export const {withForm}=createFormHook({});`,
    `import {createFormHook} from "@tanstack/react-form";
     export const {withForm}=createFormHook({}); ({withForm}=replacement);`,
    `import {createFormHook} from "@tanstack/react-form";
     export const {withForm=unrelated}=createFormHook({});`,
  ])("refuses an unproven or mutated provider: %s", (provider) => {
    const directory = mkdtempSync(join(tmpdir(), "rd-form-provider-"));
    try {
      writeFileSync(join(directory, "form.ts"), provider);
      resetFilesystemCaches();
      const result = runRule(
        rulesOfHooks,
        `
        import {withForm} from "./form"; import {useState} from "react";
        const Panel=withForm({render:()=>{useState(0);return <div/>}});
        const mounted=<Panel/>;
      `,
        { filename: join(directory, "panel.tsx") },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    } finally {
      resetFilesystemCaches();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); Panel();`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); if(enabled)Panel();`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; Panel();`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; consume(Panel);`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; Panel=replacement;`,
    `${directFactory} const make=()=>{const Panel=withForm({render:()=>{useState(0);return <div/>}}); return <Panel/>};`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}});`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel.Part/>;`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; try{throw {}}catch({value=Panel()}){}`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; try{throw {}}catch({[Panel()]:value}){}`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; try{throw {}}catch({value=(withForm=replacement)}){}`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; try{throw {}}catch({value=(createFormHook=replacement)}){}`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; enum Run{First=(Panel(),0)}`,
    `${directFactory} const Panel=withForm({render:()=>{useState(0);return <div/>}}); const mounted=<Panel/>; class Runner{constructor(public value=Panel()){}} new Runner();`,
    `${directFactory} const Panel=withForm({render:function renderForm({depth}){useState(0);if(depth>0)return renderForm({depth:depth-1});return <div/>}}); const mounted=<Panel/>;`,
    `${directFactory} const Panel=withForm({render:function renderForm(){useState(0);consume(renderForm);return <div/>}}); const mounted=<Panel/>;`,
  ])("requires a module const result used only as direct JSX: %s", (code) => {
    const result = runRule(rulesOfHooks, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes a transparently typed and exported module result", () => {
    const result = runRule(
      rulesOfHooks,
      `${directFactory}
      export const Panel=(withForm({render:()=>{useState(0);return <div/>}}) as unknown);
      const mounted=<Panel></Panel>;
    `,
      { filename: "fixture.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a shadowed catch binding separate from the component result", () => {
    const result = runTsx(`${directForm("useState(0); return <div/>;")}
      try{throw {}}catch({Panel=unrelated,value=Panel()}){}`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `${directFactory} const Panel=withForm({render:function(){useState(0);return <div/>}});`,
    `${directFactory} const Panel=withForm({render:function renderForm(){useState(0);return <div/>}});`,
    `${directForm("useState(0);return <div/>;")} enum Run{Panel=1,Next=Panel}`,
    `${directForm("useState(0);return <div/>;")} class Runner{constructor(public Panel=unrelated,public value=Panel()){}}`,
  ])("preserves an unreferenced render name and unrelated shadow bindings: %s", (code) => {
    const result = runTsx(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
