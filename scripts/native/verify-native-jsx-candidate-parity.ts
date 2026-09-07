import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  DetectDuplicateJsxSubtreesOptions,
  JsxDuplicationSource,
} from "../../packages/core/src/react-cleanup/detect-duplicate-jsx-subtrees.js";
import {
  JSX_DUPLICATION_DEFAULT_MAX_JSX_NODES,
  REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV,
  REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV,
} from "../../packages/core/src/constants.js";
import { isRecord } from "../../packages/core/src/utils/is-record.js";

interface JsxCandidateParityCase {
  readonly name: string;
  readonly source: string;
  readonly filename?: string;
  readonly maximumCandidateCount?: number;
  readonly support?: "conservative" | "unsupported";
  readonly expectedCandidateCount?: number;
  readonly expectedLimitExceeded?: boolean;
}

interface JsxCandidateCollection {
  readonly candidates: unknown[];
  readonly limitExceeded: boolean;
}

interface JsxParityResolveInput {
  readonly path: string;
  readonly resolveDir: string;
}

interface JsxParityLoadInput {
  readonly path: string;
}

interface JsxParityBundleContext {
  readonly onResolve: (
    options: { readonly filter: RegExp },
    callback: (input: JsxParityResolveInput) => {
      readonly path: string;
      readonly external: boolean;
    },
  ) => void;
  readonly onLoad: (
    options: { readonly filter: RegExp },
    callback: (
      input: JsxParityLoadInput,
    ) =>
      | { readonly contents: string; readonly loader: string; readonly resolveDir: string }
      | undefined,
  ) => void;
}

interface JsxCandidateOracle {
  readonly extract: (
    filename: string,
    source: string,
    maximumCandidateCount: number,
  ) => JsxCandidateCollection;
  readonly detect: (
    sources: JsxDuplicationSource[],
    options?: DetectDuplicateJsxSubtreesOptions,
  ) => unknown;
  readonly diagnostics: (result: unknown) => unknown[];
}

interface JsxDetectorParityCase {
  readonly name: string;
  readonly sources: JsxDuplicationSource[];
  readonly options?: DetectDuplicateJsxSubtreesOptions;
  readonly expectedFamilies?: number;
  readonly expectedIncomplete?: boolean;
}

const JSX_COMPILERS = [
  {
    packageName: "react-doctor",
    version: "5.9.3",
    sha256: "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675",
  },
  {
    packageName: "core",
    version: "6.0.3",
    sha256: "569177652966bd528c319171c7dd22860dbf72bde116cbc4f644f1d02bb12e39",
  },
];
const NATIVE_JSX_IMPORT =
  'import { runNativeJsxSubtreeCandidates } from "./run-native-jsx-subtree-candidates.js";';
const NATIVE_GROUPING_IMPORT =
  'import { runNativeDuplicateJsxAnalysis } from "./run-native-duplicate-jsx-analysis.js";';
const PRIVATE_JSX_EXPORTS = `
export const extractCanonicalJsxCandidates = (filename: string, sourceText: string, maximumCandidateCount: number) => {
  const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, getTypescriptScriptKind(filename));
  if (isNonReactJsxSource(sourceFile)) return { candidates: [], limitExceeded: false };
  const collected = collectCandidates({ path: filename, sourceText }, sourceFile, undefined, maximumCandidateCount);
  if (collected.aborted) throw new Error("Unexpected canonical candidate abort");
  return { candidates: collected.candidates, limitExceeded: collected.limitExceeded };
};
`;

const readJsxCandidateCollection = (value: unknown): JsxCandidateCollection => {
  assert.ok(
    isRecord(value) && Array.isArray(value.candidates) && typeof value.limitExceeded === "boolean",
  );
  assert.deepEqual(Object.keys(value).sort(), ["candidates", "limitExceeded"]);
  return { candidates: value.candidates, limitExceeded: value.limitExceeded };
};

