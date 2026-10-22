import { parseSourceFile } from "../../utils/parse-source-file.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  PROVIDER_PROOF_SMALL_COMPONENT_COUNT,
  PROVIDER_PROOF_LARGE_COMPONENT_COUNT,
  PROVIDER_PROOF_MAX_GROWTH_RATIO,
  PROVIDER_PROOF_MAX_SHARED_MODULE_GROWTH_RATIO,
} from "../../../test-utils/constants.js";
import * as astWalking from "../../utils/walk-ast.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { hasNativeIframeReadinessConsumption } from "./utils/has-native-iframe-readiness-consumption.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";
import fixture from "./native-iframe-readiness.fixtures.json";

interface ReadinessCase {
  readonly name: string;
  readonly supported: boolean;
  readonly file?: string;
  readonly before?: string;
  readonly after?: string;
  readonly additionalFiles?: Readonly<Record<string, string>>;
}

const cases: readonly ReadinessCase[] = [
  {
    name: "parenthesized native bridge return",
    supported: true,
    file: "Frame.tsx",
    before: "return <Surface",
    after: "return (<Surface",
  },
  {
    name: "same-frame message and consumed command with independent subscription",
    supported: true,
  },
  {
    name: "direct native iframe",
    supported: true,
    before: "<Frame ref={bindFrame}",
    after: "<iframe ref={bindFrame}",
  },
  {
    name: "owned plain rows snapshot",
    supported: true,
    before: "const active=useRef(null);",
    after: "const files=[{status:'waiting'}]; const active=useRef(null);",
  },
  {
    name: "direct native container in bridge",
    supported: true,
    file: "Frame.tsx",
    before: "<Surface style={hidden?hiddenStyle:visibleStyle}>",
    after: "<div style={hidden?hiddenStyle:visibleStyle}>",
  },
  {
    name: "rendered latch",
    supported: false,
    before: "if(!open) return null;",
    after: "if(ready) return <output>queued</output>; if(!open) return null;",
  },
  {
    name: "opaque latch value call",
    supported: false,
    before: "if(!open) return null;",
    after: "observe(ready); if(!open) return null;",
  },
  {
    name: "setter escape",
    supported: false,
    before: "const {transmit,bindFrame}",
    after: "publish(setReady); const {transmit,bindFrame}",
  },
  {
    name: "functional updater",
    supported: false,
    before: "setReady(false);",
    after: "setReady(previous=>false);",
  },
  {
    name: "reordered consumption",
    supported: false,
    before: "transmit({kind:'begin',files:queue.getFiles()});\n          setReady(false);",
    after: "setReady(false);\n          transmit({kind:'begin',files:queue.getFiles()});",
  },
  {
    name: "publisher between send and consume",
    supported: false,
    before: "transmit({kind:'begin',files:queue.getFiles()});",
    after: "transmit({kind:'begin',files:queue.getFiles()}); notifyParent();",
  },
  {
    name: "deferred sender",
    supported: false,
    before: "transmit({kind:'begin',files:queue.getFiles()});",
    after: "setTimeout(()=>transmit({kind:'begin',files:queue.getFiles()}),0);",
  },
  {
    name: "later ready publication",
    supported: false,
    before: "setReady(false);\n        }",
    after: "setReady(false); setReady(true);\n        }",
  },
  {
    name: "ready event also publishes UI",
    supported: false,
    before: "{setReady(true);}",
    after: "{setReady(true); notifyParent();}",
  },
  {
    name: "opaque gate inside selected branch",
    supported: false,
    before: "queue.getFiles().length>0",
    after: "maySend(ready) && queue.getFiles().length>0",
  },
  {
    name: "extra state-dependent effect",
    supported: false,
    before: "if(!open) return null;",
    after: "useEffect(()=>notifyParent(ready),[ready]); if(!open) return null;",
  },
  {
    name: "dynamic dependency member",
    supported: false,
    before: "[open,ready,transmit,queue,active]",
    after: "[open,ready[field],transmit,queue,active]",
  },
  {
    name: "arbitrary snapshot type",
    supported: false,
    before: "queue?:TransferQueue",
    after: "queue?:UnprovenQueue",
  },
  {
    name: "unrelated generic preserves module type identity",
    supported: true,
    before: "export function TransferPanel(props",
    after: "export function TransferPanel<TransferQueue>(props",
  },
  {
    name: "generic snapshot interface shadows imported role",
    supported: false,
    before: "interface TransferProps {",
    after: "interface TransferProps<TransferQueue> {",
  },
  {
    name: "props escape",
    supported: false,
    before: "const {open, endpoint, queue}=props;",
    after: "expose(props); const {open, endpoint, queue}=props;",
  },
  {
    name: "snapshot owner escape",
    supported: false,
    before: "const active=useRef(null);",
    after: "expose(queue); const active=useRef(null);",
  },
  {
    name: "visible snapshot getter contradiction",
    supported: false,
    before: "export function TransferPanel",
    after: "const contrary={get files(){notifyParent();return []}}; export function TransferPanel",
  },
  {
    name: "visible fake snapshot method",
    supported: false,
    before: "export function TransferPanel",
    after: "const contrary={getFiles(){notifyParent();return []}}; export function TransferPanel",
  },
  {
    name: "delegate in missing-frame return",
    supported: false,
    file: "channel/index.ts",
    before: "if(!frame) {return;}",
    after: "if(!frame) {return notify(event.data,post);}",
  },
  {
    name: "delegate in source-mismatch return",
    supported: false,
    file: "channel/index.ts",
    before: "if(event.source!==frame?.contentWindow) {return;}",
    after: "if(event.source!==frame?.contentWindow) {return notify(event.data,post);}",
  },
  {
    name: "delegate deferred after guards",
    supported: false,
    file: "channel/index.ts",
    before: "if(notify) {notify(event.data,post);}",
    after: "setTimeout(()=>notify(event.data,post),0);",
  },
  {
    name: "delegate before source guards",
    supported: false,
    file: "channel/index.ts",
    before: "if(!frame) {return;}",
    after: "if(notify) {notify(event.data,post);} if(!frame) {return;}",
  },
  {
    name: "different message frame",
    supported: false,
    file: "channel/index.ts",
    before: "event.source!==frame?.contentWindow",
    after: "event.source!==other?.contentWindow",
  },
  {
    name: "reversed message source gate",
    supported: false,
    file: "channel/index.ts",
    before: "event.source!==frame?.contentWindow",
    after: "event.source===frame?.contentWindow",
  },
  {
    name: "missing source gate",
    supported: false,
    file: "channel/index.ts",
    before: "if(event.source!==frame?.contentWindow) {return;}",
    after: "",
  },
  {
    name: "message callback exposed",
    supported: false,
    before: "const {transmit,bindFrame}",
    after: "expose(receive); const {transmit,bindFrame}",
  },
  {
    name: "native listener exposed",
    supported: false,
    file: "channel/index.ts",
    before: "window.addEventListener('message',listener,false);",
    after: "expose(listener); window.addEventListener('message',listener,false);",
  },
  {
    name: "direct forged callback call",
    supported: false,
    file: "channel/index.ts",
    before: "return {transmit:post,bindFrame:setFrame};",
    after:
      "notify({kind:'engine-online',route:'transfer'},post); return {transmit:post,bindFrame:setFrame};",
  },
  {
    name: "synthetic message dispatch",
    supported: false,
    file: "channel/index.ts",
    before: "return {transmit:post,bindFrame:setFrame};",
    after:
      "window.dispatchEvent(new MessageEvent('message')); return {transmit:post,bindFrame:setFrame};",
  },
  {
    name: "sender exposes a callback instead of native method",
    supported: false,
    file: "channel/index.ts",
    before: "frame.contentWindow?.postMessage(packet,origin);",
    after: "externalSender(packet,origin);",
  },
  {
    name: "native method replacement",
    supported: false,
    file: "channel/index.ts",
    before: "const post=useCallback",
    after: "frame.contentWindow.postMessage=externalSender; const post=useCallback",
  },
  {
    name: "hook return object spread",
    supported: false,
    file: "channel/index.ts",
    before: "return {transmit:post,bindFrame:setFrame};",
    after: "return {...extras,transmit:post,bindFrame:setFrame};",
  },
  {
    name: "frame setter exposed",
    supported: false,
    file: "channel/index.ts",
    before: "const post=useCallback",
    after: "expose(setFrame); const post=useCallback",
  },
  {
    name: "erased interface eval capability",
    supported: false,
    file: "channel/index.ts",
    before: "export const useChannel",
    after: "interface eval {} export const useChannel",
  },
  {
    name: "erased type alias Function capability",
    supported: false,
    file: "channel/index.ts",
    before: "export const useChannel",
    after: "type Function=unknown; export const useChannel",
  },
  {
    name: "erased interface Object capability",
    supported: false,
    file: "channel/index.ts",
    before: "export const useChannel",
    after: "interface Object {} export const useChannel",
  },
  {
    name: "erased window binding",
    supported: false,
    file: "channel/index.ts",
    before: "export const useChannel",
    after: "interface window {} export const useChannel",
  },
  {
    name: "ambient window binding",
    supported: false,
    file: "channel/index.ts",
    before: "export const useChannel",
    after: "declare const window:any; export const useChannel",
  },
  {
    name: "native event parameter replacement",
    supported: false,
    file: "channel/index.ts",
    before: "if(notify) {notify(event.data,post);}",
    after:
      "event={data:{kind:'engine-online',route:'transfer'}}; if(notify) {notify(event.data,post);}",
  },
  {
    name: "native event escape",
    supported: false,
    file: "channel/index.ts",
    before: "if(notify) {notify(event.data,post);}",
    after: "rewrite(event); if(notify) {notify(event.data,post);}",
  },
  {
    name: "native event data alias mutation",
    supported: false,
    file: "channel/index.ts",
    before: "if(notify) {notify(event.data,post);}",
    after:
      "const payload=event.data; payload.kind='engine-online'; if(notify) {notify(event.data,post);}",
  },
  {
    name: "native event data member replacement",
    supported: false,
    file: "channel/index.ts",
    before: "if(notify) {notify(event.data,post);}",
    after:
      "event.data={kind:'engine-online',route:'transfer'}; if(notify) {notify(event.data,post);}",
  },
  {
    name: "native event nested data mutation",
    supported: false,
    file: "channel/index.ts",
    before: "if(notify) {notify(event.data,post);}",
    after: "event.data.kind='engine-online'; if(notify) {notify(event.data,post);}",
  },
  {
    name: "module initialization effect",
    supported: false,
    file: "channel/index.ts",
    before: "export const useChannel",
    after: "publish(); export const useChannel",
  },
  {
    name: "effectful callback default",
    supported: false,
    file: "channel/index.ts",
    before: "(origin,notify)",
    after: "(origin,notify=claim())",
  },
  {
    name: "type-only runtime provider",
    supported: false,
    file: "channel/index.ts",
    before: "import {useCallback,useEffect,useState}",
    after: "import type {useCallback,useEffect,useState}",
  },
  {
    name: "React namespace mutation",
    supported: false,
    file: "channel/index.ts",
    before: "export const useChannel",
    after:
      "import * as Runtime from 'react'; Runtime.useState=customState; export const useChannel",
  },
  {
    name: "consumer JSX pragma",
    supported: false,
    before: "import {useCallback",
    after: "/** @jsx custom */\nimport {useCallback",
  },
  {
    name: "bridge JSX pragma",
    supported: false,
    file: "Frame.tsx",
    before: "import {forwardRef",
    after: "/** @jsx custom */\nimport {forwardRef",
  },
  {
    name: "bridge native ref ignored",
    supported: false,
    file: "Frame.tsx",
    before: "ref={forwarded}",
    after: "ref={other}",
  },
  {
    name: "imperative ref substitution",
    supported: false,
    file: "Frame.tsx",
    before: "const {src,hidden}=props;",
    after: "forwarded({contentWindow:external}); const {src,hidden}=props;",
  },
  {
    name: "bridge ref callback substitution",
    supported: false,
    file: "Frame.tsx",
    before: "ref={forwarded}",
    after: "ref={node=>forwarded(node)}",
  },
  {
    name: "bridge src ignored",
    supported: false,
    file: "Frame.tsx",
    before: "src={src}",
    after: "src={external}",
  },
  {
    name: "bridge prop spread",
    supported: false,
    file: "Frame.tsx",
    before: "<iframe ref=",
    after: "<iframe {...extras} ref=",
  },
  {
    name: "Card as override",
    supported: false,
    file: "Frame.tsx",
    before: "<Surface style=",
    after: "<Surface as={Intercept} style=",
  },
  ...["svg", "math", "template", "img", "noembed", "noframes", "plaintext", "xmp"].map(
    (tagName) => ({
      name: `unsupported ${tagName} ancestor`,
      supported: false,
      file: "Frame.tsx",
      before: fixture.files["Frame.tsx"],
      after: fixture.files["Frame.tsx"]
        .replace("<Surface ", `<${tagName} `)
        .replace("</Surface>", `</${tagName}>`),
    }),
  ),
  {
    name: "opaque custom-element ancestor",
    supported: false,
    file: "Frame.tsx",
    before:
      "<Surface style={hidden?hiddenStyle:visibleStyle}>\n    <iframe ref={forwarded} src={src} style={{border:'none'}}/>\n  </Surface>",
    after:
      "<frame-shell style={hidden?hiddenStyle:visibleStyle}>\n    <iframe ref={forwarded} src={src} style={{border:'none'}}/>\n  </frame-shell>",
  },
  {
    name: "opaque custom ancestor",
    supported: false,
    file: "Frame.tsx",
    before: "{Card as Surface}",
    after: "{Unknown as Surface}",
  },
  {
    name: "Card namespace transport mutation",
    supported: false,
    file: "Frame.tsx",
    before: "const visibleStyle",
    after: "import * as UI from '@sanity/ui'; UI.Card=Intercept; const visibleStyle",
  },
  {
    name: "secondary frame import mutation",
    supported: false,
    before: "interface TransferProps",
    after:
      "import {Frame as Other} from './Frame.tsx'; Other.render=Intercept; interface TransferProps",
  },
  {
    name: "sender export alias via barrel",
    supported: false,
    additionalFiles: { "channel.ts": "export {useChannel} from './channel/index';" },
  },
  {
    name: "locally remapped Card provider",
    supported: false,
    additionalFiles: {
      "tsconfig.json": '{"compilerOptions":{"paths":{"@sanity/ui":["./local-ui"]}}}',
      "local-ui.ts": "export const Card=Intercept;",
    },
  },
  {
    name: "locally remapped uploader role",
    supported: false,
    additionalFiles: {
      "tsconfig.json": '{"compilerOptions":{"paths":{"@sanity/types":["./local-types"]}}}',
      "local-types.ts": "export interface AssetSourceUploader {getFiles():unknown[]}",
    },
  },
];

