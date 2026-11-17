import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "../regressions/_helpers.js";
import { assertNativeSyntaxSuccess } from "./utils/assert-native-syntax-success.js";

interface ReadonlyPrototypeNativeCase {
  name: string;
  constructorSource?: string;
  fallbackSource?: string;
  body?: string;
  setup?: string;
  sdkVersion?: string;
  lockSource?: string;
  expectedWarnings: number;
  entryImports?: string;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-readonly-prototype-"));
const freshBarrier = "if (!(await pause(24, controller.signal))) return;";
const publicMarkedLock = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      marked:
        specifier: ^18.0.14
        version: 18.0.14
packages:
  marked@18.0.14:
    resolution: {integrity: sha512-mBHK6FBHuBAlhgRe88w9F0O1AbwwXJUcQibUbC/QcdTbVGAD7aWza+xt3N6oT/jCZx3/OMeS+8rnuiHZcQ9s7A==}
    engines: {node: '>= 20'}
    hasBin: true
snapshots:
  marked@18.0.14: {}
`;
const configuredMarkedSource = `import { Renderer, Marked } from "marked";
const markdown = new Marked();
markdown.use({ renderer: { code(token) { return Renderer.prototype.code.call(this, token); } } });
export const format = source => markdown.parse(source);`;
const ownedRendererBuilderSource = `import { Renderer, Marked } from "marked";
export const format = source => {
  const records = [];
  const counts = new Map();
  const markdown = new Marked({ gfm: true });
  markdown.use({ renderer: { code(token) {
    const label = token.text;
    const count = (counts.get(label) ?? 0) + 1;
    counts.set(label, count);
    records.push({ label, count });
    return Renderer.prototype.code.call(this, token);
  } } });
  const html = markdown.parse(source, { async: false });
  return { html, records };
};`;
const formattedRendererBuilderSource = ownedRendererBuilderSource
  .replace(
    "export const format = source => {",
    'const normalize = value => value.replace(/ +/g, "-").trim().toLowerCase();\nexport const format = source => {',
  )
  .replace("code(token)", "heading(token)")
  .replace(
    "const label = token.text;",
    'const label = this.parser.parseInline(token.tokens); const key = normalize(label); if (key.startsWith("skip")) return ""; if (/^quay/.test(key) && (token.depth >= 1 || key === "quay")) {',
  )
  .replace("counts.get(label)", "counts.get(key)")
  .replace("counts.set(label, count)", "counts.set(key, count)")
  .replace(
    "records.push({ label, count });",
    "records.push({ label, count, key: token.depth === 1 ? `${key}-top` : key }); }",
  )
  .replace("Renderer.prototype.code", "Renderer.prototype.heading");
const cases: ReadonlyArray<ReadonlyPrototypeNativeCase> = [
  {
    name: "owned-builder-exact-void-zero",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource
      .replace("  const records", "  void 0; const records")
      .replace("    const label", "    void 0; const label"),
    expectedWarnings: 0,
  },
  {
    name: "owned-builder-void-call-refusal",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "    const label",
      "    void notify(); const label",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-builder-transparent-fallback-receiver",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "Renderer.prototype.code.call",
      "(Renderer.prototype.code as any).call",
    ),
    expectedWarnings: 0,
  },
  {
    name: "owned-builder-transparent-parser-receiver",
    sdkVersion: "18.0.14",
    fallbackSource: formattedRendererBuilderSource.replace(
      "this.parser.parseInline",
      "(this.parser as any).parseInline",
    ),
    expectedWarnings: 0,
  },
  {
    name: "owned-builder-optional-parser-refusal",
    sdkVersion: "18.0.14",
    fallbackSource: formattedRendererBuilderSource.replace(
      "this.parser.parseInline",
      "(this.parser as any)?.parseInline",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-builder-empty-statements",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource
      .replace("  markdown.use", "  ; (markdown).use")
      .replace("    counts.set", "    ; (counts).set")
      .replace("    records.push", "    ; (records).push"),
    expectedWarnings: 0,
  },
  {
    name: "owned-builder-nonempty-unsupported-statement",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "  markdown.use",
      "  notify(); markdown.use",
    ),
    expectedWarnings: 1,
  },
  {
    name: "used-intrinsic-lexical-writer-anchor",
    sdkVersion: "18.0.14",
    fallbackSource:
      formattedRendererBuilderSource +
      "\nimport {foreign} from 'opaque-app'; const replacement=()=>'';",
    expectedWarnings: 0,
  },
  {
    name: "used-string-opaque-trim-writer",
    sdkVersion: "18.0.14",
    fallbackSource:
      formattedRendererBuilderSource +
      "\nimport {foreign} from 'opaque-app'; const replacement=()=>''; foreign().trim = replacement;",
    expectedWarnings: 1,
  },
  {
    name: "used-regexp-opaque-test-reflection",
    sdkVersion: "18.0.14",
    fallbackSource:
      formattedRendererBuilderSource +
      "\nimport {foreign} from 'opaque-app'; const replacement=()=>''; Object.defineProperty(foreign(), 'test', {value: replacement});",
    expectedWarnings: 1,
  },
  {
    name: "unrelated-class-baseline",
    fallbackSource: "export const format = token => token;",
    expectedWarnings: 0,
  },
  { name: "source-owned-readonly-prototype", expectedWarnings: 0 },
  {
    name: "source-prototype-getter",
    constructorSource: "export const Renderer = class { get render() { return foreign; } };",
    expectedWarnings: 1,
  },
  {
    name: "source-prototype-writer",
    fallbackSource:
      'import { Renderer } from "./renderer"; Renderer.prototype.render = foreign; export const format = token => Renderer.prototype.render.call(this, token);',
    expectedWarnings: 1,
  },
  {
    name: "source-method-callback-escape",
    fallbackSource:
      'import { Renderer } from "./renderer"; export const format = Renderer.prototype.render;',
    expectedWarnings: 1,
  },
  {
    name: "source-call-requires-fresh-barrier",
    body: `${freshBarrier} Renderer.prototype.render.call(null, token); setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "source-call-with-fresh-barrier",
    body: `${freshBarrier} Renderer.prototype.render.call(null, token); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 0,
  },
  {
    name: "owned-renderer-builder-scalar-records-and-counts",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource,
    expectedWarnings: 0,
  },
  {
    name: "owned-renderer-builder-readonly-container-aliases",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource
      .replace(
        "  const markdown",
        "  const ownedRecords = records; const ownedCounts = counts;\n  const markdown",
      )
      .replace("counts.get", "ownedCounts.get")
      .replace("counts.set", "ownedCounts.set")
      .replace("records.push", "ownedRecords.push"),
    expectedWarnings: 0,
  },
  {
    name: "owned-renderer-builder-call-requires-fresh-barrier",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource,
    entryImports: 'import { format } from "./fallback";',
    body: `${freshBarrier} format("quay"); setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-call-with-fresh-barrier",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource,
    entryImports: 'import { format } from "./fallback";',
    body: `${freshBarrier} format("quay"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 0,
  },
  {
    name: "owned-renderer-builder-formatted-conditional-records",
    sdkVersion: "18.0.14",
    fallbackSource: formattedRendererBuilderSource,
    expectedWarnings: 0,
  },
  {
    name: "owned-renderer-builder-conditional-publication",
    sdkVersion: "18.0.14",
    fallbackSource: formattedRendererBuilderSource.replace(
      "records.push({ label, count, key: token.depth === 1 ? `${key}-top` : key });",
      "records.push({ label, count, key: token.depth === 1 ? `${key}-top` : key }); publish(records);",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-mutable-module-helper",
    sdkVersion: "18.0.14",
    fallbackSource:
      formattedRendererBuilderSource.replace("const normalize", "let normalize") +
      "\nnormalize = foreign;",
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-link-href-data",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource
      .replace("code(token)", "link(token)")
      .replace("const label = token.text", "const label = token.href")
      .replace("Renderer.prototype.code", "Renderer.prototype.link"),
    expectedWarnings: 0,
  },
  {
    name: "owned-renderer-builder-image-nullable-title-data",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource
      .replace("code(token)", "image(token)")
      .replace("const label = token.text", "const label = token.title ?? token.text")
      .replace("Renderer.prototype.code", "Renderer.prototype.image"),
    expectedWarnings: 0,
  },
  {
    name: "owned-renderer-builder-native-array-seed",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "const records = [];",
      "const records = [new AbortController()];",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-native-map-insertion",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "counts.set(label, count)",
      "counts.set(label, new AbortController())",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-preparse-publication",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "  const html",
      "  publish(records);\n  const html",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-postparse-call",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "  return { html, records };",
      "  markdown.parse(source, { async: false }); return { html, records };",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-live-parser-return",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "return { html, records }",
      "return { html, records, later: () => markdown.parse(source, { async: false }) }",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-async-parse",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace("async: false", "async: true"),
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-counter-map-return",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource.replace(
      "return { html, records }",
      "return { html, records, counts }",
    ),
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-map-global-replacement",
    sdkVersion: "18.0.14",
    fallbackSource: ownedRendererBuilderSource + "\nglobalThis.Map = foreign;",
    expectedWarnings: 1,
  },
  {
    name: "owned-renderer-builder-array-push-replacement",
    sdkVersion: "18.0.14",
    fallbackSource:
      ownedRendererBuilderSource + "\nObject.defineProperty(foreign(), 'push', {value: foreign});",
    expectedWarnings: 1,
  },
  { name: "exact-marked-source-role", sdkVersion: "18.0.14", expectedWarnings: 0 },
  {
    name: "marked-owned-renderer-configuration",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    expectedWarnings: 0,
  },
  {
    name: "marked-constructor-and-parse-inline-options",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource
      .replace("new Marked()", "new Marked({ gfm: true, breaks: false })")
      .replace("markdown.parse(source)", "markdown.parse(source, { async: false })"),
    expectedWarnings: 0,
  },
  {
    name: "marked-constructor-options-getter",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "new Marked()",
      "new Marked({ get gfm() { return foreign(); } })",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-constructor-options-spread",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "new Marked()",
      "new Marked({ ...foreign, gfm: true })",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-parse-options-getter",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "markdown.parse(source)",
      "markdown.parse(source, { get async() { return foreign(); } })",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-configuration-unknown-release",
    sdkVersion: "18.0.15",
    fallbackSource: configuredMarkedSource,
    expectedWarnings: 1,
  },
  {
    name: "marked-renderer-config-getter",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "renderer: { code(token)",
      "get renderer() { return foreign; }, ignored: { code(token)",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-renderer-config-spread",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "renderer: { code(token)",
      "...foreign, renderer: { code(token)",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-renderer-instance-publication",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "markdown.use",
      "publish(markdown); markdown.use",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-owned-instance-method-mutation",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "markdown.use",
      "markdown.parse = foreign; markdown.use",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-renderer-this-constructor-escape",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "return Renderer.prototype",
      "publish(this.constructor); return Renderer.prototype",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-renderer-parser-renderer-escape",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "return Renderer.prototype",
      "publish(this.parser.renderer); return Renderer.prototype",
    ),
    expectedWarnings: 1,
  },
  {
    name: "marked-parse-requires-fresh-barrier",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      "const markdown = new Marked(); markdown.use({ renderer: { code(token) { return Renderer.prototype.code.call(this, token); } } });",
    body: `${freshBarrier} markdown.parse("tile"); setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "marked-parse-with-fresh-barrier",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      "const markdown = new Marked(); markdown.use({ renderer: { code(token) { return Renderer.prototype.code.call(this, token); } } });",
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 0,
  },
  {
    name: "marked-configured-callback-state-capture",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'const markdown = new Marked(); markdown.use({ renderer: { code(token) { setStatus("early"); return Renderer.prototype.code.call(this, token); } } });',
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "marked-configured-callback-hidden-async-capture",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'const markdown = new Marked(); markdown.use({ renderer: { code(token) { void (async () => { await foreign(); setStatus("stale"); })(); return Renderer.prototype.code.call(this, token); } } });',
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "marked-callback-mutable-object-state-capture",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'let holder = { launch: async () => { await foreign(); setStatus("stale"); } }; const markdown = new Marked(); markdown.use({renderer:{code(token){holder.launch();return Renderer.prototype.code.call(this,token);}}});',
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "marked-owned-renderer-parser-callback",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource.replace(
      "renderer: { code(token)",
      "renderer: { paragraph({ tokens }) { return this.parser.parseInline(tokens); }, code(token)",
    ),
    expectedWarnings: 0,
  },
  {
    name: "marked-callback-readonly-container-state-capture",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'const holder = { launch: async () => { await foreign(); setStatus("stale"); } }; const markdown = new Marked(); markdown.use({renderer:{code(token){holder.launch();return Renderer.prototype.code.call(this,token);}}});',
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "marked-callback-mutated-container-publication",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'const holder = {}; holder.launch = async () => { await foreign(); setStatus("stale"); }; const markdown = new Marked(); markdown.use({renderer:{code(token){foreign(holder);return Renderer.prototype.code.call(this,token);}}});',
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "marked-callback-mutated-const-object-state-capture",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'const holder = {}; holder.launch = async () => { await foreign(); setStatus("stale"); }; const markdown = new Marked(); markdown.use({renderer:{code(token){holder.launch();return Renderer.prototype.code.call(this,token);}}});',
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "marked-constructor-config-callback-capture",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'const markdown = new Marked({ renderer: { code(token) { void (async () => { await foreign(); setStatus("stale"); })(); return ""; } } });',
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 1,
  },
  { name: "unselected-marked-caret", sdkVersion: "^18.0.14", expectedWarnings: 1 },
  {
    name: "locked-marked-caret",
    sdkVersion: "^18.0.14",
    lockSource: publicMarkedLock,
    expectedWarnings: 0,
  },
  {
    name: "wrong-marked-lock-selection",
    sdkVersion: "^18.0.14",
    lockSource: publicMarkedLock.replaceAll("18.0.14", "18.0.15"),
    expectedWarnings: 1,
  },
  { name: "unknown-marked-release", sdkVersion: "18.0.15", expectedWarnings: 1 },
  {
    name: "marked-constructor-publication",
    sdkVersion: "18.0.14",
    fallbackSource:
      'import { Renderer } from "marked"; publish(Renderer); export const format = token => Renderer.prototype.code.call(this, token);',
    expectedWarnings: 1,
  },
  {
    name: "marked-alternate-constructor-writer",
    sdkVersion: "18.0.14",
    fallbackSource:
      'import { Renderer, marked } from "marked"; marked.Renderer.prototype.code = foreign; export const format = token => Renderer.prototype.code.call(this, token);',
    expectedWarnings: 1,
  },
  {
    name: "marked-method-callback-escape",
    sdkVersion: "18.0.14",
    fallbackSource:
      'import { Renderer } from "marked"; export const format = Renderer.prototype.code;',
    expectedWarnings: 1,
  },
  {
    name: "marked-call-requires-fresh-barrier",
    sdkVersion: "18.0.14",
    body: `${freshBarrier} Renderer.prototype.code.call(null, token); setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "marked-call-with-fresh-barrier",
    sdkVersion: "18.0.14",
    body: `${freshBarrier} Renderer.prototype.code.call(null, token); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 0,
  },
];

afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("readonly prototype provenance with native waits", () => {
  it.each(cases)("checks $name", async (testCase) => {
    const constructorSource = testCase.sdkVersion ? "marked" : "./renderer";
    const fallback = testCase.sdkVersion
      ? 'import { Renderer } from "marked"; export const format = token => Renderer.prototype.code.call(this, token);'
      : 'import { Renderer } from "./renderer"; export const format = token => Renderer.prototype.render.call(this, token);';
    const rootDirectory = setupReactProject(temporaryDirectory, testCase.name, {
      packageJsonExtras: {
        packageManager: "pnpm@10.32.1",
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          next: "^16.0.0",
          ...(testCase.sdkVersion ? { marked: testCase.sdkVersion } : {}),
        },
      },
      files: {
        ...(testCase.lockSource ? { "pnpm-lock.yaml": testCase.lockSource } : {}),
        ...(testCase.sdkVersion
          ? {}
          : {
              "src/renderer.ts":
                testCase.constructorSource ??
                "export const Renderer = class { render(token) { return token; } };",
            }),
        "src/fallback.ts": testCase.fallbackSource ?? fallback,
        "src/App.tsx": `import { useEffect, useState } from "react";
import { Renderer${testCase.sdkVersion ? ", Marked" : ""} } from "${constructorSource}";
${testCase.entryImports ?? ""}
const pause = (milliseconds, signal) => new Promise(settle => {
  if (signal.aborted) { settle(false); return; }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", cancel);
    settle(true);
  }, milliseconds);
  const cancel = () => { clearTimeout(timer); settle(false); };
  signal.addEventListener("abort", cancel, { once: true });
});
export const App = ({ revision, token }) => {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    ${testCase.setup ?? ""}
    const run = async () => {
      ${testCase.body ?? `${freshBarrier} setStatus("ready");`}
    };
    void run();
    return () => controller.abort();
  }, [revision]);
  return <div>{status}</div>;
};`,
      },
    });
    assertNativeSyntaxSuccess(rootDirectory);
    const diagnostics = await runOxlint({
      rootDirectory,
      project: buildTestProject({ rootDirectory, framework: "vite" }),
      userConfig: { rules: { "react-doctor/no-set-state-after-await-in-effect": "warn" } },
      perFileLintCacheEnabled: false,
      sidecarLintCacheEnabled: false,
    });
    const warnings = diagnostics.filter(
      (diagnostic) =>
        diagnostic.rule === "no-set-state-after-await-in-effect" &&
        diagnostic.filePath === "src/App.tsx",
    );
    expect(warnings).toHaveLength(testCase.expectedWarnings);
  });
});
