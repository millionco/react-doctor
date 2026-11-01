import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasKnownUnsandboxedIframeCaller } from "../../utils/has-known-unsandboxed-iframe-caller.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { iframeMissingSandbox } from "./iframe-missing-sandbox.js";

interface KnownIframeFixture {
  readonly name: string;
  readonly code: string;
  readonly files: Readonly<Record<string, string>>;
  readonly admitted: boolean;
}

const fixtures: ReadonlyArray<KnownIframeFixture> = [
  {
    name: "closed known caller omits sandbox",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n",
    },
    admitted: true,
  },
  {
    name: "caller forwards explicit sandbox",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame sandbox="" html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n",
    },
    admitted: false,
  },
  {
    name: "caller dynamic sandbox presence",
    code: 'import { Frame } from "./frame";\nexport const View = ({ sandbox }) => <Frame sandbox={sandbox} html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n",
    },
    admitted: false,
  },
  {
    name: "opaque caller spread",
    code: 'import { Frame } from "./frame";\nexport const View = (props) => <Frame {...props} html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n",
    },
    admitted: false,
  },
  {
    name: "provider explicit sandbox",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} sandbox="" srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "provider adds sandbox before rest snapshot",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { props.sandbox = ""; const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "visible provider defaultProps metadata write",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nFrame.defaultProps = { sandbox: "" };\n',
    },
    admitted: false,
  },
  {
    name: "custom delegated element not native frame",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'const Other = (props) => <iframe sandbox="" {...props} />;\nexport const Frame = (props) => { const { html, ...rest } = props; return <Other {...rest} srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "rest comes from another object",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html } = props; const rest = { sandbox: "" }; return <iframe {...rest} srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "exact selected export mismatch",
    code: 'import { Other as Frame } from "./frame";\nexport const View = () => <Frame />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nexport const Other = () => <div />;\n",
    },
    admitted: false,
  },
  {
    name: "type-only import cannot prove runtime component",
    code: 'import type { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n",
    },
    admitted: false,
  },
  {
    name: "rest escapes to a source-visible writer",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'const supply = (bag) => { bag.sandbox = ""; };\nexport const Frame = (props) => { const { html, ...rest } = props; supply(rest); return <iframe {...rest} srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "primitive literal default and native returned ancestry",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, showOpenInNewTab = true, wrapperClassName, ...rest } = props; return <div className={wrapperClassName}><iframe {...rest} srcDoc={html} /><span>{showOpenInNewTab ? "open" : "closed"}</span></div>; };\n',
    },
    admitted: true,
  },
  {
    name: "caller allow media marker preserves old exemption",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame allow="encrypted-media" html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n",
    },
    admitted: false,
  },
  {
    name: "provider allow media marker preserves old exemption",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe allow="picture-in-picture" {...rest} srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "custom ancestor clones iframe with sandbox",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'import { cloneElement } from "react";\nconst Protect = ({ children }) => cloneElement(children, { sandbox: "" });\nexport const Frame = (props) => { const { html, ...rest } = props; return <Protect><iframe {...rest} srcDoc={html} /></Protect>; };\n',
    },
    admitted: false,
  },
  {
    name: "unrendered conditional descendant iframe",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <div>{false && <iframe {...rest} srcDoc={html} />}</div>; };\n",
    },
    admitted: false,
  },
  {
    name: "destructure default writes props before rest copy",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, show = (props.sandbox = ""), ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "caller source visible component defaultProps write",
    code: 'import { Frame } from "./frame";\nFrame.defaultProps = { sandbox: "" };\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\n",
    },
    admitted: false,
  },
  {
    name: "rest receives sandbox before returned iframe",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; rest.sandbox = ""; return <iframe {...rest} srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "old provider explicit src already reports",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} src="/local" />; };\n',
    },
    admitted: false,
  },
  {
    name: "old provider invalid sandbox combination preserved",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} sandbox="allow-scripts allow-same-origin" srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "transparent direct eval mutates rest snapshot",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export function Frame(props) { const { html, ...rest } = props; (eval as any)('rest.sandbox = \"\"'); return <iframe {...rest} srcDoc={html} />; }\n",
    },
    admitted: false,
  },
  {
    name: "computed catch binding escapes rest to writer",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export function Frame(props) { const { html, ...rest } = props; try { throw {}; } catch ({ [(Object.assign(rest, { sandbox: "" }), "value")]: ignored }) {} return <iframe {...rest} srcDoc={html} />; }\n',
    },
    admitted: false,
  },
  {
    name: "erased enum initializer writes props",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export function Frame(props) { enum Setup { Value = (props.sandbox = "", 0) } const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; }\n',
    },
    admitted: false,
  },
  {
    name: "TS parameter property initializer changes component metadata",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export function Frame(props) { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; }\nclass Setup { constructor(public initialized = Object.defineProperty(Frame, "defaultProps", { value: { sandbox: "" } })) {} }\nnew Setup();\n',
    },
    admitted: false,
  },
  {
    name: "computed catch binding changes component metadata",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\ntry { throw {}; } catch ({ [(Object.defineProperty(Frame, "defaultProps", { value: { sandbox: "" } }), "value")]: ignored }) {}\n',
    files: {
      "frame.tsx":
        "export function Frame(props) { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; }\n",
    },
    admitted: false,
  },
  {
    name: "component value alias passed to reflective property maker",
    code: 'import { Frame } from "./frame";\nconst component = Frame;\nconst { defineProperty } = Object;\ndefineProperty(component, "defaultProps", { value: { sandbox: "" } });\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export function Frame(props) { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; }\n",
    },
    admitted: false,
  },
  {
    name: "inherited component metadata via visible object prototype write",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export function Frame(props) { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; }\nObject.prototype.defaultProps = { sandbox: "" };\n',
    },
    admitted: false,
  },
  {
    name: "selected prototype value escaped through object pattern",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export function Frame(props) { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; }\nconst { prototype: inherited } = Object;\ninherited.defaultProps = { sandbox: "" };\n',
    },
    admitted: false,
  },
  {
    name: "ordinary window open positive must survive",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export function Frame(props) { const { html, ...rest } = props; const openPreview = () => window.open("about:blank", "_blank"); return <iframe {...rest} onLoad={openPreview} srcDoc={html} />; }\n',
    },
    admitted: true,
  },
  {
    name: "runtime named import rename positive must survive",
    code: 'import { Frame as Preview } from "./frame";\nexport const View = () => <Preview html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export function Frame(props) { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; }\n",
    },
    admitted: true,
  },
  {
    name: "same-named component and props binding decline",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export function Frame(Frame) { const { html, ...rest } = Frame; Frame.sandbox = ""; return <iframe {...rest} srcDoc={html} />; }\n',
    },
    admitted: false,
  },
  {
    name: "same-named component and rest binding decline",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export function Frame(props) { const { html, ...Frame } = props; Frame.sandbox = ""; return <iframe {...Frame} srcDoc={html} />; }\n',
    },
    admitted: false,
  },
  {
    name: "prototype reader cannot add inherited default props",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nObject.getPrototypeOf(() => {}).defaultProps = { sandbox: "" };\n',
    },
    admitted: false,
  },
  {
    name: "destructured prototype reader cannot add inherited default props",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nconst { getPrototypeOf } = Object; getPrototypeOf(() => {}).defaultProps = { sandbox: "" };\n',
    },
    admitted: false,
  },
  {
    name: "wrapped window eval cannot change forwarded rest",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export function Frame(props) { const { html, ...rest } = props; (window.eval as any)('Object.prototype.defaultProps = {sandbox: \"\"}'); return <iframe {...rest} srcDoc={html} />; }\n",
    },
    admitted: false,
  },
  {
    name: "destructure after return cannot prove rendered iframe",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { return <iframe {...rest} srcDoc="" />; const { ...rest } = props; };\n',
    },
    admitted: false,
  },
  {
    name: "top level throw cannot prove rendered iframe",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; throw new Error("stop"); return <iframe {...rest} srcDoc={html} />; };\n',
    },
    admitted: false,
  },
  {
    name: "global execution namespace cannot escape to a computed alias",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nconst root = window; const capability = "eval"; root[capability](\'Object.prototype.defaultProps = {sandbox: ""}\');\n',
    },
    admitted: false,
  },
  {
    name: "destructured Function capability cannot change metadata",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nconst { Function: createCode } = window; createCode('Object.prototype.defaultProps = {sandbox: \"\"}')();\n",
    },
    admitted: false,
  },
  {
    name: "computed inherited metadata writer declines",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nconst inherited = ({}).__proto__; const key = "defaultProps"; inherited[key] = { sandbox: "" };\n',
    },
    admitted: false,
  },
  {
    name: "nested global execution namespace with computed capability declines",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nconst method = "eval"; window.self[method](\'Object.prototype.defaultProps = { sandbox: "" }\');\n',
    },
    admitted: false,
  },
  {
    name: "reflection namespace alias cannot manufacture inherited default props",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nconst reflection = Reflect; reflection.set(reflection.getPrototypeOf(() => {}), "defaultProps", { sandbox: "" });\n',
    },
    admitted: false,
  },
  {
    name: "indirect native reflection provider declines",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        'export const Frame = (props) => { const { html, ...rest } = props; return <iframe {...rest} srcDoc={html} />; };\nglobalThis.Object.assign(globalThis.Object.getPrototypeOf(() => {}), { defaultProps: { sandbox: "" } });\n',
    },
    admitted: false,
  },
  {
    name: "parenthesized function return preserves native iframe ancestry",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export function Frame(props) { const { html, ...rest } = props; return (<div><iframe {...rest} srcDoc={html} /></div>); }\n",
    },
    admitted: true,
  },
  {
    name: "parenthesized arrow return preserves fragment iframe ancestry",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return (<><iframe {...rest} srcDoc={html} /></>); };\n",
    },
    admitted: true,
  },
  {
    name: "transparent TypeScript return wrapper preserves native iframe ancestry",
    code: 'import { Frame } from "./frame";\nexport const View = () => <Frame html="<p>hello</p>" />;\n',
    files: {
      "frame.tsx":
        "export const Frame = (props) => { const { html, ...rest } = props; return ((<div><iframe {...rest} srcDoc={html} /></div>) as any); };\n",
    },
    admitted: true,
  },
];