const proof: Rule = {
  id: "test-native-readiness-proof",
  severity: "error",
  create: (context) => ({
    CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
      if (hasNativeIframeReadinessConsumption(node, context))
        context.report({ node, message: "closed native readiness consumption" });
    },
  }),
};

for (const testCase of cases)
  describe(testCase.name, () => {
    it("keeps a nonvacuous certificate and full parser arrays", () => {
      const directory = mkdtempSync(join(tmpdir(), "native-readiness-"));
      try {
        const files: Record<string, string> = { ...fixture.files, ...testCase.additionalFiles };
        if (testCase.before !== undefined && testCase.after !== undefined) {
          const relative = testCase.file ?? "Panel.tsx";
          expect(files[relative]).toContain(testCase.before);
          files[relative] = files[relative].replace(testCase.before, testCase.after);
          if (testCase.name === "direct native container in bridge")
            files[relative] = files[relative].replace("</Surface>", "</div>");
        }
        if (testCase.name.startsWith("delegate in "))
          files["channel/index.ts"] = files["channel/index.ts"].replace(
            "if(notify) {notify(event.data,post);}",
            "",
          );
        if (testCase.name === "delegate before source guards")
          files["channel/index.ts"] = files["channel/index.ts"]
            .replaceAll("if(notify) {notify(event.data,post);}", "")
            .replace("if(!frame) {return;}", "notify(event.data,post); if(!frame) {return;}");
        if (testCase.name === "erased interface eval capability")
          files["channel/index.ts"] = files["channel/index.ts"].replace(
            "  useEffect(()=>{",
            "  eval(\"notify({kind:'engine-online',route:'transfer'},post)\"); useEffect(()=>{",
          );
        if (testCase.name === "erased type alias Function capability")
          files["channel/index.ts"] = files["channel/index.ts"].replace(
            "  useEffect(()=>{",
            "  Function('return 0')(); useEffect(()=>{",
          );
        if (testCase.name === "erased interface Object capability")
          files["channel/index.ts"] = files["channel/index.ts"].replace(
            "  useEffect(()=>{",
            "  Object.assign(post,{replacement:true}); useEffect(()=>{",
          );
        if (testCase.name === "parenthesized native bridge return")
          files["Frame.tsx"] = files["Frame.tsx"].replace("</Surface>;", "</Surface>);");
        if (testCase.name === "owned plain rows snapshot")
          files["Panel.tsx"] = files["Panel.tsx"].replaceAll("queue.getFiles()", "files");
        for (const [relative, contents] of Object.entries(files)) {
          const filename = join(directory, relative);
          mkdirSync(dirname(filename), { recursive: true });
          writeFileSync(filename, contents);
          if (/\.tsx?$/.test(relative))
            expect(parseFixture(contents, { filename }).errors).toEqual([]);
        }
        const filename = join(directory, "Panel.tsx");
        for (const wrap of [false, true]) {
          resetFilesystemCaches();
          const certificate = runRule(
            wrap ? wrapWithSemanticContext(proof) : proof,
            files["Panel.tsx"],
            { filename },
          );
          expect(certificate.parseErrors).toEqual([]);
          expect(certificate.diagnostics).toHaveLength(Number(testCase.supported));
          const result = runRule(
            wrap
              ? wrapWithSemanticContext(noResetAllStateOnPropChange)
              : noResetAllStateOnPropChange,
            files["Panel.tsx"],
            { filename },
          );
          expect(result.parseErrors).toEqual([]);
          if (testCase.supported) expect(result.diagnostics).toEqual([]);
        }
      } finally {
        resetFilesystemCaches();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });

for (const phase of ["rule", "dependency collector"])
  it(`keeps ${phase} readiness reference proofs linear across refused consumers`, () => {
    const directory = mkdtempSync(join(tmpdir(), "readiness-reference-growth-"));
    try {
      writeFileSync(join(directory, "package.json"), fixture.files["package.json"]);
      const filename = join(directory, "Panel.tsx");
      const countVisitedNodes = (componentCount: number): number => {
        const code =
          "import {useState,useEffect} from 'react';\n" +
          Array.from(
            { length: componentCount },
            (_, index) => `
            export const Panel${index}=({value})=>{
              const [state,setState]=useState("");
              useEffect(()=>{setState("")},[value]);
              return <input value={state} onChange={event=>setState(event.target.value)}/>;
            };
          `,
          ).join("\n");
        writeFileSync(filename, code);
        expect(parseFixture(code, { filename }).errors).toEqual([]);
        resetFilesystemCaches();
        let visitedNodes = 0;
        const walkAst = astWalking.walkAst;
        const traversal = vi.spyOn(astWalking, "walkAst").mockImplementation((node, visitor) =>
          walkAst(node, (candidate) => {
            visitedNodes++;
            return visitor(candidate);
          }),
        );
        try {
          if (phase === "rule") {
            const result = runRule(noResetAllStateOnPropChange, code, { filename });
            expect(result.parseErrors).toEqual([]);
            expect(result.diagnostics).toHaveLength(componentCount);
          } else {
            const probes = collectCrossFileDependencyProbes({
              absoluteFilePath: filename,
              sourceText: code,
              ruleIds: ["no-reset-all-state-on-prop-change"],
            });
            expect(probes).not.toBeNull();
          }
        } finally {
          traversal.mockRestore();
        }
        return visitedNodes;
      };
      const smallVisits = countVisitedNodes(PROVIDER_PROOF_SMALL_COMPONENT_COUNT);
      const largeVisits = countVisitedNodes(PROVIDER_PROOF_LARGE_COMPONENT_COUNT);
      expect(smallVisits).toBeGreaterThan(0);
      expect(largeVisits).toBeLessThan(smallVisits * PROVIDER_PROOF_MAX_GROWTH_RATIO);
    } finally {
      resetFilesystemCaches();
      rmSync(directory, { recursive: true, force: true });
    }
  });

it("keeps warm reference proofs separate from live resolver and provider checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "readiness-reference-replay-"));
  try {
    for (const [relative, contents] of Object.entries(fixture.files)) {
      const filename = join(directory, relative);
      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, contents);
    }
    const filename = join(directory, "Panel.tsx");
    const input = {
      absoluteFilePath: filename,
      sourceText: fixture.files["Panel.tsx"],
      ruleIds: ["no-reset-all-state-on-prop-change"],
    };
    resetFilesystemCaches();
    const cold = collectCrossFileDependencyProbes(input);
    const warm = collectCrossFileDependencyProbes(input);
    expect(cold).not.toBeNull();
    expect(warm).not.toBeNull();
    expect(cold?.contentPaths.has(join(directory, "Frame.tsx"))).toBe(true);
    expect(cold?.contentPaths.has(join(directory, "channel/index.ts"))).toBe(true);
    expect([...(warm?.contentPaths ?? [])].sort()).toEqual([...(cold?.contentPaths ?? [])].sort());
    expect([...(warm?.existencePaths ?? [])].sort()).toEqual(
      [...(cold?.existencePaths ?? [])].sort(),
    );
    let didReplay = false;
    const certificates: boolean[] = [];
    const replayRule: Rule = {
      id: "test-native-readiness-reference-replay",
      severity: "error",
      create: (context) => ({
        CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
          if (didReplay || !hasNativeIframeReadinessConsumption(node, context)) return;
          didReplay = true;
          certificates.push(true);
          writeFileSync(join(directory, "replacement.ts"), "export const useEffect=custom;");
          writeFileSync(
            join(directory, "tsconfig.json"),
            '{"compilerOptions":{"paths":{"react":["./replacement.ts"]}}}',
          );
          resetFilesystemCaches();
          certificates.push(hasNativeIframeReadinessConsumption(node, context));
          writeFileSync(join(directory, "tsconfig.json"), "{}");
          resetFilesystemCaches();
          certificates.push(hasNativeIframeReadinessConsumption(node, context));
          writeFileSync(
            join(directory, "Frame.tsx"),
            fixture.files["Frame.tsx"].replace(
              "const {src,hidden}=props;",
              "const {src,hidden}=props; observe(props);",
            ),
          );
          resetFilesystemCaches();
          certificates.push(hasNativeIframeReadinessConsumption(node, context));
          writeFileSync(join(directory, "Frame.tsx"), fixture.files["Frame.tsx"]);
          resetFilesystemCaches();
          certificates.push(hasNativeIframeReadinessConsumption(node, context));
        },
      }),
    };
    const result = runRule(replayRule, fixture.files["Panel.tsx"], { filename });
    expect(result.parseErrors).toEqual([]);
    expect(certificates).toEqual([true, false, true, false, true]);
    for (const code of [
      fixture.files["Panel.tsx"],
      fixture.files["Panel.tsx"].replace(
        "const receive=useCallback",
        "observe(useEffect); const receive=useCallback",
      ),
      fixture.files["Panel.tsx"],
    ]) {
      const result = runRule(noResetAllStateOnPropChange, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(Number(code.includes("observe(useEffect)")));
    }
  } finally {
    resetFilesystemCaches();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("amortizes closed provider syntax across independent accepted consumers", () => {
  const countProviderWalks = (componentCount: number): number => {
    const directory = mkdtempSync(join(tmpdir(), "readiness-shared-provider-growth-"));
    try {
      for (const [relative, contents] of Object.entries(fixture.files)) {
        const filename = join(directory, relative);
        mkdirSync(dirname(filename), { recursive: true });
        writeFileSync(filename, contents);
      }
      resetFilesystemCaches();
      const provider = parseSourceFile(join(directory, "Frame.tsx"));
      if (!provider) throw new Error("Expected parsed frame provider");
      let walks = 0;
      const walkAst = astWalking.walkAst;
      const traversal = vi.spyOn(astWalking, "walkAst").mockImplementation((node, visitor) => {
        if (node === provider) walks++;
        return walkAst(node, visitor);
      });
      try {
        for (let index = 0; index < componentCount; index++) {
          const filename = join(directory, `Panel${index}.tsx`);
          const code = fixture.files["Panel.tsx"].replace("TransferPanel", `TransferPanel${index}`);
          writeFileSync(filename, code);
          const result = runRule(noResetAllStateOnPropChange, code, { filename });
          expect(result.parseErrors).toEqual([]);
          expect(result.diagnostics).toEqual([]);
        }
      } finally {
        traversal.mockRestore();
      }
      return walks;
    } finally {
      resetFilesystemCaches();
      rmSync(directory, { recursive: true, force: true });
    }
  };
  const small = countProviderWalks(PROVIDER_PROOF_SMALL_COMPONENT_COUNT);
  const large = countProviderWalks(PROVIDER_PROOF_LARGE_COMPONENT_COUNT);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeLessThan(small * PROVIDER_PROOF_MAX_SHARED_MODULE_GROWTH_RATIO);
});

it("keeps cached closed syntax separate from source pragmas and live provider React resolution", () => {
  const directory = mkdtempSync(join(tmpdir(), "readiness-closed-provider-replay-"));
  try {
    const providerFilename = join(directory, "frame/Frame.tsx");
    const code = fixture.files["Panel.tsx"].replace("./Frame", "./frame/Frame");
    expect(code).not.toBe(fixture.files["Panel.tsx"]);
    for (const [relative, contents] of Object.entries(fixture.files)) {
      const filename = relative === "Frame.tsx" ? providerFilename : join(directory, relative);
      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, relative === "Panel.tsx" ? code : contents);
    }
    resetFilesystemCaches();
    const provider = parseSourceFile(providerFilename);
    if (!provider) throw new Error("Expected parsed frame provider");
    const certificates: boolean[] = [];
    let didReplay = false;
    const replay: Rule = {
      id: "test-closed-readiness-provider-replay",
      severity: "error",
      create: (context) => ({
        CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
          if (didReplay || !hasNativeIframeReadinessConsumption(node, context)) return;
          didReplay = true;
          certificates.push(true);
          certificates.push(
            hasNativeIframeReadinessConsumption(node, {
              ...context,
              sourceText: "/** @jsx custom */\n" + code,
            }),
          );
          certificates.push(hasNativeIframeReadinessConsumption(node, context));
          writeFileSync(join(directory, "frame/replacement.ts"), "export const forwardRef=custom;");
          writeFileSync(
            join(directory, "frame/tsconfig.json"),
            '{"compilerOptions":{"paths":{"react":["./replacement.ts"]}}}',
          );
          resetTsconfigAliasCaches();
          expect(parseSourceFile(providerFilename)).toBe(provider);
          certificates.push(hasNativeIframeReadinessConsumption(node, context));
          writeFileSync(join(directory, "frame/tsconfig.json"), "{}");
          resetTsconfigAliasCaches();
          expect(parseSourceFile(providerFilename)).toBe(provider);
          certificates.push(hasNativeIframeReadinessConsumption(node, context));
        },
      }),
    };
    const result = runRule(replay, code, { filename: join(directory, "Panel.tsx") });
    expect(result.parseErrors).toEqual([]);
    expect(certificates).toEqual([true, false, true, false, true]);
  } finally {
    resetFilesystemCaches();
    rmSync(directory, { recursive: true, force: true });
  }
});
