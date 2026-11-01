import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface ContinuationFixture {
  directory: string;
  filename: string;
  source: string;
}

interface EffectResourceGuardCase {
  name: string;
  prefix?: string;
  signalDeclaration?: string;
  signalExpression?: string;
  expectedWarnings: number;
}

interface ReadonlyPrototypeContinuationCase {
  name: string;
  constructorSource?: string;
  fallbackSource?: string;
  body?: string;
  setup?: string;
  sdkVersion?: string;
  expectedWarnings: number;
  entryImports?: string;
}

const freshBarrier = "if (!(await pause(24, controller.signal))) return;";

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
const readonlyPrototypeCases: ReadonlyArray<ReadonlyPrototypeContinuationCase> = [
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
    name: "unrelated source class baseline",
    fallbackSource: "export const format = (token) => token;",
    expectedWarnings: 0,
  },
  { name: "source-owned readonly prototype fallback", expectedWarnings: 0 },
  {
    name: "native constructor alias",
    constructorSource: "export const Renderer = AbortController;",
    expectedWarnings: 1,
  },
  {
    name: "prototype own getter",
    constructorSource: "export const Renderer = class { get render() { return foreign; } };",
    expectedWarnings: 1,
  },
  {
    name: "prototype writer",
    fallbackSource:
      'import { Renderer } from "./renderer"; Renderer.prototype.render = foreign; export const format = token => Renderer.prototype.render.call(this, token);',
    expectedWarnings: 1,
  },
  {
    name: "prototype method callback escape",
    fallbackSource:
      'import { Renderer } from "./renderer"; export const format = Renderer.prototype.render;',
    expectedWarnings: 1,
  },
  {
    name: "readonly prototype call invalidates liveness",
    body: `${freshBarrier} Renderer.prototype.render.call(null, "tile"); setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "fresh barrier after readonly prototype call",
    body: `${freshBarrier} Renderer.prototype.render.call(null, "tile"); ${freshBarrier} setStatus("ready");`,
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
  {
    name: "genuine Marked owned renderer configuration",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    expectedWarnings: 0,
  },
  {
    name: "genuine Marked constructor and parse boolean options",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource
      .replace("new Marked()", "new Marked({ gfm: true, breaks: false })")
      .replace("markdown.parse(source)", "markdown.parse(source, { async: false })"),
    expectedWarnings: 0,
  },
  {
    name: "unknown Marked release configuration",
    sdkVersion: "18.0.15",
    fallbackSource: configuredMarkedSource,
    expectedWarnings: 1,
  },
  {
    name: "Marked parse invalidates liveness",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup: "const markdown = new Marked();",
    body: `${freshBarrier} markdown.parse("tile"); setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "fresh barrier after Marked parse",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup: "const markdown = new Marked();",
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 0,
  },
  {
    name: "Marked renderer callback captures selected state",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'const markdown = new Marked(); markdown.use({renderer:{code(token){setStatus("early");return Renderer.prototype.code.call(this,token);}}});',
    body: `${freshBarrier} markdown.parse("tile"); ${freshBarrier} setStatus("ready");`,
    expectedWarnings: 1,
  },
  {
    name: "Marked constructor callback launches hidden state work",
    sdkVersion: "18.0.14",
    fallbackSource: configuredMarkedSource,
    setup:
      'const markdown = new Marked({renderer:{code(token){void(async()=>{await foreign();setStatus("stale");})();return "";}}});',
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
];

const resourceGuardCases: ReadonlyArray<EffectResourceGuardCase> = [
  { name: "existing quiet native wait", expectedWarnings: 0 },
  {
    name: "leading native ref guard",
    prefix: "if (!branch || !host.current) return;",
    expectedWarnings: 0,
  },
  {
    name: "readonly signal destructure",
    signalDeclaration: "const { signal } = controller;",
    signalExpression: "signal",
    expectedWarnings: 0,
  },
  {
    name: "guard and signal destructure",
    prefix: "if (!branch || !host.current) return;",
    signalDeclaration: "const { signal } = controller;",
    signalExpression: "signal",
    expectedWarnings: 0,
  },
  {
    name: "renamed signal destructure",
    signalDeclaration: "const { signal: ownedSignal } = controller;",
    signalExpression: "ownedSignal",
    expectedWarnings: 0,
  },
  {
    name: "readonly copy of destructured signal",
    signalDeclaration: "const { signal } = controller; const ownedSignal = signal;",
    signalExpression: "ownedSignal",
    expectedWarnings: 0,
  },
  {
    name: "multiple leading guards",
    prefix: "if (!branch) return; if (!host.current) { return; }",
    expectedWarnings: 0,
  },
  { name: "call in leading guard", prefix: "if (!isEnabled()) return;", expectedWarnings: 1 },
  {
    name: "work before leading guard",
    prefix: "notify(); if (!branch) return;",
    expectedWarnings: 1,
  },
  { name: "leading return value", prefix: "if (!branch) return () => {};", expectedWarnings: 1 },
  { name: "leading alternate exit", prefix: "if (branch) {} else return;", expectedWarnings: 1 },
  {
    name: "guard after controller acquisition",
    signalDeclaration: "if (!branch) return;",
    expectedWarnings: 1,
  },
  {
    name: "mutable signal destructure",
    signalDeclaration: "let { signal } = controller;",
    signalExpression: "signal",
    expectedWarnings: 1,
  },
  {
    name: "computed signal destructure",
    signalDeclaration: "const { ['signal']: signal } = controller;",
    signalExpression: "signal",
    expectedWarnings: 1,
  },
  {
    name: "signal destructure default",
    signalDeclaration: "const { signal = foreignSignal } = controller;",
    signalExpression: "signal",
    expectedWarnings: 1,
  },
  {
    name: "signal destructure rest",
    signalDeclaration: "const { signal, ...rest } = controller;",
    signalExpression: "signal",
    expectedWarnings: 1,
  },
  {
    name: "signal publication",
    signalDeclaration: "const { signal } = controller; publish(signal);",
    signalExpression: "signal",
    expectedWarnings: 1,
  },
  {
    name: "signal pattern mutation",
    signalDeclaration: "const { signal } = controller; ({ next: signal.aborted } = foreign);",
    signalExpression: "signal",
    expectedWarnings: 1,
  },
  {
    name: "signal iteration escape",
    signalDeclaration: "const { signal } = controller; for (const item of signal) {}",
    signalExpression: "signal",
    expectedWarnings: 1,
  },
];

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "react-doctor-native-continuation-"),
);
let fixtureIndex = 0;
const delaySource = `
const pause = (milliseconds, signal) => new Promise((settle) => {
  if (signal.aborted) { settle(false); return; }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", cancel);
    settle(true);
  }, milliseconds);
  const cancel = () => { clearTimeout(timer); settle(false); };
  signal.addEventListener("abort", cancel, { once: true });
});`;