const buildJsxCandidateOracle = async (
  repositoryRoot: string,
  temporaryRoot: string,
  compilerPath: string,
  compilerName: string,
  useNative: boolean,
): Promise<JsxCandidateOracle> => {
  const sourceDirectory = path.join(repositoryRoot, "packages/core/src/react-cleanup");
  const sourcePath = path.join(sourceDirectory, "detect-duplicate-jsx-subtrees.ts");
  const servicePath = path.join(repositoryRoot, "packages/core/src/services/maintainability.ts");
  let source = fs.readFileSync(sourcePath, "utf8");
  assert.equal(source.split("const collectCandidates =").length, 2);
  assert.equal(source.split(NATIVE_JSX_IMPORT).length, 2);
  assert.equal(source.split(NATIVE_GROUPING_IMPORT).length, 2);
  source = source.replace(
    NATIVE_GROUPING_IMPORT,
    "const runNativeDuplicateJsxAnalysis = () => null;",
  );
  if (!useNative)
    source = source.replace(NATIVE_JSX_IMPORT, "const runNativeJsxSubtreeCandidates = () => null;");
  const serviceSource = fs.readFileSync(servicePath, "utf8");
  assert.equal(serviceSource.split("const buildDuplicateJsxDiagnostic =").length, 2);
  const repositoryRequire = createRequire(path.join(repositoryRoot, "package.json"));
  const bundler: unknown = createRequire(repositoryRequire.resolve("tsx/package.json"))("esbuild");
  assert.ok(isRecord(bundler) && typeof bundler.build === "function");
  const outputPath = path.join(
    temporaryRoot,
    `jsx-${compilerName}-${useNative ? "native" : "canonical"}.mjs`,
  );
  await bundler.build({
    stdin: {
      contents: `${source}\n${PRIVATE_JSX_EXPORTS}\nexport { buildDuplicateJsxDiagnostic } from ${JSON.stringify(servicePath)};`,
      loader: "ts",
      sourcefile: sourcePath,
      resolveDir: sourceDirectory,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outputPath,
    logLevel: "silent",
    plugins: [
      {
        name: "pin-jsx-candidate-parity-dependencies",
        setup: (build: JsxParityBundleContext): void => {
          build.onResolve({ filter: /^[^./]/ }, (input) => {
            if (path.isAbsolute(input.path)) return { path: input.path, external: false };
            if (input.path === "typescript")
              return { path: pathToFileURL(compilerPath).href, external: true };
            if (isBuiltin(input.path)) return { path: input.path, external: true };
            const resolved = createRequire(path.join(input.resolveDir, "package.json")).resolve(
              input.path,
            );
            return { path: pathToFileURL(resolved).href, external: true };
          });
          build.onLoad({ filter: /\.ts$/ }, (input) =>
            input.path === servicePath
              ? {
                  contents: serviceSource.replace(
                    "const buildDuplicateJsxDiagnostic =",
                    "export const buildDuplicateJsxDiagnostic =",
                  ),
                  loader: "ts",
                  resolveDir: path.dirname(servicePath),
                }
              : undefined,
          );
        },
      },
    ],
  });
  const bundle = fs.readFileSync(outputPath, "utf8");
  assert.ok(bundle.includes(JSON.stringify(pathToFileURL(compilerPath).href)));
  assert.ok(!/from ["']typescript["']/.test(bundle));
  const oracle: unknown = await import(pathToFileURL(outputPath).href);
  assert.ok(
    isRecord(oracle) &&
      typeof oracle.extractCanonicalJsxCandidates === "function" &&
      typeof oracle.detectDuplicateJsxSubtrees === "function" &&
      typeof oracle.buildDuplicateJsxDiagnostic === "function",
  );
  const extract = oracle.extractCanonicalJsxCandidates;
  const detect = oracle.detectDuplicateJsxSubtrees;
  const diagnostic = oracle.buildDuplicateJsxDiagnostic;
  return {
    extract: (filename, sourceText, maximumCandidateCount) =>
      readJsxCandidateCollection(extract(filename, sourceText, maximumCandidateCount)),
    detect: (sources, options) => detect(sources, options),
    diagnostics: (result) => {
      assert.ok(isRecord(result) && Array.isArray(result.families));
      return result.families.map((family: unknown) => {
        assert.ok(isRecord(family) && Array.isArray(family.relatedOccurrences));
        return diagnostic(family, [family.primaryOccurrence, ...family.relatedOccurrences]);
      });
    },
  };
};

const jsxCandidateCases = (): JsxCandidateParityCase[] => [
  { name: "empty", source: "", expectedCandidateCount: 0 },
  { name: "plain source", source: "export const count = 3;", expectedCandidateCount: 0 },
  { name: "self closing", source: "export const View = () => <div />;", expectedCandidateCount: 1 },
  {
    name: "nested fragment preorder",
    source: "const View = () => <><A /><B /></>;",
    expectedCandidateCount: 3,
  },
  {
    name: "nested attribute before child",
    source: "const View = () => <Outer header={<Header />}><Body /></Outer>;",
    expectedCandidateCount: 3,
  },
  {
    name: "multiple roots",
    source: "const first = <A />; const second = <B />;",
    expectedCandidateCount: 2,
  },
  {
    name: "comment and whitespace children",
    source: "const View = () => <main> \n{/* comment */}<Item />\t</main>;",
  },
  { name: "text abstractions", source: "const View = () => <p>Hello &amp; world</p>;" },
  {
    name: "member tag trivia",
    source: "const View = () => <UI . Panel><UI.Button /></UI . Panel>;",
  },
  { name: "namespaced tag", source: "const View = () => <svg:path aria-label='path' />;" },
  {
    name: "static attribute syntax",
    source:
      "const View = () => <Item title='a&amp;b' count={0x10} yes={true} no={false} empty={null} text={'a\\n'} />;",
  },
  {
    name: "attributes preserve order",
    source: "const View = () => <Item b='two' a='one' enabled {...rest} disabled={flag} />;",
  },
  {
    name: "raw entity and escaped attribute",
    source: "const View = () => <Item title='&#x1F642;' data-text='\\u0061' />;",
  },
  { name: "numeric spelling", source: "const View = () => <Item a={1_000} b={1e3} c={1000.0} />;" },
  {
    name: "static parenthesized literal",
    source: "const View = () => <Item a={(1)} b={('text')} />;",
  },
  {
    name: "optional property access",
    source: "const View = () => <Item value={model?.name} other={model.name} />;",
  },
  {
    name: "computed literal access",
    source:
      "const View = () => <Item value={model['a\\u0062']} other={model[0x10]} next={model?.[index]} />;",
  },
  {
    name: "operators",
    source:
      "const View = () => <Item a={left + right} b={ready && value} c={!ready} d={count++} />;",
  },
  {
    name: "object properties",
    source:
      "const View = () => <Item value={{plain: first, 'raw': second, [key]: third, short, ...rest}} />;",
  },
  {
    name: "calls arrays conditionals",
    source:
      "const View = () => <Item value={fn(a, ...rest)} list={[a, , b]} child={ready ? <A /> : <B />} />;",
  },
  {
    name: "template and regex",
    source: "const View = () => <Item a={`hello ${name}`} b={`literal`} c={/ab+/giu} />;",
  },
  {
    name: "arrow callbacks",
    source:
      "const View = () => <main>{rows.map((row, index) => <Item key={index} value={row} />)}</main>;",
  },
  {
    name: "async callback",
    source: "const View = () => <Button onClick={async () => { await run(); return value; }} />;",
    support: "conservative",
  },
  { name: "named function", source: "export function Named() { return <Item />; }" },
  { name: "default anonymous function", source: "export default function() { return <Item />; }" },
  { name: "named expression", source: "const View = function Internal() { return <Item />; };" },
  {
    name: "wrapped variable arrow",
    source: "const View = memo(forwardRef((props, ref) => <Item ref={ref} />));",
  },
  { name: "wrapped default arrow", source: "export default memo(() => <Item />);" },
  {
    name: "property assigned callback",
    source: "const views = { 'custom-name': memo(() => <Item />) };",
  },
  { name: "destructured variable identity", source: "const [View] = (() => <Item />);" },
  { name: "named class method", source: "class Screen { render() { return <Item />; } }" },
  {
    name: "anonymous class method",
    source: "export default class { render() { return <Item />; } }",
  },
  { name: "object method", source: "const views = { ['name']() { return <Item />; } };" },
  { name: "class field arrow identity", source: "class Screen { render = () => <Item />; }" },
  {
    name: "accessor identity",
    source: "const views = { get content() { return <Item />; } };",
    support: "conservative",
  },
  {
    name: "callback default parameter identity",
    source: "function Outer(render = () => <Item />) { return render(); }",
  },
  {
    name: "nested function identity",
    source: "function Outer() { const Inner = () => <Item />; return <main><Inner /></main>; }",
  },
  {
    name: "unassigned callback ancestor",
    source: "function Outer() { return wrap(() => <Item />); }",
  },
  {
    name: "unicode offsets CRLF",
    source:
      "// 🙂\r\nconst café = 'é';\r\nexport const View = () => <main title='🙂'><Item /></main>;",
  },
  {
    name: "unicode line separators",
    source: "// comment\u2028const View = () => <main>one\u2029two<Item /></main>;",
  },
  { name: "BOM and CR", source: "\ufeff// heading\rconst View = () => <Item />;" },
  {
    name: "TypeScript JSX text trivia around child",
    source: "const View = () => <main>\u0085<Item />\u200b</main>;",
  },
  ...[
    ["next line only", "\u0085"],
    ["zero width only", "\u200b"],
    ["mixed trivia only", " \u0085\t\u200b\r\n"],
    ["next line before text", "\u0085text"],
    ["zero width before text", "\u200btext"],
    ["next line after text", "text\u0085"],
    ["zero width after text", "text\u200b"],
    ["trivia around text", "\u0085 text \u200b"],
  ].map(([name, text]) => ({
    name: `TypeScript JSX text ${name}`,
    source: `const View = () => <main>${text}</main>;`,
    expectedCandidateCount: 1,
  })),
  {
    name: "JSX in computed property name",
    source: "const View = () => <Outer value={{ [<Key />]: value }} />;",
    expectedCandidateCount: 2,
  },
  {
    name: "named function expression assigned to property",
    source: "const views = { view: function Named() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  ...[
    ["line comment bracket", "[ //[\n key ]"],
    ["block comment bracket and slashes", "[ /* [ // */ key ]"],
    ["multiple bracket comments", "[ /* [ */ // [\r\n /* // [ */ key /* ] */ ]"],
    ["comment after computed expression", "[ key // ] [\n ]"],
    ["quoted bracket computed expression", "[ '[' ]"],
  ].map(([name, property]) => ({
    name: `computed property ${name}`,
    source: `const View = () => <Shell value={{ ${property}: <Leaf /> }} />;`,
    expectedCandidateCount: 2,
  })),
  {
    name: "computed object method line comment identity",
    source: "const views = { [ //[\n key ]() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  {
    name: "computed object method block comment identity",
    source: "const views = { async [ /* [ // */ key ]() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  {
    name: "computed anonymous class method comment identity",
    source: "const View = class { [ /* [ */ // [\n key ]() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  {
    name: "decorated computed anonymous class method identity",
    source: "const View = class { @decorate('[') [ /* [ // */ key ]() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  {
    name: "decorated named class start identity",
    source: "@decorate('static') export class View { render() { return <Item />; } }",
    expectedCandidateCount: 1,
  },
  {
    name: "export before class decorator identity",
    source: "export @decorate('static') class View { render() { return <Item />; } }",
    expectedCandidateCount: 1,
  },
  {
    name: "decorator before default named class identity",
    source: "@decorate('static') export default class View { render() { return <Item />; } }",
    expectedCandidateCount: 1,
  },
  {
    name: "multiple decorators before class export identity",
    source: "@first @second('[') export class View { render() { return <Item />; } }",
    expectedCandidateCount: 1,
  },
  {
    name: "decorated unexported named class identity",
    source: "@decorate('static') class View { render() { return <Item />; } }",
    expectedCandidateCount: 1,
  },
  {
    name: "quoted modifier-like object method identity",
    source: "const views = { 'async'() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  {
    name: "quoted modifier-like anonymous class method identity",
    source: "const View = class { 'static'() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  {
    name: "static quoted anonymous class method identity",
    source: "const View = class { static 'async'() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  {
    name: "decorated quoted anonymous class method identity",
    source: "const View = class { @decorate('[') 'static'() { return <Item />; } };",
    expectedCandidateCount: 1,
  },
  {
    name: "composition path depth",
    source: `const View = () => ${"<div>".repeat(14)}<Leaf />${"</div>".repeat(14)};`,
  },
  ...["view.jsx", "view.js", "view.mjs", "view.cjs", "view.TSX"].map((filename) => ({
    name: `script kind ${filename}`,
    filename,
    source: "const View = () => <Item />;",
    expectedCandidateCount: 1,
  })),
  {
    name: "TS angle assertion no JSX",
    filename: "view.ts",
    source: "const value = <Item>input;",
    expectedCandidateCount: 0,
  },
  {
    name: "generic JSX",
    source: "const View = () => <Item<Model> value={row} />;",
    support: "conservative",
  },
  {
    name: "type wrappers",
    source: "const View = memo((() => <Item value={row as Model} />) satisfies Component);",
    support: "conservative",
  },
  {
    name: "null literal type assertion",
    source: "const View = () => <Item value={value as null} />;",
  },
  {
    name: "null union type assertion",
    source: "const View = () => <Item value={value as string | null} />;",
  },
  {
    name: "null arrow parameter and return types",
    source: "const View = () => <Item callback={(value: null): null => value} />;",
  },
  {
    name: "null expression control",
    source: "const View = () => <Item value={null} nested={[null]} />;",
  },
  {
    name: "type syntax outside JSX",
    source:
      "type Picked<T> = { [K in keyof T]?: T[K] }; interface Model { value: string } const View = () => <Item />;",
  },
  {
    name: "type syntax inside JSX",
    source: "const View = () => <Item fn={<T extends Model>(value: T): T => value} />;",
    support: "conservative",
  },
  {
    name: "typeof and template types inside JSX",
    source: "const View = () => <Item value={row as typeof model} />;",
    support: "conservative",
  },
  ...[
    ["solid runtime", "import { createSignal } from 'solid-js';", 0],
    ["solid subpath", "import 'solid-js/web';", 0],
    ["qwik runtime", "import { component$ } from '@builder.io/qwik';", 0],
    ["voby runtime", "import 'voby';", 0],
    ["vidode runtime", "import 'vidode';", 0],
    ["lookalike package", "import 'solid-js-extra';", 1],
    ["empty named imports", "import {} from 'solid-js';", 1],
    ["whole type-only import", "import type { Signal } from 'solid-js';", 1],
    ["named type-only import", "import { type Signal } from 'solid-js';", 1],
    ["mixed type and value import", "import { type Signal, createSignal } from 'solid-js';", 0],
    ["React overrides Solid", "import 'react'; import 'solid-js';", 1],
    ["preact overrides Solid", "import 'preact/hooks'; import 'solid-js';", 1],
    [
      "type-only React does not override",
      "import type { Node } from 'react'; import 'solid-js';",
      0,
    ],
  ].map(([name, prefix, expectedCandidateCount]) => ({
    name: String(name),
    source: `${prefix} const View = () => <Item />;`,
    expectedCandidateCount: Number(expectedCandidateCount),
  })),
  {
    name: "class namespace marker",
    source: "const View = () => <Item class:active={flag} />;",
    expectedCandidateCount: 0,
  },
  {
    name: "bind namespace marker",
    source: "const View = () => <Item bind:value={value} />;",
    expectedCandidateCount: 0,
  },
  {
    name: "classList object marker",
    source: "const View = () => <Item classList={{active: flag}} />;",
    expectedCandidateCount: 0,
  },
  {
    name: "classList wrapped object",
    source: "const View = () => <Item classList={({active: flag})} />;",
    expectedCandidateCount: 1,
  },
  {
    name: "React overrides marker",
    source: "import 'react-dom/client'; const View = () => <Item class:active={flag} />;",
    expectedCandidateCount: 1,
  },
  ...[
    0,
    1,
    2,
    3,
    4,
    -1,
    Number.NEGATIVE_INFINITY,
    1.5,
    2.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ].map((maximumCandidateCount) => ({
    name: `candidate budget ${String(maximumCandidateCount)}`,
    source: "const View = () => <><A /><B /></>;",
    maximumCandidateCount,
    expectedCandidateCount: maximumCandidateCount < 0 || maximumCandidateCount <= 2 ? 0 : 3,
    expectedLimitExceeded: maximumCandidateCount < 0 || maximumCandidateCount <= 2,
  })),
  {
    name: "nonReact gate precedes negative budget",
    source: "import 'solid-js'; const View = () => <Item />;",
    maximumCandidateCount: -1,
    expectedCandidateCount: 0,
    expectedLimitExceeded: false,
  },
  {
    name: "empty source ignores negative budget",
    source: "const value = 1;",
    maximumCandidateCount: -1,
    expectedCandidateCount: 0,
    expectedLimitExceeded: false,
  },
  {
    name: "mismatched closing tag recovery",
    source: "const View = () => <div></span>;",
    support: "unsupported",
  },
  { name: "unfinished JSX recovery", source: "const View = () => <div>", support: "unsupported" },
  {
    name: "surrogate escaped computed key",
    source: "const View = () => <Item value={record['\\ud800']} />;",
    support: "unsupported",
  },
];

const jsxDetectorCases = (temporaryRoot: string): JsxDetectorParityCase[] => {
  const aborted = new AbortController();
  aborted.abort(null);
  const sources = ["First", "Second"].map((name) => ({
    path: path.join(temporaryRoot, `${name}.tsx`),
    sourceText: `export const ${name} = () => <section><header><h1>Title</h1></header><main><button /></main><footer /></section>;`,
  }));
  return [
    {
      name: "duplicate families and diagnostics",
      sources,
      expectedFamilies: 1,
      expectedIncomplete: false,
    },
    {
      name: "file budget",
      sources,
      options: { budget: { maxSourceFiles: 1 } },
      expectedIncomplete: true,
    },
    {
      name: "length budget",
      sources,
      options: { budget: { maxSourceLengthChars: 10 } },
      expectedIncomplete: true,
    },
    {
      name: "candidate budget",
      sources,
      options: { budget: { maxJsxNodes: 1 } },
      expectedIncomplete: true,
    },
    {
      name: "family budget",
      sources,
      options: { budget: { maxFamilies: 0 } },
      expectedFamilies: 0,
      expectedIncomplete: false,
    },
    {
      name: "pre-aborted source",
      sources,
      options: { signal: aborted.signal },
      expectedIncomplete: true,
    },
    {
      name: "one-file duplicate family",
      sources: [
        {
          path: sources[0].path,
          sourceText: sources.map((source) => source.sourceText).join("\n"),
        },
      ],
      expectedFamilies: 1,
      expectedIncomplete: false,
    },
    {
      name: "explicit parser fallback",
      sources: [{ path: sources[0].path, sourceText: "const View = () => <div></span>;" }],
    },
    {
      name: "lone surrogate source fallback",
      sources: sources.map((source) => ({
        ...source,
        sourceText: source.sourceText.replace("Title", "Title\ud800"),
      })),
    },
    {
      name: "lone surrogate filename fallback",
      sources: sources.map((source) => ({
        ...source,
        path: source.path.replace(".tsx", "\ud800.tsx"),
      })),
    },
  ];
};

export const verifyNativeJsxCandidateParity = async (
  bindingPath: string,
  temporaryRoot: string,
  repositoryRoot: string,
): Promise<void> => {
  const require = createRequire(
    new URL("./verify-native-jsx-candidate-parity.cjs", import.meta.url),
  );
  const binding: unknown = require(bindingPath);
  assert.ok(
    isRecord(binding) && typeof binding.extractReactDoctorJsxSubtreeCandidates === "function",
    "Native binding omitted JSX candidate extraction",
  );
  const nativeExtract = binding.extractReactDoctorJsxSubtreeCandidates;
  const previousBinding = process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
  const previousRequired = process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
  process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = bindingPath;
  process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = "1";
  try {
    for (const compilerPin of JSX_COMPILERS) {
      const compilerRequire = createRequire(
        path.join(repositoryRoot, "packages", compilerPin.packageName, "package.json"),
      );
      const compilerPath = compilerRequire.resolve("typescript");
      const compiler: unknown = compilerRequire(compilerPath);
      assert.ok(isRecord(compiler) && compiler.version === compilerPin.version);
      assert.equal(
        createHash("sha256").update(fs.readFileSync(compilerPath)).digest("hex"),
        compilerPin.sha256,
      );
      const canonical = await buildJsxCandidateOracle(
        repositoryRoot,
        temporaryRoot,
        compilerPath,
        compilerPin.packageName,
        false,
      );
      const actual = await buildJsxCandidateOracle(
        repositoryRoot,
        temporaryRoot,
        compilerPath,
        compilerPin.packageName,
        true,
      );
      const cases = jsxCandidateCases();
      const unsupportedCases: { name: string; reasons: string[] }[] = [];
      let exact = 0;
      let firing = 0;
      let limited = 0;
      for (const parityCase of cases) {
        const filename = path.join(temporaryRoot, parityCase.filename ?? "view.tsx");
        const maximumCandidateCount =
          parityCase.maximumCandidateCount ?? JSX_DUPLICATION_DEFAULT_MAX_JSX_NODES;
        const expected = canonical.extract(filename, parityCase.source, maximumCandidateCount);
        const label = `TypeScript ${compilerPin.version}: ${parityCase.name}`;
        if (parityCase.expectedCandidateCount !== undefined)
          assert.equal(expected.candidates.length, parityCase.expectedCandidateCount, label);
        if (parityCase.expectedLimitExceeded !== undefined)
          assert.equal(expected.limitExceeded, parityCase.expectedLimitExceeded, label);
        const json: unknown = nativeExtract(filename, parityCase.source, maximumCandidateCount);
        assert.equal(typeof json, "string", label);
        const output: unknown = JSON.parse(String(json));
        assert.ok(isRecord(output), label);
        if (Object.hasOwn(output, "unsupported")) {
          assert.deepEqual(Object.keys(output), ["unsupported"], label);
          assert.ok(
            Array.isArray(output.unsupported) &&
              output.unsupported.length > 0 &&
              output.unsupported.every(
                (reason: unknown) => typeof reason === "string" && reason.length > 0,
              ),
            label,
          );
          assert.ok(
            parityCase.support !== undefined,
            `${label}: required supported coverage became fallback`,
          );
          unsupportedCases.push({ name: parityCase.name, reasons: output.unsupported });
        } else {
          assert.notEqual(
            parityCase.support,
            "unsupported",
            `${label}: conservative guard unexpectedly accepted input`,
          );
          const candidates = readJsxCandidateCollection(output);
          assert.deepEqual(candidates, expected, label);
          exact++;
          if (candidates.candidates.length > 0) firing++;
          if (candidates.limitExceeded) limited++;
        }
      }
      assert(
        exact >= cases.filter((entry) => entry.support === undefined).length &&
          firing > 0 &&
          limited > 0,
      );
      let runtimeCalls = 0;
      binding.extractReactDoctorJsxSubtreeCandidates = (...argumentsList: unknown[]): unknown => {
        runtimeCalls++;
        return nativeExtract(...argumentsList);
      };
      const detectorCases = jsxDetectorCases(temporaryRoot);
      for (const parityCase of detectorCases) {
        const expected = canonical.detect(parityCase.sources, parityCase.options);
        const result = actual.detect(parityCase.sources, parityCase.options);
        assert.deepEqual(result, expected, `${compilerPin.version}: ${parityCase.name}`);
        assert.deepEqual(
          actual.diagnostics(result),
          canonical.diagnostics(expected),
          `${parityCase.name}: diagnostics and symbol identity`,
        );
        assert.ok(isRecord(expected) && Array.isArray(expected.families));
        if (parityCase.expectedFamilies !== undefined)
          assert.equal(expected.families.length, parityCase.expectedFamilies, parityCase.name);
        if (parityCase.expectedIncomplete !== undefined)
          assert.equal(expected.incomplete, parityCase.expectedIncomplete, parityCase.name);
      }
      assert(runtimeCalls > 0, "Integrated detector never called native extraction");
      binding.extractReactDoctorJsxSubtreeCandidates = nativeExtract;
      assert.equal(
        createHash("sha256").update(fs.readFileSync(compilerPath)).digest("hex"),
        compilerPin.sha256,
      );
      process.stdout.write(
        `${JSON.stringify({ compiler: compilerPin.version, compilerSha256: compilerPin.sha256, cases: cases.length, exact, firing, limited, unsupportedCases, detectorCases: detectorCases.length, runtimeCalls })}\n`,
      );
    }
  } finally {
    binding.extractReactDoctorJsxSubtreeCandidates = nativeExtract;
    if (previousBinding === undefined) delete process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
    else process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = previousBinding;
    if (previousRequired === undefined) delete process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
    else process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = previousRequired;
  }
};

const runJsxCandidateParity = async (): Promise<void> => {
  const argumentsList = process.argv.slice(2);
  if (argumentsList[0] === "--") argumentsList.shift();
  assert.equal(argumentsList.length, 2, "Pass --binding <native-addon-path>");
  assert.equal(argumentsList[0], "--binding");
  const bindingPath = path.resolve(argumentsList[1]);
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "react-doctor-jsx-candidate-parity-"),
  );
  try {
    await verifyNativeJsxCandidateParity(bindingPath, temporaryRoot, repositoryRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runJsxCandidateParity();
}
