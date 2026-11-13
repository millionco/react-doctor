import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SourceProjectModule } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { getDirectConstInitializer } from "../get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "../get-resolved-static-property-name.js";
import { isFunctionLike } from "../is-function-like.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { walkAst } from "../walk-ast.js";
import { resetFilesystemCaches } from "../reset-filesystem-caches.js";
import {
  certifyOwnedRendererBuilder,
  type OwnedRendererBuilderCallback,
} from "./certify-owned-renderer-builder.js";
import {
  NATIVE_DELAY_MAX_ALIAS_DEPTH,
  NATIVE_DELAY_MAX_PROGRAM_NODES,
} from "./native-signal-delay/constants.js";

const builderSource = `import {Marked,Renderer} from 'marked';
export const build = source => {
 const records=[];
 const counts=new Map();
 const markdown=new Marked();
 markdown.use({renderer:{code(token){
   const key=token.text;
   const count=(counts.get(key)??0)+1;
   counts.set(key,count);
   records.push({key,count});
   return Renderer.prototype.code.call(this,token);
 }}});
 const html=markdown.parse(source,{async:false});
 return {html,records};
};`;

const certify = (source = builderSource, projectRoot?: string): boolean => {
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  if (!isNodeOfType(parsed.program, "Program")) throw new Error("Missing Program");
  attachParentReferences(parsed.program);
  const module: SourceProjectModule = {
    filePath: projectRoot ? path.join(projectRoot, "index.ts") : "/builder/index.ts",
    programNode: parsed.program,
    scopes: analyzeScopes(parsed.program),
  };
  let callback: EsTreeNode | null = null;
  walkAst(parsed.program, (node) => {
    if (
      !callback &&
      isNodeOfType(node, "Property") &&
      ["code", "image", "link"].includes(
        getResolvedStaticPropertyName(node, module.scopes) ?? "",
      ) &&
      isFunctionLike(node.value)
    )
      callback = node.value;
  });
  if (!callback) throw new Error("Missing callback");
  const instance = (expression: EsTreeNode, depth = 0): EsTreeNode | null => {
    if (depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) return null;
    const node = stripParenExpression(expression);
    if (
      isNodeOfType(node, "NewExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "Marked"
    )
      return node;
    if (!isNodeOfType(node, "Identifier")) return null;
    const symbol = module.scopes.symbolFor(node);
    const init = symbol && getDirectConstInitializer(symbol);
    return init ? instance(init, depth + 1) : null;
  };
  let steps = 0;
  return Boolean(
    certifyOwnedRendererBuilder(callback, {
      module,
      projectIndex: {
        ...(projectRoot ? { rootDirectory: projectRoot } : {}),
        modulesByFilePath: new Map([[module.filePath, module]]),
        htmlFilePaths: [],
        consumerModulesByFilePath: new Map(),
        resolvedSourcePathByNode: new WeakMap(),
        unresolvedRuntimeSources: new Set(),
        hasOpaqueMdxConsumerSurface: false,
      },
      getInstance: instance,
      getConfigurationCallbacks: (expression) => {
        if (!isNodeOfType(expression, "ObjectExpression")) return null;
        const callbacks: OwnedRendererBuilderCallback[] = [];
        const keys = new Set<string>();
        for (const property of expression.properties) {
          if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed)
            return null;
          const key = getResolvedStaticPropertyName(property, module.scopes);
          if (!key || keys.has(key)) return null;
          keys.add(key);
          if (key !== "renderer") {
            if (
              !["async", "gfm", "breaks", "pedantic", "silent"].includes(key) ||
              !isNodeOfType(property.value, "Literal") ||
              typeof property.value.value !== "boolean"
            )
              return null;
            continue;
          }
          if (!isNodeOfType(property.value, "ObjectExpression")) return null;
          for (const method of property.value.properties) {
            if (
              !isNodeOfType(method, "Property") ||
              method.kind !== "init" ||
              method.computed ||
              !isFunctionLike(method.value)
            )
              return null;
            const methodName = getResolvedStaticPropertyName(method, module.scopes);
            if (!methodName) return null;
            callbacks.push({ callback: method.value, methodName });
          }
        }
        return callbacks;
      },
      getFallbackMethod: (call) => {
        if (
          !isNodeOfType(call, "CallExpression") ||
          !isNodeOfType(call.callee, "MemberExpression") ||
          getResolvedStaticPropertyName(call.callee, module.scopes) !== "call" ||
          !isNodeOfType(call.callee.object, "MemberExpression") ||
          !isNodeOfType(call.callee.object.object, "MemberExpression") ||
          getResolvedStaticPropertyName(call.callee.object.object, module.scopes) !== "prototype"
        )
          return null;
        return getResolvedStaticPropertyName(call.callee.object, module.scopes);
      },
      isParserCall: () => false,
      spendStep: () => ++steps <= NATIVE_DELAY_MAX_PROGRAM_NODES,
    }),
  );
};