const createFixture = (
  body: string,
  producer = delaySource,
  cleanup = "controller.abort()",
  helpers = "",
  nativeHostTemplate?: string,
  resourcePrefix = "",
  extraModules: Readonly<Record<string, string>> = {},
): ContinuationFixture => {
  fixtureIndex += 1;
  const directory = path.join(temporaryDirectory, String(fixtureIndex));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", next: "^16.0.0" } }),
  );
  const filename = path.join(directory, "panel.tsx");
  const source = `import { useEffect, useState${nativeHostTemplate ? ", useRef" : ""} } from "react";
    ${producer}
    export const Panel = ({ revision, branch }) => {
      ${nativeHostTemplate ? "const host = useRef(null);" : ""}
      const [status, setStatus] = useState("");
      useEffect(() => {
        ${resourcePrefix}
        const controller = new AbortController();
        ${helpers}
        const run = async () => { ${body} };
        run();
        return () => ${cleanup};
      }, [revision, branch]);
      return ${nativeHostTemplate ?? "<div>{status}</div>"};
    };`;
  fs.writeFileSync(filename, source);
  for (const [relativePath, moduleSource] of Object.entries(extraModules)) {
    const modulePath = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, moduleSource);
  }
  return { directory, filename, source };
};

const diagnosticsFor = (fixture: ContinuationFixture, useHostWrapper = false): number => {
  const rule = useHostWrapper
    ? wrapWithSemanticContext(noSetStateAfterAwaitInEffect)
    : noSetStateAfterAwaitInEffect;
  const result = runRule(rule, fixture.source, {
    filename: fixture.filename,
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

describe("closed native wait continuation certificate", () => {
  beforeEach(() => resetFilesystemCaches());
  afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  it.each([
    { helpers: "", expectedWarnings: 0 },
    {
      helpers: 'queueMicrotask(() => setStatus("queued"));',
      expectedWarnings: 1,
    },
    {
      helpers: 'Promise.resolve().then(() => setStatus("queued"));',
      expectedWarnings: 1,
    },
  ])("preserves deferred writes beside a certified wait: $helpers", (testCase) => {
    const fixture = createFixture(
      `${freshBarrier} setStatus("ready");`,
      delaySource,
      "controller.abort()",
      testCase.helpers,
    );
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([
      testCase.expectedWarnings,
      testCase.expectedWarnings,
    ]);
  });

  it.each([
    {
      name: "catch suspension before an abrupt exit still reaches finally",
      body: 'try { throw failure; } catch { await load(); return; } finally { setStatus("late"); }',
      expectedWarnings: 1,
    },
    {
      name: "a pure try return cannot enter its catch",
      body: 'try { return; } catch { await load(); return; } finally { setStatus("sync"); }',
      expectedWarnings: 0,
    },
    {
      name: "catch work before its first await remains synchronous",
      body: 'try { throw failure; } catch { setStatus("sync"); await load(); return; } finally {}',
      expectedWarnings: 0,
    },
    {
      name: "an inner handled throw cannot enter the outer catch",
      body: 'try { try { throw failure; } catch {} return; } catch { await load(); return; } finally { setStatus("sync"); }',
      expectedWarnings: 0,
    },
    {
      name: "contradictory throw and catch branches cannot suspend",
      body: 'try { if (branch) throw failure; return; } catch { if (!branch) await load(); return; } finally { setStatus("sync"); }',
      expectedWarnings: 0,
    },
    {
      name: "a throwing catch binding cannot reach its await",
      body: 'try { throw null; } catch ({ message }) { await load(); return; } finally { setStatus("sync"); }',
      expectedWarnings: 0,
    },
    {
      name: "throw still executes finally",
      body: 'try { await load(); throw failure; } finally { await load(); setStatus("late"); }',
      expectedWarnings: 1,
    },
    {
      name: "return inside finally stops later work",
      body: 'try { await load(); return; } finally { return; await load(); setStatus("dead"); }',
      expectedWarnings: 0,
    },
    {
      name: "static false branch inside finally",
      body: 'try { await load(); return; } finally { if (false) { await load(); setStatus("dead"); } }',
      expectedWarnings: 0,
    },
    {
      name: "return through finally stops following work",
      body: 'try { await load(); return; } finally { await load(); } setStatus("dead");',
      expectedWarnings: 0,
    },
    {
      name: "try after return is unreachable",
      body: 'return; try { return; } finally { await load(); setStatus("dead"); }',
      expectedWarnings: 0,
    },
    {
      name: "nested finally still executes",
      body: 'try { await load(); return; } finally { try { return; } finally { await load(); setStatus("late"); } }',
      expectedWarnings: 1,
    },
    {
      name: "nested return through finally stops following work",
      body: 'try { await load(); return; } finally { try { return; } finally { await load(); } setStatus("dead"); }',
      expectedWarnings: 0,
    },
  ])("preserves finalizer reachability: $name", (testCase) => {
    const fixture = createFixture(testCase.body);
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([
      testCase.expectedWarnings,
      testCase.expectedWarnings,
    ]);
  });

  it.each([
    { finalizer: "", following: 'setStatus("ready");', expectedWarnings: 0 },
    { finalizer: 'setStatus("late");', following: "", expectedWarnings: 1 },
  ])("keeps abrupt finalizer paths separate from following work: $finalizer", (testCase) => {
    const fixture = createFixture(
      `await load(); try { if (!active) return; } finally { ${testCase.finalizer} } ${testCase.following}`,
      delaySource,
      "{ active = false; }",
      "let active = true;",
    );
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([
      testCase.expectedWarnings,
      testCase.expectedWarnings,
    ]);
  });

  it.each([".constructor", "['constructor']"])(
    "refuses a function code-constructor gateway %s without an SDK module",
    (access) => {
      const fixture = createFixture(
        `${freshBarrier} setStatus("ready");`,
        delaySource,
        "controller.abort()",
        `const makeCode = (() => {})${access}; makeCode('globalThis.setTimeout = replacement')();`,
      );
      expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([1, 1]);
    },
  );

  it.each([
    "const makeCode = Object.constructor;",
    "const makeCode = Array.constructor;",
    "const makeCode = ''.slice.constructor;",
    "const makeCode = Math.max.constructor;",
    "const { constructor: makeCode } = () => {};",
    "const makeCode = Reflect.get(() => {}, 'constructor');",
  ])("refuses native/reflected code-constructor extraction %s without an SDK", (setup) => {
    const fixture = createFixture(
      `${freshBarrier} setStatus("ready");`,
      delaySource,
      "controller.abort()",
      setup + " makeCode('globalThis.setTimeout = replacement')();",
    );
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([1, 1]);
  });

  it.each([
    'const chooseName = () => "constructor"; const [Carrier] = [() => {}]; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = () => {}; const {[chooseName()]: makeCode} = Carrier;',
    'const chooseName = () => "constructor"; const Carrier = () => {}; const {nested:{[chooseName()]: makeCode}} = {nested: Carrier};',
    'const chooseName = () => "constructor"; let Carrier; Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; let Carrier = 1; Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; let Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; var Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; let Carrier = class {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; var Carrier = class {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; let Carrier = () => {}; Carrier = Carrier; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; function Carrier() {} const Alias = Carrier; const makeCode = Alias[chooseName()];',
    'const chooseName = () => "constructor"; class Carrier {} const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = class {}; const Alias = Carrier; const makeCode = Alias[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = Object; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = Math.max; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = "".slice; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = Math.max.bind(null); const makeCode = Carrier[chooseName()];',
  ])("refuses unknown computed callable property extraction %s without an SDK", (setup) => {
    const fixture = createFixture(
      `${freshBarrier} setStatus("ready");`,
      delaySource + "\n" + setup + " makeCode('globalThis.setTimeout = replacement')();",
      "controller.abort()",
    );
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([1, 1]);
  });

  it.each([
    'const chooseName = () => "label"; const record = {label:"quay"}; const result = record[chooseName()];',
    'const chooseName = () => "label"; const Math = {max:{label:"quay"}}; const result = Math.max[chooseName()];',
    "const Carrier = () => {}; const { name: label } = Carrier;",
    "const Carrier = () => {}; const result = Carrier.name;",
  ])("keeps ordinary data/static member access %s without an SDK", (setup) => {
    const fixture = createFixture(
      `${freshBarrier} setStatus("ready");`,
      delaySource + "\n" + setup,
      "controller.abort()",
    );
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([0, 0]);
  });

  it.each(readonlyPrototypeCases)("closes native globals for $name", (testCase) => {
    const fixture = createFixture(
      testCase.body ?? `${freshBarrier} setStatus("ready");`,
      `${delaySource} import { Renderer${testCase.sdkVersion ? ", Marked" : ""} } from "${testCase.sdkVersion ? "marked" : "./renderer"}"; ${testCase.entryImports ?? ""}`,
      "controller.abort()",
      testCase.setup ?? "",
      undefined,
      "",
      {
        "renderer.ts":
          testCase.constructorSource ??
          "export const Renderer = class { render(token) { return token; } };",
        "fallback.ts":
          testCase.fallbackSource ??
          'import { Renderer } from "./renderer"; export const format = token => Renderer.prototype.render.call(this, token);',
      },
    );
    if (testCase.sdkVersion) {
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            next: "^16.0.0",
            marked: testCase.sdkVersion,
          },
        }),
      );
    }
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([
      testCase.expectedWarnings,
      testCase.expectedWarnings,
    ]);
  });

  it.each(resourceGuardCases)("handles resource ownership for $name", (testCase) => {
    const fixture = createFixture(
      `if (!(await pause(24, ${testCase.signalExpression ?? "controller.signal"}))) return; setStatus("ready");`,
      delaySource,
      "controller.abort()",
      testCase.signalDeclaration,
      "<div ref={host}><span>Panel</span></div>",
      testCase.prefix,
    );
    expect(diagnosticsFor(fixture)).toBe(testCase.expectedWarnings);
    expect(diagnosticsFor(fixture, true)).toBe(testCase.expectedWarnings);
  });

  it("keeps the state-only native wait baseline quiet with an opaque child", () => {
    const fixture = createFixture(
      `${freshBarrier} setStatus("ready");`,
      `${delaySource} const OpaqueChild = () => <x-widget />;`,
      "controller.abort()",
      "",
      "<div ref={host}><OpaqueChild /></div>",
    );
    expect(diagnosticsFor(fixture)).toBe(0);
    expect(diagnosticsFor(fixture, true)).toBe(0);
  });

  it("reads a closed native host ref before acquiring work despite opaque children", () => {
    const fixture = createFixture(
      `${freshBarrier} setStatus("ready");`,
      `${delaySource} const OpaqueChild = () => <x-widget />;`,
      "controller.abort()",
      "",
      "<div ref={host}><OpaqueChild /></div>",
      "if (!branch || !host.current) return;",
    );
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([0, 0]);
  });

  it.each(["native", "canonical"])(
    "uses the authoritative current source for a leading ref guard with a %s filename",
    (filenameStyle) => {
      const fixture = createFixture(
        `${freshBarrier} setStatus("ready");`,
        delaySource,
        "controller.abort()",
        "",
        "<div ref={host} />",
        "if (!branch || !host.current) return;",
      );
      const filename =
        filenameStyle === "canonical" ? normalizeFilename(fixture.filename) : fixture.filename;
      const safeSource = fixture.source;
      const unsafeSource = safeSource.replace(
        "const host = useRef(null);",
        "const host = useRef(null); publish(host);",
      );
      for (const diskSource of [safeSource, unsafeSource]) {
        fs.writeFileSync(fixture.filename, diskSource);
        for (const currentSource of [
          { source: safeSource, expectedWarnings: 0 },
          { source: unsafeSource, expectedWarnings: 1 },
        ]) {
          resetFilesystemCaches();
          const currentFixture = { ...fixture, filename, source: currentSource.source };
          expect([diagnosticsFor(currentFixture), diagnosticsFor(currentFixture, true)]).toEqual([
            currentSource.expectedWarnings,
            currentSource.expectedWarnings,
          ]);
        }
      }
    },
  );

  it("still refuses cloning an opaque child subtree after a closed ref read", () => {
    const fixture = createFixture(
      `${freshBarrier} const duplicate = host.current.cloneNode(true); setStatus("ready");`,
      `${delaySource} const OpaqueChild = () => <x-widget />;`,
      "controller.abort()",
      "",
      "<div ref={host}><OpaqueChild /></div>",
      "if (!branch || !host.current) return;",
    );
    expect(diagnosticsFor(fixture)).toBe(1);
    expect(diagnosticsFor(fixture, true)).toBe(1);
  });

  it("admits a fresh true native timer result followed by a primitive state write", () => {
    expect(diagnosticsFor(createFixture(`${freshBarrier} setStatus("ready");`))).toBe(0);
  });

  it("uses the semantic host program without requiring a sourceCode property", () => {
    expect(diagnosticsFor(createFixture(`${freshBarrier} setStatus("ready");`), true)).toBe(0);
  });

  it.each([
    [
      "block const lexical shadow",
      "{ const Object = { getPrototypeOf: () => ({}) }; Object.getPrototypeOf({}); }",
      0,
    ],
    [
      "ordinary function-body shadow",
      "const inspectLocal = () => { function Object() { return {}; } return Object(); }; inspectLocal();",
      0,
    ],
    [
      "closed own record descriptor",
      "const record = {}; Object.defineProperty(record, 'addEventListener', { value: replacement });",
      0,
    ],
    [
      "direct global reflection writer",
      "Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
      1,
    ],
    [
      "block function reflection writer",
      "{ function Object() {} } Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
      1,
    ],
    [
      "block function listener removal writer",
      "{ function Object() {} } Object.getPrototypeOf(new AbortController().signal).removeEventListener = foreign;",
      1,
    ],
    [
      "erased reflection type",
      "type Object = {}; Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
      1,
    ],
    [
      "ambient reflection binding",
      "declare const Object: any; Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
      1,
    ],
    ["erased eval binding", "type eval = {}; eval('patchNativeGlobals()');", 1],
    [
      "block enum dynamic-code binding",
      "{ enum Function { Local } } new Function('patchNativeGlobals()')();",
      1,
    ],
    [
      "namespace import-equals dynamic-code binding",
      "namespace Container { import Function = Utilities.create; } new Function('patchNativeGlobals()')();",
      1,
    ],
    [
      "namespace var dynamic-code binding",
      "namespace Container { var Function = Utilities.create; } new Function('patchNativeGlobals()')();",
      1,
    ],
    [
      "static block var dynamic-code binding",
      "class Holder { static { var Function; } } new Function('patchNativeGlobals()')();",
      1,
    ],
    [
      "opaque signal intrinsic writer",
      "foreign(new AbortController().signal).addEventListener = replacement;",
      1,
    ],
    [
      "opaque adoption constructor writer",
      "foreign(new Promise(() => {})).constructor = replacement;",
      1,
    ],
    [
      "destructured reflection capability",
      "const { defineProperty: change } = Object; change(foreign(), 'addEventListener', { value: replacement });",
      1,
    ],
  ])(
    "closes source-global facts for %s in raw and semantic hosts",
    (_label, sourceSetup, expectedWarnings) => {
      const fixture = createFixture(`${freshBarrier} setStatus("ready");`);
      fixture.source = `${sourceSetup}\n${fixture.source}`;
      fs.writeFileSync(fixture.filename, fixture.source);
      expect(diagnosticsFor(fixture)).toBe(expectedWarnings);
      expect(diagnosticsFor(fixture, true)).toBe(expectedWarnings);
    },
  );

  it("admits a readonly boolean result guard", () => {
    expect(
      diagnosticsFor(
        createFixture(
          'const ready = await pause(24, controller.signal); if (!ready) return; setStatus("ready");',
        ),
      ),
    ).toBe(0);
  });

  it("admits an explicit current same-signal guard after unknown work", () => {
    expect(
      diagnosticsFor(
        createFixture('await load(); if (controller.signal.aborted) return; setStatus("ready");'),
      ),
    ).toBe(0);
  });

  it("admits a terminal helper wait when the caller crosses a fresh barrier", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `await tail(controller.signal); ${freshBarrier} setStatus("ready");`,
          delaySource,
          "controller.abort()",
          "const tail = async (signal) => { await pause(24, signal); };",
        ),
      ),
    ).toBe(0);
  });

  it.each([
    {
      name: "closed modulo transfer",
      mutation: "position.current = (position.current + 1) % parts.length;",
      expectedWarnings: 0,
    },
    { name: "literal reset", mutation: "position.current = 1;", expectedWarnings: 0 },
    { name: "out of bounds reset", mutation: "position.current = 2;", expectedWarnings: 1 },
    { name: "opaque write", mutation: "position.current = unknownIndex;", expectedWarnings: 1 },
    { name: "ref publication", mutation: "publish(position);", expectedWarnings: 1 },
    { name: "array publication", mutation: "publish(parts);", expectedWarnings: 1 },
    { name: "array write", mutation: "parts[0] = foreign;", expectedWarnings: 1 },
  ])("checks private primitive array data: $name", (testCase) => {
    const fixture = createFixture(`${freshBarrier} setStatus("ready");`);
    fixture.source = fixture.source
      .replace("import { useEffect, useState }", "import { useEffect, useState, useRef }")
      .replace("export const Panel = ({ revision, branch }) => {", "export function Panel(props) {")
      .replace(
        "const [status, setStatus]",
        `const position = useRef(0); const selector = \`[data-part=\${parts[position.current]}]\`; ${testCase.mutation} const [status, setStatus]`,
      )
      .replace("[revision, branch]", "[props.revision]");
    fixture.source = "const parts = ['quay', 'ridge'];\n" + fixture.source;
    fs.writeFileSync(fixture.filename, fixture.source);
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([
      testCase.expectedWarnings,
      testCase.expectedWarnings,
    ]);
  });

  it.each([
    { cleanup: "{ return (controller.abort()); }", expectedWarnings: 0 },
    { cleanup: "{ return foreign.abort(); }", expectedWarnings: 1 },
    { cleanup: "{ return controller.abort; }", expectedWarnings: 1 },
    { cleanup: "{ return controller.abort(1); }", expectedWarnings: 1 },
  ])("checks returned cleanup ownership: $cleanup", (testCase) => {
    const fixture = createFixture(
      `${freshBarrier} setStatus("ready");`,
      delaySource,
      testCase.cleanup,
    );
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([
      testCase.expectedWarnings,
      testCase.expectedWarnings,
    ]);
  });

  it.each(["const { signal } = controller;", "const signal = controller.signal;"])(
    "checks repeated acyclic helper references independently through %s",
    (declaration) => {
      const fixture = createFixture(
        'inspectToken(signal); inspectToken(signal); if (!(await pause(24, signal))) return; setStatus("ready");',
        delaySource,
        "controller.abort()",
        `${declaration} const inspectToken = token => { const localToken = token; return localToken.aborted; };`,
      );
      expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([0, 0]);
    },
  );

  it.each([
    "const inspectToken = token => { const localToken = token; return inspectToken(localToken); };",
    "const inspectToken = token => { publish(token); return token.aborted; };",
  ])("retains refusal for recursive or escaping signal references: %s", (helper) => {
    const fixture = createFixture(
      'inspectToken(signal); inspectToken(signal); if (!(await pause(24, signal))) return; setStatus("ready");',
      delaySource,
      "controller.abort()",
      `const { signal } = controller; ${helper}`,
    );
    expect([diagnosticsFor(fixture), diagnosticsFor(fixture, true)]).toEqual([1, 1]);
  });

  it("admits a helper with a forwarded owned signal and its own fresh barrier", () => {
    expect(
      diagnosticsFor(
        createFixture(
          "await update(controller.signal);",
          delaySource,
          "controller.abort()",
          'const update = async (signal) => { if (!(await pause(24, signal))) return; setStatus("ready"); };',
        ),
      ),
    ).toBe(0);
  });

  it("admits real event dispatch followed by a fresh barrier", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `${freshBarrier} document.dispatchEvent(new Event("updated")); ${freshBarrier} setStatus("ready");`,
        ),
      ),
    ).toBe(0);
  });

  it.each(["click()", 'dispatchEvent(new Event("updated"))'])(
    "renews liveness after owned native %s",
    (eventCall) => {
      const fixture = createFixture(
        `${freshBarrier} host.current.${eventCall}; ${freshBarrier} setStatus("ready");`,
        delaySource,
        "controller.abort()",
        "",
        '<button ref={host} type="button">Press</button>',
      );
      expect(diagnosticsFor(fixture, true)).toBe(0);
    },
  );

  it.each(["click()", 'dispatchEvent(new Event("updated"))'])(
    "warns when owned native %s has no later barrier",
    (eventCall) => {
      const fixture = createFixture(
        `${freshBarrier} host.current.${eventCall}; setStatus("late");`,
        delaySource,
        "controller.abort()",
        "",
        '<button ref={host} type="button">Press</button>',
      );
      expect(diagnosticsFor(fixture, true)).toBe(1);
    },
  );

  it.each(["focus()", "activate()"])(
    "refuses unproved ref method %s even with a later barrier",
    (methodCall) => {
      const fixture = createFixture(
        `${freshBarrier} host.current.${methodCall}; ${freshBarrier} setStatus("ready");`,
        delaySource,
        "controller.abort()",
        "",
        '<button ref={host} type="button">Press</button>',
      );
      expect(diagnosticsFor(fixture, true)).toBe(1);
    },
  );

  it("does not reuse a pre-event true wait result as a fresh barrier", () => {
    const fixture = createFixture(
      `const ready = await pause(24, controller.signal); if (!ready) return;
       host.current.click(); if (!ready) return; setStatus("late");`,
      delaySource,
      "controller.abort()",
      "",
      '<button ref={host} type="button">Press</button>',
    );
    expect(diagnosticsFor(fixture, true)).toBe(1);
  });

  it("retains the warning when one post-event branch misses its fresh barrier", () => {
    const fixture = createFixture(
      `${freshBarrier} host.current.click();
       if (branch) { ${freshBarrier} setStatus("ready"); } else { setStatus("late"); }`,
      delaySource,
      "controller.abort()",
      "",
      '<button ref={host} type="button">Press</button>',
    );
    expect(diagnosticsFor(fixture, true)).toBe(1);
  });

  it("admits bounded loop summaries whose every write crosses a fresh barrier", () => {
    expect(
      diagnosticsFor(createFixture(`while (branch) { ${freshBarrier} setStatus("ready"); }`)),
    ).toBe(0);
  });

  it.each([
    ["unguarded false settlement", 'await pause(24, controller.signal); setStatus("ready");'],
    ["reentry after true settlement", `${freshBarrier} notify(); setStatus("ready");`],
    [
      "event after barrier",
      `${freshBarrier} document.dispatchEvent(new Event("updated")); setStatus("ready");`,
    ],
    [
      "unsafe alternate",
      `if (branch) { ${freshBarrier} setStatus("ready"); } else { await load(); setStatus("late"); }`,
    ],
    ["aborted true branch", 'await load(); if (controller.signal.aborted) setStatus("late");'],
    [
      "unsafe finalizer",
      `try { ${freshBarrier} return; } finally { await load(); setStatus("late"); }`,
    ],
    ["false barrier finalizer", `try { ${freshBarrier} } finally { setStatus("late"); }`],
    ["returned setter", 'await load(); return setStatus("late");'],
    ["unsafe loop backedge", `${freshBarrier} while (branch) { setStatus("ready"); notify(); }`],
    ["getter argument", `${freshBarrier} setStatus(external.value);`],
    ["unknown eager updater", `${freshBarrier} setStatus(previous => notify(previous));`],
    [
      "hidden object setter",
      `await load(); const payload = {value: setStatus("late")}; ${freshBarrier} setStatus("ready");`,
    ],
    [
      "hidden array setter",
      `await load(); const payload = [setStatus("late")]; ${freshBarrier} setStatus("ready");`,
    ],
    [
      "hidden constructor setter",
      `await load(); new Foreign(setStatus("late")); ${freshBarrier} setStatus("ready");`,
    ],
    [
      "hidden callee setter",
      `await load(); factory(setStatus("late")).method(); ${freshBarrier} setStatus("ready");`,
    ],
    [
      "hidden computed member setter",
      `await load(); external[setStatus("late")]; ${freshBarrier} setStatus("ready");`,
    ],
    ["nullish reentry", `${freshBarrier} (notify() ?? 0); setStatus("late");`],
    ["nullish suspension", `${freshBarrier} ((await load()) ?? 0); setStatus("late");`],
    ["earlier template coercion", freshBarrier + ' setStatus(`${opaqueObject}${"tail"}`);'],
    [
      "truthy primitive boolean comparison",
      `${freshBarrier} setStatus("ready"); await load(); if (1 === true) return; setStatus("late");`,
    ],
    [
      "falsey primitive boolean comparison",
      `${freshBarrier} setStatus("ready"); await load(); if (0 === false) return; setStatus("late");`,
    ],
    [
      "escaped dispatcher argument",
      `await load(); external(setStatus); ${freshBarrier} setStatus("ready");`,
    ],
    [
      "escaped setter callback",
      `await load(); external(() => setStatus("late")); ${freshBarrier} setStatus("ready");`,
    ],
    [
      "escaped async setter callback",
      `external(async () => { await load(); setStatus("late"); }); ${freshBarrier} setStatus("ready");`,
    ],
  ])("retains the warning for %s", (_label, body) => {
    expect(diagnosticsFor(createFixture(body))).toBe(1);
  });

  it("retains the warning when only the helper has crossed its barrier", () => {
    expect(
      diagnosticsFor(
        createFixture(
          'await tail(controller.signal); setStatus("late");',
          delaySource,
          "controller.abort()",
          "const tail = async (signal) => { await pause(24, signal); };",
        ),
      ),
    ).toBe(1);
  });

  it("retains the warning for a helper tail setter without a renewed guard", () => {
    expect(
      diagnosticsFor(
        createFixture(
          "await tail(controller.signal);",
          delaySource,
          "controller.abort()",
          'const tail = async (signal) => { await pause(24, signal); setStatus("late"); };',
        ),
      ),
    ).toBe(1);
  });

  it("retains the warning for mutable native producer bindings", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `${freshBarrier} setStatus("ready");`,
          delaySource.replace("const pause =", "let pause ="),
        ),
      ),
    ).toBe(1);
  });

  it("retains the warning for postsettlement application work", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `${freshBarrier} setStatus("ready");`,
          delaySource.replace("settle(true);", "settle(true); notify();"),
        ),
      ),
    ).toBe(1);
  });

  it("retains the warning for an async producer wrapper", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `${freshBarrier} setStatus("ready");`,
          delaySource.replace("(milliseconds, signal) =>", "async (milliseconds, signal) =>"),
        ),
      ),
    ).toBe(1);
  });

  it("retains the warning for foreign cleanup cancellation", () => {
    expect(
      diagnosticsFor(
        createFixture(`${freshBarrier} setStatus("ready");`, delaySource, "foreign.abort()"),
      ),
    ).toBe(1);
  });

  it("composes imported imperative state writes with a native barrier", () => {
    const fixture = createFixture(
      `${freshBarrier} panel.current?.commit("tile", true); setStatus("ready");`,
    );
    fixture.source = fixture.source
      .replace("import { useEffect, useState }", "import { useEffect, useState, useRef }")
      .replace("export const Panel", 'import { Board } from "./board"; export const Panel')
      .replace("const [status, setStatus]", "const panel = useRef(null); const [status, setStatus]")
      .replace("<div>{status}</div>", "<><Board apiRef={panel} /><div>{status}</div></>");
    fs.writeFileSync(fixture.filename, fixture.source);
    const childFilename = path.join(fixture.directory, "board.tsx");
    const childSource = `import { useState, useImperativeHandle } from "react";
      export const Board = ({ apiRef }) => {
        const [flags, setFlags] = useState({});
        useImperativeHandle(apiRef, () => ({
          commit: (key, value) => setFlags(previous => ({ ...previous, [key]: value })),
          focus: () => externalFocus(),
        }), []);
        return <div />;
      };`;
    fs.writeFileSync(childFilename, childSource);
    expect(diagnosticsFor(fixture)).toBe(0);
    expect(diagnosticsFor(fixture, true)).toBe(0);
    fs.writeFileSync(
      childFilename,
      childSource.replace(
        "setFlags(previous => ({ ...previous, [key]: value }))",
        "{ foreign.focus(); setFlags(previous => ({ ...previous, [key]: value })); }",
      ),
    );
    resetFilesystemCaches();
    expect(diagnosticsFor(fixture)).toBe(1);
    expect(diagnosticsFor(fixture, true)).toBe(1);
  });

  it("composes closed query candidates, native clone/style operations, and dataset handle arguments", () => {
    const fixture = createFixture(`${freshBarrier}
      for (const tile of host.current.querySelectorAll("button")) {
        const clone = tile.cloneNode(true);
        clone.style.opacity = "0";
        host.current.append(clone);
        panel.current?.commit(tile.dataset.key, true);
      }
      setStatus("ready");`);
    fixture.source = fixture.source
      .replace("import { useEffect, useState }", "import { useEffect, useState, useRef }")
      .replace(
        "export const Panel",
        'import { Board } from "./board"; import { Visual } from "./visual"; export const Panel',
      )
      .replace(
        "const [status, setStatus]",
        "const host = useRef(null); const panel = useRef(null); const [status, setStatus]",
      )
      .replace(
        "<div>{status}</div>",
        '<><Board apiRef={panel} /><div ref={host}><Visual><button data-key="tile"><span>Tile</span></button></Visual></div></>',
      );
    fs.writeFileSync(fixture.filename, fixture.source);
    fs.writeFileSync(
      path.join(fixture.directory, "board.tsx"),
      `import { useState, useImperativeHandle } from "react";
      export const Board = ({apiRef}) => { const [flags,setFlags] = useState({});
        useImperativeHandle(apiRef, () => ({commit: (key,value) => setFlags(previous => ({...previous,[key]:value}))}), []);
        return <div />; };`,
    );
    const visualFilename = path.join(fixture.directory, "visual.tsx");
    fs.writeFileSync(
      visualFilename,
      "export const Visual = ({ children, ...rest }) => <section {...rest}>{children}</section>;",
    );
    expect(diagnosticsFor(fixture)).toBe(0);
    expect(diagnosticsFor(fixture, true)).toBe(0);
    fs.writeFileSync(
      visualFilename,
      'export const Visual = ({ children, ...rest }) => <section {...rest}>{children}<x-control data-key="foreign" /></section>;',
    );
    resetFilesystemCaches();
    expect(diagnosticsFor(fixture)).toBe(1);
    expect(diagnosticsFor(fixture, true)).toBe(1);
  });

  it.each([
    [
      "mutable dispatcher",
      (source: string) =>
        source
          .replace("const [status, setStatus]", "let [status, setStatus]")
          .replace("useEffect(() => {", "setStatus = notify; useEffect(() => {"),
    ],
    ["unbound state hook", (source: string) => source.replace("useEffect, useState", "useEffect")],
    [
      "global React state hook",
      (source: string) =>
        source
          .replace("useEffect, useState", "useEffect")
          .replace("= useState(", "= React.useState("),
    ],
    ["unbound effect hook", (source: string) => source.replace("useEffect, useState", "useState")],
    [
      "global React effect hook",
      (source: string) =>
        source
          .replace("useEffect, useState", "useState")
          .replace("useEffect(() => {", "React.useEffect(() => {"),
    ],
    [
      "mutable setter alias escape",
      (source: string) =>
        source.replace("useEffect(() => {", "let write = setStatus; useEffect(() => {"),
    ],
  ])("requires genuine readonly React scheduling bindings: %s", (_label, transform) => {
    const fixture = createFixture(`${freshBarrier} setStatus("ready");`);
    fixture.source = transform(fixture.source);
    fs.writeFileSync(fixture.filename, fixture.source);
    expect(diagnosticsFor(fixture)).toBe(1);
  });

  it.each([
    "if (branch) return () => {};",
    "if (branch) return;",
    "if (branch) throw 1;",
    "notify();",
    "external.value;",
    "missingIdentifier;",
    "1n + 1;",
    "later; const later = 1;",
    "const later = 1n + 1;",
  ])("refuses incomplete cleanup installation after scheduling: %s", (tail) => {
    const fixture = createFixture(`${freshBarrier} setStatus("ready");`);
    fixture.source = fixture.source.replace("run();", `run(); ${tail}`);
    fs.writeFileSync(fixture.filename, fixture.source);
    expect(diagnosticsFor(fixture)).toBe(1);
  });

  it("refuses an escaped named setter callback", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `await load(); external(writeLater); ${freshBarrier} setStatus("ready");`,
          delaySource,
          "controller.abort()",
          'const writeLater = () => setStatus("late");',
        ),
      ),
    ).toBe(1);
  });

  it("refuses bound helper arguments instead of erasing their values", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `await load(); bound(); ${freshBarrier} setStatus("ready");`,
          delaySource,
          "controller.abort()",
          'const select = (enabled) => { if (!enabled) return; setStatus("late"); }; const bound = select.bind(null, true);',
        ),
      ),
    ).toBe(1);
  });

  it("retains a throwing local helper completion through caller finalizers", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `${freshBarrier} setStatus("ready"); try { await fail(); } finally { setStatus("late"); }`,
          delaySource,
          "controller.abort()",
          "const fail = async () => { await load(); throw 1; };",
        ),
      ),
    ).toBe(1);
    expect(
      diagnosticsFor(
        createFixture(
          `${freshBarrier} setStatus("ready"); try { fail(); } finally { setStatus("late"); }`,
          delaySource,
          "controller.abort()",
          "const fail = () => { notify(); throw 1; };",
        ),
      ),
    ).toBe(1);
  });

  it("refuses a mutated signal instance", () => {
    expect(
      diagnosticsFor(
        createFixture(
          `controller.signal.addEventListener = foreign; ${freshBarrier} setStatus("ready");`,
        ),
      ),
    ).toBe(1);
  });

  it("rechecks changed package scheduling roles on a warm run", () => {
    const fixture = createFixture(`${freshBarrier} setStatus("ready");`);
    expect(diagnosticsFor(fixture)).toBe(0);
    fs.writeFileSync(
      path.join(fixture.directory, "package.json"),
      JSON.stringify({
        dependencies: { react: "^18.0.0", "react-dom": "^18.0.0", next: "^16.0.0" },
      }),
    );
    resetFilesystemCaches();
    expect(diagnosticsFor(fixture)).toBe(1);
  });
});