let directory: string;

const resetSourceCaches = (): void => {
  __clearParseSourceFileCacheForTests();
  resetCrossFileExportCaches();
  resetModuleResolutionCaches();
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-known-iframe-"));
  resetSourceCaches();
});

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

const writeFixture = (fixture: KnownIframeFixture): string => {
  for (const [name, content] of Object.entries(fixture.files))
    fs.writeFileSync(path.join(directory, name), content);
  const filename = path.join(directory, "view.tsx");
  fs.writeFileSync(filename, fixture.code);
  return filename;
};

const certificateRule = defineRule({
  ...iframeMissingSandbox,
  create: (context) => ({
    JSXOpeningElement(node) {
      if (hasKnownUnsandboxedIframeCaller(node, context))
        context.report({ node: node.name, message: "known unsandboxed iframe" });
    },
  }),
});

const positive = fixtures[0];

const runCaller = (fixture = positive) => {
  const filename = writeFixture(fixture);
  return runRule(iframeMissingSandbox, fixture.code, { filename });
};

describe("known iframe caller certificate", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const filename = writeFixture(fixture);
      const result = runRule(certificateRule, fixture.code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(
        fixture.admitted
          ? [{ nodeType: "JSXIdentifier", message: "known unsandboxed iframe" }]
          : [],
      );
    });
  }

  for (const fixture of fixtures.filter((candidate) => candidate.admitted)) {
    it(`reports the supported caller: ${fixture.name}`, () => {
      const result = runCaller(fixture);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([
        {
          nodeType: "JSXIdentifier",
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
        },
      ]);
    });
  }

  it("preserves existing provider diagnostics without a duplicate caller", () => {
    for (const fixture of fixtures.slice(20, 22)) {
      const caller = runCaller(fixture);
      expect(caller.parseErrors).toEqual([]);
      expect(caller.diagnostics).toEqual([]);
      const provider = runRule(iframeMissingSandbox, fixture.files["frame.tsx"], {
        filename: path.join(directory, "frame.tsx"),
      });
      expect(provider.parseErrors).toEqual([]);
      expect(provider.diagnostics).toHaveLength(1);
    }
  });

  it("records every actual resolver read in the existing dependency collector", () => {
    const filename = writeFixture(positive);
    const actual = captureCrossFileProbes(() =>
      runRule(iframeMissingSandbox, positive.code, { filename }),
    );
    expect(actual.value.parseErrors).toEqual([]);
    expect(actual.value.diagnostics).toHaveLength(1);
    const collected = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: positive.code,
      ruleIds: ["iframe-missing-sandbox"],
    });
    expect(collected).not.toBeNull();
    for (const filename of actual.trace.contentPaths)
      expect(collected?.contentPaths.has(filename)).toBe(true);
    for (const filename of actual.trace.existencePaths)
      expect(collected?.existencePaths.has(filename)).toBe(true);
    expect(collected?.contentPaths.has(path.join(directory, "frame.tsx"))).toBe(true);
    expect(collected?.existencePaths.has(path.join(directory, "frame.ts"))).toBe(true);
  });

  it("changes the verdict after a probed provider edit and deletion", () => {
    const filename = writeFixture(positive);
    const collected = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: positive.code,
      ruleIds: ["iframe-missing-sandbox"],
    });
    const provider = path.join(directory, "frame.tsx");
    expect(collected?.contentPaths.has(provider)).toBe(true);
    expect(runRule(iframeMissingSandbox, positive.code, { filename }).diagnostics).toHaveLength(1);
    fs.writeFileSync(
      provider,
      positive.files["frame.tsx"].replace("srcDoc={html}", 'sandbox="" srcDoc={html}'),
    );
    resetSourceCaches();
    expect(runRule(iframeMissingSandbox, positive.code, { filename }).diagnostics).toEqual([]);
    fs.unlinkSync(provider);
    resetSourceCaches();
    expect(runRule(iframeMissingSandbox, positive.code, { filename }).diagnostics).toEqual([]);
    fs.writeFileSync(provider, positive.files["frame.tsx"]);
    resetSourceCaches();
    expect(runRule(iframeMissingSandbox, positive.code, { filename }).diagnostics).toHaveLength(1);
  });

  it("tracks earlier extension appearance and direct export retargeting", () => {
    const filename = writeFixture(positive);
    const collected = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: positive.code,
      ruleIds: ["iframe-missing-sandbox"],
    });
    const earlier = path.join(directory, "frame.ts");
    expect(collected?.existencePaths.has(earlier)).toBe(true);
    fs.writeFileSync(earlier, "export const Frame = () => null;");
    resetSourceCaches();
    expect(runRule(iframeMissingSandbox, positive.code, { filename }).diagnostics).toEqual([]);
    fs.unlinkSync(earlier);
    fs.writeFileSync(
      path.join(directory, "frame.tsx"),
      positive.files["frame.tsx"].replace("export const Frame", "export const Other"),
    );
    resetSourceCaches();
    expect(runRule(iframeMissingSandbox, positive.code, { filename }).diagnostics).toEqual([]);
  });
});