const formattedBuilderSource = builderSource
  .replace(
    "export const build",
    "const normalize=value=>value.replace(/[^a-z ]/gi,'').trim().toLowerCase(); export const build",
  )
  .replace("const key=token.text", "const key=normalize(token.text)")
  .replace(
    "records.push({key,count});",
    "if ((/^skip/.test(key) || key.startsWith('omit')) && count >= 1) { records.push({key,count}); return ''; } if (key === 'quiet') return false; records.push({key:key ? key : 'empty',count});",
  );

describe("certifyOwnedRendererBuilder", () => {
  it.each([
    ["null", true],
    ["'value'", true],
    ["true", true],
    ["17", true],
    ["1n", false],
    ["/pattern/", false],
    ["/(?i:pattern)/", false],
  ])(
    "classifies literal primitives without treating RegExp objects as null: %s",
    (expression, expected) =>
      expect(
        certify(
          builderSource.replace(" const records", ` const unused = ${expression}; const records`),
        ),
      ).toBe(expected),
  );

  it.each(["void 0;", "(void (0));", "(void (0)) as undefined;"])(
    "admits the exact void-zero recipe at both statement gates: %s",
    (statement) =>
      expect(
        certify(
          builderSource
            .replace(" const records", `${statement} const records`)
            .replace("   const key", `${statement} const key`),
        ),
      ).toBe(true),
  );

  it.each([
    "void notify();",
    "void 1;",
    "void '0';",
    "void undefined;",
    "'directive';",
    "const undefined = 0; undefined;",
  ])("retains refusal outside the exact void-zero recipe: %s", (statement) => {
    expect(certify(builderSource.replace(" const records", `${statement} const records`))).toBe(
      false,
    );
    expect(certify(builderSource.replace("   const key", `${statement} const key`))).toBe(false);
  });

  it("admits literal empty statements around private builder and callback operations", () => {
    expect(
      certify(
        builderSource
          .replace(" markdown.use", " ; markdown.use")
          .replace("   counts.set", "   ; counts.set")
          .replace("   records.push", "   ; records.push"),
      ),
    ).toBe(true);
  });

  it.each(["notify();", "void notify();", "'directive';"])(
    "retains refusal for nonempty unsupported builder statements: %s",
    (statement) =>
      expect(certify(builderSource.replace(" markdown.use", `${statement} markdown.use`))).toBe(
        false,
      ),
  );

  it("certifies a module scalar formatter and bounded conditional collection", () =>
    expect(certify(formattedBuilderSource)).toBe(true));
  it("keeps a formatted builder with a lexical opaque-writer firing anchor", () =>
    expect(
      certify(
        `${formattedBuilderSource}\nimport {foreign} from 'opaque-app'; const replacement=()=>'';`,
      ),
    ).toBe(true));
  it.each([
    "foreign().trim = replacement;",
    "Object.defineProperty(foreign(), 'test', {value: replacement});",
  ])("refuses an opaque receiver writer for a used intrinsic %s", (mutation) =>
    expect(
      certify(
        `${formattedBuilderSource}\nimport {foreign} from 'opaque-app'; const replacement=()=>''; ${mutation}`,
      ),
    ).toBe(false),
  );
  it.each([
    ["regexp constructor publication", "const normalize=", "publish(RegExp); const normalize="],
    ["replacement callback", ".replace(/[^a-z ]/gi,'')", ".replace(/[^a-z ]/gi,()=>foreign)"],
    ["conditional capability branch", "key ? key : 'empty'", "key ? key : document"],
    ["conditional asynchronous work", "return false;", "return foreign(()=>records);"],
    ["conditional setter", "records.push({key,count}); return '';", "publish(records); return '';"],
    ["loop", "if (key === 'quiet') return false;", "while (key) records.push({key,count});"],
    ["mutable helper", "const normalize=", "let normalize="],
    ["async helper", "const normalize=value=>", "const normalize=async value=>"],
    [
      "string intrinsic writer",
      "const normalize=",
      "String.prototype.trim=foreign; const normalize=",
    ],
    [
      "regexp intrinsic writer",
      "const normalize=",
      "RegExp.prototype.test=foreign; const normalize=",
    ],
    ["regexp constructor replacement", "const normalize=", "RegExp=foreign; const normalize="],
  ])("refuses scalar extension %s", (_label, before, after) =>
    expect(certify(formattedBuilderSource.replace(before, after))).toBe(false),
  );
  it.each([
    "publish([]);",
    "publish(new Map());",
    "publish(/x/);",
    "Array.from([1,2]);",
    "Array.of(1,2);",
    "new Array(3);",
    "Array(3);",
    "const NativeArray=Array;new NativeArray(2);",
    `new Map([["x",1]]);`,
    "String.fromCharCode(65);",
    "new RegExp('x');",
    "RegExp('x');",
  ])("allows unrelated ordinary intrinsic allocation %s", (source) =>
    expect(certify(`${builderSource}\n${source}`)).toBe(true),
  );
  it.each([
    ["link", "token.href"],
    ["image", "token.href"],
    ["image", "token.text"],
    ["image", "(token.title ?? '').trim()"],
    ["image", "token.title.trim()"],
  ])("certifies verified own %s field %s", (method, field) =>
    expect(
      certify(
        builderSource
          .replaceAll("code(", `${method}(`)
          .replaceAll(".code.", `.${method}.`)
          .replace("token.text", field),
      ),
    ).toBe(true),
  );
  it("refuses omitted Link.title prototype fallback", () =>
    expect(
      certify(
        builderSource
          .replaceAll("code(", "link(")
          .replaceAll(".code.", ".link.")
          .replace("token.text", "token.title"),
      ),
    ).toBe(false));
  it("refuses nullable image title as Map string key without normal completion/default", () =>
    expect(
      certify(
        builderSource
          .replaceAll("code(", "image(")
          .replaceAll(".code.", ".image.")
          .replace("token.text", "token.title"),
      ),
    ).toBe(false));
  it("certifies a fresh synchronous data builder", () => expect(certify()).toBe(true));
  it("permits genuine React dependency arrays", () =>
    expect(
      certify(
        builderSource.replace(
          "import {Marked,Renderer}",
          "import {useEffect} from 'react'; import {Marked,Renderer}",
        ) + "\nuseEffect(()=>{},[]);",
      ),
    ).toBe(true));
  it("certifies readonly container and instance aliases", () =>
    expect(
      certify(
        builderSource
          .replace("const markdown=", "const output=records; const counter=counts; const markdown=")
          .replace("records.push", "output.push")
          .replaceAll("counts.get", "counter.get")
          .replaceAll("counts.set", "counter.set")
          .replace("return {html,records}", "return {html,records:output}"),
      ),
    ).toBe(true));
  it("certifies scalar-only direct helpers", () =>
    expect(
      certify(
        builderSource
          .replace("const records=[]", "const label=value=>`key:${value}`; const records=[]")
          .replace("const key=token.text", "const key=label(token.text)"),
      ),
    ).toBe(true));
  it.each([
    ["seeded array", "const records=[]", "const records=[foreign]"],
    ["seeded map", "new Map()", "new Map([[foreign,1]])"],
    ["early publication", "markdown.use", "publish(records); markdown.use"],
    ["late publication", "return {html,records}", "publish(records); return {html,records}"],
    ["second parse", "const html=", "markdown.parse(source,{async:false}); const html="],
    ["async parse", "async:false", "async:true"],
    ["counter return", "return {html,records}", "return {html,records:counts}"],
    ["raw token insertion", "records.push({key,count})", "records.push({key:token,count})"],
    ["native insertion", "records.push({key,count})", "records.push({key:document,count})"],
    ["optional token field", "const key=token.text", "const key=token.lang"],
    ["map capability insertion", "records.push({key,count})", "records.push({key:counts,count})"],
    [
      "object accessors",
      "records.push({key,count})",
      "records.push({get key(){return foreign},count})",
    ],
    ["promise callback", "code(token){", "async code(token){"],
    [
      "deferred callback",
      "const key=token.text",
      "foreign(()=>records.push({key:'x'})); const key=token.text",
    ],
    ["callback token mutation", "const key=token.text", "token.text=foreign; const key=token.text"],
    ["container own writer", "const html=", "records.push=foreign; const html="],
    [
      "container member alias",
      "const key=token.text",
      "const push=records.push; const key=token.text",
    ],
    ["parse getter input", "markdown.parse(source", "markdown.parse(source.value"],
    ["parse call input", "markdown.parse(source", "markdown.parse(foreign()"],
    ["record spread", "records.push({key,count})", "records.push({...foreign,key,count})"],
    ["map result publication", "counts.set(key,count);", "const result=counts.set(key,count);"],
    ["get result string seed", "counts.get(key)??0", "counts.get(key)??'x'"],
  ])("refuses %s", (_label, before, after) =>
    expect(certify(builderSource.replace(before, after))).toBe(false),
  );
  it.each([
    "Map=foreign;",
    "eval('Map=foreign');",
    "new Function('Map=foreign');",
    "globalThis.Map=foreign;",
    "Map.prototype.get=foreign;",
    "Array.prototype.push=foreign;",
    "Object.getPrototypeOf([]).push=foreign;",
    "const NativeMap=Map; publish(NativeMap);",
    "const NativeArray=Array; NativeArray.prototype.push=foreign;",
    "Object.defineProperty(Map.prototype,'get',{value:foreign});",
  ])("refuses intrinsic contradiction %s", (mutation) =>
    expect(certify(`${builderSource}\n${mutation}`)).toBe(false),
  );
});

const emissionFixtureDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "renderer-erasure-callers-"),
);
afterAll(() => fs.rmSync(emissionFixtureDirectory, { recursive: true, force: true }));

describe("owned renderer inventory with an erased default export", () => {
  it.each([
    {
      label: "bare type alias",
      emission: "type Model = {}; export default Model;",
      configuration: "{}",
      nextVersion: "16.3.6",
      expected: true,
    },
    {
      label: "bare interface",
      emission: "interface Model {} export default Model;",
      configuration: "{}",
      nextVersion: "16.3.6",
      expected: true,
    },
    {
      label: "verbatim preservation",
      emission: "type Model = {}; export default Model;",
      configuration: '{"compilerOptions":{"verbatimModuleSyntax":true}}',
      nextVersion: "16.3.6",
      expected: false,
    },
    {
      label: "unproved emitter range",
      emission: "type Model = {}; export default Model;",
      configuration: "{}",
      nextVersion: "^16.3.6",
      expected: false,
    },
    {
      label: "type before intrinsic writer",
      emission:
        "type Model = {}; const Model = (Map.prototype.get = () => 0); export default Model;",
      configuration: "{}",
      nextVersion: "16.3.6",
      expected: false,
    },
    {
      label: "intrinsic writer before type",
      emission:
        "const Model = (Map.prototype.get = () => 0); type Model = {}; export default Model;",
      configuration: "{}",
      nextVersion: "16.3.6",
      expected: false,
    },
  ])(
    "keeps the renderer proof causal for $label",
    ({ emission, configuration, nextVersion, expected }) => {
      const directory = fs.mkdtempSync(path.join(emissionFixtureDirectory, "case-"));
      const source = `${builderSource}\n${emission}`;
      fs.writeFileSync(path.join(directory, "index.ts"), source);
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          dependencies: { next: nextVersion, react: "19.0.0", "react-dom": "19.0.0" },
        }),
      );
      fs.writeFileSync(path.join(directory, "tsconfig.json"), configuration);
      resetFilesystemCaches();
      expect(certify(source, directory)).toBe(expected);
      if (expected) expect(certify(source)).toBe(false);
    },
  );

  it("rechecks the same renderer after explicit configuration-cache resets", () => {
    const directory = fs.mkdtempSync(path.join(emissionFixtureDirectory, "cache-"));
    const source = `${builderSource}\ntype Model = {}; export default Model;`;
    fs.writeFileSync(path.join(directory, "index.ts"), source);
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "16.3.6", react: "19.0.0", "react-dom": "19.0.0" } }),
    );
    fs.writeFileSync(path.join(directory, "tsconfig.json"), "{}");
    resetFilesystemCaches();
    expect(certify(source, directory)).toBe(true);
    fs.writeFileSync(
      path.join(directory, "tsconfig.json"),
      '{"compilerOptions":{"verbatimModuleSyntax":true}}',
    );
    resetFilesystemCaches();
    expect(certify(source, directory)).toBe(false);
    fs.writeFileSync(path.join(directory, "tsconfig.json"), "{}");
    resetFilesystemCaches();
    expect(certify(source, directory)).toBe(true);
  });
});