describe("known iframe caller inspection reuse", () => {
  it("retains per-caller sandbox, allow and spread gates for a shared import", () => {
    const fixture = {
      ...positive,
      code: `import { Frame } from "./frame";
export const View = ({ attributes }) => <>
  <Frame sandbox="" html="<p>safe</p>" />
  <Frame html="<p>unsafe</p>" />
  <Frame allow="camera" html="<p>allowed</p>" />
  <Frame {...attributes} html="<p>opaque</p>" />
  <Frame html="<p>also unsafe</p>" />
</>;
`,
    };
    const result = runCaller(fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps component certificates separate inside one provider program", () => {
    const fixture = {
      ...positive,
      code: `import { Frame, SafeFrame } from "./frame";
export const View = () => <>
  <SafeFrame html="<p>safe</p>" />
  <Frame html="<p>unsafe</p>" />
  <SafeFrame html="<p>still safe</p>" />
</>;
`,
      files: {
        "frame.tsx": `${positive.files["frame.tsx"]}
export const SafeFrame = (props) => {
  const { html, ...rest } = props;
  return <iframe {...rest} sandbox="" srcDoc={html} />;
};
`,
      },
    };
    const result = runCaller(fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rechecks providers and dependency probes while retaining the importer AST and scopes", () => {
    const filename = writeFixture(positive);
    let inspectCaller: (() => boolean) | undefined;
    const retainedRule = defineRule({
      ...iframeMissingSandbox,
      create: (context) => ({
        JSXOpeningElement(node) {
          if (node.name.type === "JSXIdentifier" && node.name.name === "Frame")
            inspectCaller = () => hasKnownUnsandboxedIframeCaller(node, context);
        },
      }),
    });
    expect(runRule(retainedRule, positive.code, { filename }).parseErrors).toEqual([]);
    expect(inspectCaller?.()).toBe(true);
    const provider = path.join(directory, "frame.tsx");
    const firstCapture = captureCrossFileProbes(() => inspectCaller?.());
    const repeatedCapture = captureCrossFileProbes(() => inspectCaller?.());
    expect(firstCapture.value).toBe(true);
    expect(repeatedCapture.value).toBe(true);
    expect(repeatedCapture.trace.contentPaths.has(provider)).toBe(true);
    expect(repeatedCapture.trace.existencePaths.has(path.join(directory, "frame.ts"))).toBe(true);
    expect(repeatedCapture.trace.contentPaths).toEqual(firstCapture.trace.contentPaths);
    expect(repeatedCapture.trace.existencePaths).toEqual(firstCapture.trace.existencePaths);
    fs.writeFileSync(
      provider,
      positive.files["frame.tsx"].replace("srcDoc={html}", 'sandbox="" srcDoc={html}'),
    );
    resetSourceCaches();
    expect(inspectCaller?.()).toBe(false);
    expect(inspectCaller?.()).toBe(false);
    fs.unlinkSync(provider);
    resetSourceCaches();
    const missingCapture = captureCrossFileProbes(() => inspectCaller?.());
    expect(missingCapture.value).toBe(false);
    expect(missingCapture.trace.existencePaths.has(provider)).toBe(true);
    fs.writeFileSync(provider, positive.files["frame.tsx"]);
    resetSourceCaches();
    expect(inspectCaller?.()).toBe(true);
    fs.writeFileSync(path.join(directory, "frame.ts"), "export const Frame = () => null;");
    resetSourceCaches();
    expect(inspectCaller?.()).toBe(false);
    fs.unlinkSync(path.join(directory, "frame.ts"));
    resetSourceCaches();
    const restoredCapture = captureCrossFileProbes(() => inspectCaller?.());
    expect(restoredCapture.value).toBe(true);
    expect(restoredCapture.trace.contentPaths.has(provider)).toBe(true);
  });
});
