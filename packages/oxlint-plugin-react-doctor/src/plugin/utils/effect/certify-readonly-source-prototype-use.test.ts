import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { getResolvedStaticPropertyName } from "../get-resolved-static-property-name.js";
import { getRuntimeStaticDependencySource } from "../get-runtime-static-dependency-source.js";
import { getStaticStringExpression } from "../get-static-string-expression.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { normalizeFilename } from "../normalize-filename.js";
import { resetFilesystemCaches } from "../reset-filesystem-caches.js";
import { walkAst } from "../walk-ast.js";
import { certifyReadonlySourcePrototypeUse } from "./certify-readonly-source-prototype-use.js";
import { NATIVE_DELAY_MAX_ALIAS_DEPTH } from "./native-signal-delay/constants.js";

interface PrototypeFixture {
  module: SourceProjectModule;
  project: SourceProjectIndex;
  prototype: EsTreeNode;
}

const sourceClass = "export const Renderer = class { echo(token) { return token; } };";
const consumerSource = `import { Renderer } from "./sdk";
  export function fallback(token) { return Renderer.prototype.echo.call(this, token); }`;
const markedInstanceSource = `import { Renderer, Marked } from "marked";
  const markdown = new Marked();
  markdown.use({ renderer: { code(token) { return Renderer.prototype.code.call(this, token); } } });
  export const format = source => markdown.parse(source);`;
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "react-doctor-readonly-prototype-"),
);
let sdkFixtureNumber = 0;
const rendererPackageManifest = {
  name: "marked",
  version: "18.0.14",
  type: "module",
  main: "./lib/marked.esm.js",
  module: "./lib/marked.esm.js",
  browser: "./lib/marked.umd.js",
  exports: {
    ".": { types: "./lib/marked.d.ts", default: "./lib/marked.esm.js" },
    "./bin/marked": "./bin/marked.js",
    "./package.json": "./package.json",
  },
};

const fixture = (
  consumer = consumerSource,
  constructorSource = sourceClass,
  additionalModules: Readonly<Record<string, string>> = {},
  rootDirectory = "/readonly-prototype-fixture",
): PrototypeFixture => {
  const sourceByName: Readonly<Record<string, string>> = {
    "consumer.ts": consumer,
    "sdk.ts": constructorSource,
    ...additionalModules,
  };
  const modules = new Map<string, SourceProjectModule>();
  for (const [name, source] of Object.entries(sourceByName)) {
    const parsed = parseFixture(source);
    expect(parsed.errors).toEqual([]);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program fixture");
    attachParentReferences(parsed.program);
    const filePath = normalizeFilename(path.resolve(rootDirectory, name));
    modules.set(filePath, {
      filePath,
      programNode: parsed.program,
      scopes: analyzeScopes(parsed.program),
    });
  }
  const consumers = new Map<string, Set<SourceProjectModule>>();
  const resolvedPaths = new WeakMap<EsTreeNode, string>();
  for (const module of modules.values())
    walkAst(module.programNode, (node) => {
      const source = isNodeOfType(node, "ImportExpression")
        ? getStaticStringExpression(node.source)
        : getRuntimeStaticDependencySource(node);
      if (!source?.startsWith(".")) return;
      const basePath = normalizeFilename(path.resolve(path.dirname(module.filePath), source));
      const filePath = [basePath, `${basePath}.ts`].find((candidate) => modules.has(candidate));
      if (!filePath) return;
      resolvedPaths.set(node, filePath);
      const sourceConsumers = consumers.get(filePath) ?? new Set();
      sourceConsumers.add(module);
      consumers.set(filePath, sourceConsumers);
    });
  const module = modules.get(normalizeFilename(path.resolve(rootDirectory, "consumer.ts")));
  if (!module) throw new Error("Missing consumer fixture");
  let prototype: EsTreeNode | null = null;
  walkAst(module.programNode, (node) => {
    if (
      !prototype &&
      isNodeOfType(node, "MemberExpression") &&
      getResolvedStaticPropertyName(node, module.scopes) === "prototype"
    )
      prototype = node;
  });
  if (!prototype) throw new Error("Missing prototype fixture");
  return {
    module,
    prototype,
    project: {
      modulesByFilePath: modules,
      htmlFilePaths: [],
      consumerModulesByFilePath: consumers,
      resolvedSourcePathByNode: resolvedPaths,
      unresolvedRuntimeSources: new Set(),
      hasOpaqueMdxConsumerSurface: false,
    },
  };
};

const sdkFixture = (
  consumer = consumerSource.replace('"./sdk"', '"marked"').replace(".echo.", ".code."),
  installedChanges: Readonly<Record<string, unknown>> = {},
  additionalModules: Readonly<Record<string, string>> = {},
): PrototypeFixture => {
  sdkFixtureNumber += 1;
  const directory = path.join(temporaryDirectory, String(sdkFixtureNumber));
  const installedDirectory = path.join(directory, "node_modules", "marked");
  fs.mkdirSync(installedDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ dependencies: { marked: "18.0.14" } }),
  );
  fs.writeFileSync(
    path.join(installedDirectory, "package.json"),
    JSON.stringify({ ...rendererPackageManifest, ...installedChanges }),
  );
  for (const [name, source] of Object.entries({
    "consumer.ts": consumer,
    "sdk.ts": sourceClass,
    ...additionalModules,
  })) {
    fs.writeFileSync(path.join(directory, name), source);
  }
  return fixture(consumer, sourceClass, additionalModules, directory);
};

const certifies = (
  consumer = consumerSource,
  constructorSource = sourceClass,
  additionalModules: Readonly<Record<string, string>> = {},
): boolean => {
  const current = fixture(consumer, constructorSource, additionalModules);
  return certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project);
};

describe("certifyReadonlySourcePrototypeUse", () => {
  beforeEach(() => resetFilesystemCaches());
  afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  it("proves a fresh source class and its immediate own data-method call", () => {
    expect(certifies()).toBe(true);
  });

  it("supports ESTree hosts that omit optional decorator arrays", () => {
    const current = fixture();
    for (const module of current.project.modulesByFilePath.values())
      walkAst(module.programNode, (node) => {
        if (
          isNodeOfType(node, "ClassExpression") ||
          isNodeOfType(node, "ClassDeclaration") ||
          isNodeOfType(node, "MethodDefinition")
        )
          Reflect.deleteProperty(node, "decorators");
      });
    expect(() =>
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).not.toThrow();
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("supports a private same-module class", () => {
    expect(
      certifies(
        `const Renderer = class { echo(token) { return token; } }; export function fallback(token) { return Renderer.prototype.echo.call(this, token); }`,
      ),
    ).toBe(true);
  });

  it("supports readonly constructor aliases and renamed imports", () => {
    expect(
      certifies(
        `import { Renderer as SourceRenderer } from "./sdk"; const First = SourceRenderer; const Renderer = First; export function fallback(token) { return Renderer.prototype.echo.call(this, token); }`,
      ),
    ).toBe(true);
  });

  it("supports named source class declarations", () => {
    expect(
      certifies(consumerSource, "export class Renderer { echo(token) { return token; } }"),
    ).toBe(true);
  });

  it("supports anonymous default source class declarations", () => {
    expect(
      certifies(
        consumerSource.replace("{ Renderer }", "Renderer"),
        "export default class { echo(token) { return token; } }",
      ),
    ).toBe(true);
  });

  it("supports a source class selected through a readonly local export alias", () => {
    expect(
      certifies(
        consumerSource,
        "const Source = class { echo(token) { return token; } }; const Alias = Source; export { Alias as Renderer };",
      ),
    ).toBe(true);
  });

  it("supports a readonly named import exposed through a local export", () => {
    expect(
      certifies(consumerSource.replace('"./sdk"', '"./bridge"'), sourceClass, {
        "bridge.ts": 'import { Renderer } from "./sdk"; export { Renderer };',
      }),
    ).toBe(true);
  });

  it("proves literal-returning methods and lexical primitive receivers", () => {
    expect(
      certifies(
        consumerSource.replace("echo.call(this, token)", "echo.call(null)"),
        'export const Renderer = class { echo() { return "ready"; } };',
      ),
    ).toBe(true);
  });

  it("proves several unique closed own methods", () => {
    expect(
      certifies(
        `${consumerSource} export function second(token) { return Renderer.prototype.other.call(undefined, token); }`,
        "export const Renderer = class { echo(token) { return token; } other(token) { return token; } };",
      ),
    ).toBe(true);
  });

  it("admits the metadata-proven canonical Renderer own-method role", () => {
    const current = sdkFixture();
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("admits readonly verified SDK constructor aliases", () => {
    const current = sdkFixture(
      'import { Renderer as SourceRenderer } from "marked"; const Renderer = SourceRenderer; export function fallback(token) { return Renderer.prototype.code.call(this, token); }',
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("admits an owned Marked instance with inline renderer methods and parse", () => {
    const current = sdkFixture(markedInstanceSource);
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("admits ordinary inline constructor and parse boolean options", () => {
    const current = sdkFixture(
      markedInstanceSource
        .replace("new Marked()", "new Marked({ gfm: true, breaks: false })")
        .replace("markdown.parse(source)", "markdown.parse(source, { async: false })"),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("admits inline constructor renderer configuration", () => {
    const current = sdkFixture(
      markedInstanceSource.replace(
        "const markdown = new Marked();\n  markdown.use({ renderer: { code(token) { return Renderer.prototype.code.call(this, token); } } });",
        "const markdown = new Marked({ renderer: { code(token) { return Renderer.prototype.code.call(this, token); } } });",
      ),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("admits private instance aliases and use chaining", () => {
    const current = sdkFixture(
      markedInstanceSource
        .replace(
          "const markdown = new Marked();",
          "const original = new Marked(); const markdown = original;",
        )
        .replace("markdown.parse(source)", "markdown.use({ gfm: true }).parse(source)"),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("admits a renderer callback's immediate SDK parser calls", () => {
    const current = sdkFixture(
      markedInstanceSource.replace(
        "return Renderer.prototype.code.call(this, token);",
        "const rendered = this.parser.parseInline(token.tokens); return Renderer.prototype.code.call(this, token);",
      ),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("admits primitive captures and directly called readonly synchronous helpers", () => {
    const current = sdkFixture(
      markedInstanceSource
        .replace(
          "const markdown = new Marked();",
          'const prefix = "code:"; const label = value => value; const markdown = new Marked();',
        )
        .replace(
          "return Renderer.prototype.code.call(this, token);",
          "const text = label(token.text); return prefix + Renderer.prototype.code.call(this, token);",
        ),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it("admits finite facade use and parse without exposing the facade", () => {
    const current = sdkFixture(
      markedInstanceSource
        .replace("{ Renderer, Marked }", "{ Renderer, marked }")
        .replace("const markdown = new Marked();", "const markdown = marked;"),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it.each([
    [
      "constructor config alias",
      markedInstanceSource.replace("new Marked()", "new Marked(options)"),
    ],
    [
      "constructor getter",
      markedInstanceSource.replace("new Marked()", "new Marked({ get gfm() { return true; } })"),
    ],
    [
      "constructor spread",
      markedInstanceSource.replace("new Marked()", "new Marked({ ...options })"),
    ],
    [
      "use config alias",
      markedInstanceSource.replace(
        "markdown.use({ renderer:",
        "markdown.use(options); markdown.use({ renderer:",
      ),
    ],
    [
      "renderer config getter",
      markedInstanceSource.replace(
        "renderer: { code",
        "get renderer() { return external; }, other: { code",
      ),
    ],
    [
      "renderer config spread",
      markedInstanceSource.replace("renderer: { code", "renderer: { ...external, code"),
    ],
    [
      "unknown option",
      markedInstanceSource.replace("new Marked()", "new Marked({ hooks: external })"),
    ],
    [
      "parse getter options",
      markedInstanceSource.replace(
        "markdown.parse(source)",
        "markdown.parse(source, { get async() { return false; } })",
      ),
    ],
    [
      "parse spread options",
      markedInstanceSource.replace(
        "markdown.parse(source)",
        "markdown.parse(source, { ...options })",
      ),
    ],
    [
      "parse config alias",
      markedInstanceSource.replace("markdown.parse(source)", "markdown.parse(source, options)"),
    ],
    ["instance publication", `${markedInstanceSource} publish(markdown);`],
    [
      "instance export",
      markedInstanceSource.replace("const markdown =", "export const markdown ="),
    ],
    ["mutable instance alias", `${markedInstanceSource} let other = markdown;`],
    ["instance reflection", `${markedInstanceSource} publish(markdown.Renderer);`],
    ["instance defaults escape", `${markedInstanceSource} publish(markdown.defaults);`],
    ["instance parse method escape", `${markedInstanceSource} register(markdown.parse);`],
    [
      "SDKthis publication",
      markedInstanceSource.replace(
        "return Renderer.prototype",
        "publish(this); return Renderer.prototype",
      ),
    ],
    [
      "SDKthis constructor escape",
      markedInstanceSource.replace(
        "return Renderer.prototype",
        "publish(this.constructor); return Renderer.prototype",
      ),
    ],
    [
      "SDKthis parser renderer escape",
      markedInstanceSource.replace(
        "return Renderer.prototype",
        "publish(this.parser.renderer); return Renderer.prototype",
      ),
    ],
    [
      "SDKthis parser alias",
      markedInstanceSource.replace(
        "return Renderer.prototype",
        "const parser = this.parser; return Renderer.prototype",
      ),
    ],
    [
      "SDKthis nested async capture",
      markedInstanceSource.replace(
        "return Renderer.prototype",
        "launch(async () => { await load(); publish(this); }); return Renderer.prototype",
      ),
    ],
    [
      "token constructor capability",
      markedInstanceSource.replace(
        "return Renderer.prototype",
        "publish(token.constructor); return Renderer.prototype",
      ),
    ],
    [
      "unknown computed token capability",
      markedInstanceSource.replace(
        "return Renderer.prototype",
        "publish(token[key]); return Renderer.prototype",
      ),
    ],
    [
      "constructor callback dispatcher capture",
      `import { useState } from "react"; ${markedInstanceSource.replace("const markdown = new Marked();", 'const [value, setValue] = useState(""); const markdown = new Marked();').replace("return Renderer.prototype", 'setValue("late"); return Renderer.prototype')}`,
    ],
    [
      "callback async dispatcher capture",
      `import { useState } from "react"; ${markedInstanceSource.replace("const markdown = new Marked();", 'const [value, setValue] = useState(""); const markdown = new Marked();').replace("return Renderer.prototype", 'launch(async () => { await load(); setValue("late"); }); return Renderer.prototype')}`,
    ],
    [
      "callback reachable dispatcher helper",
      `import { useState } from "react"; ${markedInstanceSource.replace("const markdown = new Marked();", 'const [value, setValue] = useState(""); const update = () => setValue("late"); const markdown = new Marked();').replace("return Renderer.prototype", "update(); return Renderer.prototype")}`,
    ],
    [
      "callback ref capture",
      `import { useRef } from "react"; ${markedInstanceSource.replace("const markdown = new Marked();", "const host = useRef(null); const markdown = new Marked();").replace("return Renderer.prototype", "publish(host); return Renderer.prototype")}`,
    ],
    [
      "callback signal capture",
      markedInstanceSource
        .replace(
          "const markdown = new Marked();",
          "const controller = new AbortController(); const signal = controller.signal; const markdown = new Marked();",
        )
        .replace("return Renderer.prototype", "publish(signal); return Renderer.prototype"),
    ],
    [
      "unknown SDK export direct call",
      `${markedInstanceSource} import { Lexer } from "marked"; Lexer("tile");`,
    ],
    [
      "facade parse renderer options",
      `${markedInstanceSource} import { marked } from "marked"; marked("tile", { renderer: external });`,
    ],
  ])("refuses finite Marked instance/callback boundary %s", (_label, source) => {
    const current = sdkFixture(source);
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(false);
  });

  it.each([
    'let holder = { launch() { return "ready"; } };',
    'const holder = { launch() { return "ready"; } };',
    'const holder = {}; holder.launch = () => "ready";',
    'const holder = []; holder.launch = () => "ready";',
    'const holder = () => "ready"; holder.launch = () => "ready";',
    'const holder = { get launch() { return () => "ready"; } };',
  ])("refuses unproved captured member-receiver capabilities: %s", (declaration) => {
    const current = sdkFixture(
      markedInstanceSource
        .replace("const markdown = new Marked();", `${declaration} const markdown = new Marked();`)
        .replace(
          "return Renderer.prototype.code.call(this, token);",
          "holder.launch(); return Renderer.prototype.code.call(this, token);",
        ),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(false);
  });

  it.each(["const helper = async value => value;", "function* helper(value) { return value; }"])(
    "refuses captured asynchronous and generator helper capabilities: %s",
    (declaration) => {
      const current = sdkFixture(
        markedInstanceSource
          .replace(
            "const markdown = new Marked();",
            `${declaration} const markdown = new Marked();`,
          )
          .replace(
            "return Renderer.prototype.code.call(this, token);",
            "helper(token.text); return Renderer.prototype.code.call(this, token);",
          ),
      );
      expect(
        certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
      ).toBe(false);
    },
  );

  it.each(["document", "window.document", "globalThis.document"])(
    "refuses captured native document capability %s",
    (capture) => {
      const current = sdkFixture(
        markedInstanceSource.replace(
          "return Renderer.prototype.code.call(this, token);",
          `publish(${capture}); return Renderer.prototype.code.call(this, token);`,
        ),
      );
      expect(
        certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
      ).toBe(false);
    },
  );

  it("admits direct parser calls without exposing the SDK capability object", () => {
    const current = sdkFixture(
      'import { Renderer, marked } from "marked"; export function fallback(token) { return Renderer.prototype.code.call(this, token); } export function parse(token) { return marked(token); }',
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it.each([
    'import * as sdk from "marked"; sdk.Renderer.prototype.code = foreign;',
    "publish(Renderer);",
    'Object.defineProperty(Renderer.prototype, "code", { get: () => foreign });',
    'import { marked as sdk } from "marked"; sdk.Renderer.prototype.code = foreign;',
    'import { marked as sdk } from "marked"; publish(sdk);',
    'import("marked").then(publish);',
    'import { Renderer as Alternate } from "marked/lib/marked.esm.js"; publish(Alternate);',
    "register(Renderer.prototype.code);",
  ])("refuses alternate verified SDK capability escapes and mutations: %s", (extra) => {
    const current = sdkFixture(
      `${consumerSource.replace('"./sdk"', '"marked"').replace(".echo.", ".code.")} ${extra}`,
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(false);
  });

  it("refuses SDK metadata whose installed version contradicts the declared role", () => {
    const current = sdkFixture(undefined, { version: "18.0.15" });
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(false);
  });

  it("closes SDK constructor publication in another source module", () => {
    const current = sdkFixture(
      undefined,
      {},
      { "other.ts": 'import { Renderer } from "marked"; publish(Renderer);' },
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(false);
  });

  it.each([
    ["opaque external package", consumerSource.replace('"./sdk"', '"render-sdk"')],
    [
      "unverified canonical SDK metadata",
      consumerSource.replace('"./sdk"', '"marked"').replace("echo", "code"),
    ],
    [
      "native constructor alias",
      consumerSource.replace('import { Renderer } from "./sdk";', "const Renderer = AbortSignal;"),
    ],
    [
      "native instance constructor alias",
      consumerSource.replace(
        'import { Renderer } from "./sdk";',
        "const Renderer = new AbortController().signal.constructor;",
      ),
    ],
    [
      "namespace constructor acquisition",
      consumerSource
        .replace('import { Renderer } from "./sdk";', 'import * as sdk from "./sdk";')
        .replace("Renderer.prototype", "sdk.Renderer.prototype"),
    ],
    ["constructor value escape", `${consumerSource} publish(Renderer);`],
    ["constructor instance escape", `${consumerSource} publish(new Renderer());`],
    ["constructor inheritance escape", `${consumerSource} class Other extends Renderer {}`],
    ["mutable constructor alias", `${consumerSource} let Alias = Renderer; Alias = foreign;`],
    ["constructor reassignment", `${consumerSource} Renderer = foreign;`],
    ["prototype alias", `${consumerSource} const saved = Renderer.prototype;`],
    ["prototype writer", `${consumerSource} Renderer.prototype.echo = foreign;`],
    ["method property writer", `${consumerSource} Renderer.prototype.echo.call = foreign;`],
    [
      "prototype descriptor writer",
      `${consumerSource} Object.defineProperty(Renderer.prototype, "echo", { get: foreign });`,
    ],
    ["method callback escape", `${consumerSource} register(Renderer.prototype.echo);`],
    ["method alias", `${consumerSource} const saved = Renderer.prototype.echo;`],
    [
      "prototype mutator call",
      `${consumerSource} Renderer.prototype.__defineGetter__("echo", foreign);`,
    ],
    ["unknown selected method", consumerSource.replace(".echo.call", ".missing.call")],
    [
      "apply invocation",
      consumerSource.replace(".echo.call(this, token)", ".echo.apply(this, [token])"),
    ],
    [
      "bound invocation",
      consumerSource.replace(".echo.call(this, token)", ".echo.bind(this)(token)"),
    ],
    [
      "optional invocation",
      consumerSource.replace(".echo.call(this, token)", ".echo.call?.(this, token)"),
    ],
    [
      "getter argument",
      consumerSource.replace(".echo.call(this, token)", ".echo.call(this, external.token)"),
    ],
    [
      "effectful argument",
      consumerSource.replace(".echo.call(this, token)", ".echo.call(this, load())"),
    ],
    [
      "spread argument",
      consumerSource.replace(".echo.call(this, token)", ".echo.call(this, ...tokens)"),
    ],
    [
      "native receiver argument",
      consumerSource.replace(".echo.call(this, token)", ".echo.call(controller.signal, token)"),
    ],
    [
      "extra method argument",
      consumerSource.replace(".echo.call(this, token)", ".echo.call(this, token, 1)"),
    ],
    [
      "unknown global argument",
      consumerSource.replace(".echo.call(this, token)", ".echo.call(this, globalValue)"),
    ],
    ["global loader escape", `${consumerSource} const load = require; publish(load);`],
    [
      "global member loader escape",
      `${consumerSource} const load = globalThis.require; publish(load);`,
    ],
    [
      "node loader import",
      `${consumerSource} import { createRequire } from "node:module"; const load = createRequire(import.meta.url);`,
    ],
    [
      "runtime import-equals loader",
      `${consumerSource} import sdk = require("./sdk"); publish(sdk);`,
    ],
    ["dynamic constructor acquisition", `${consumerSource} import("./sdk").then(publish);`],
    ["unknown dynamic acquisition", `${consumerSource} import(source).then(publish);`],
  ])("refuses %s", (_label, consumer) => {
    expect(certifies(consumer)).toBe(false);
  });

  it.each([
    ["native alias export", "export const Renderer = AbortSignal;"],
    [
      "native superclass",
      "export const Renderer = class extends EventTarget { echo(token) { return token; } };",
    ],
    [
      "class replacement decorator",
      "export const Renderer = @replace class { echo(token) { return token; } };",
    ],
    [
      "static block",
      "export const Renderer = class { static { notify(); } echo(token) { return token; } };",
    ],
    [
      "instance field",
      "export const Renderer = class { value = notify(); echo(token) { return token; } };",
    ],
    [
      "explicit constructor",
      "export const Renderer = class { constructor() {} echo(token) { return token; } };",
    ],
    ["method getter", "export const Renderer = class { get echo() { return foreign; } };"],
    [
      "unrelated getter",
      "export const Renderer = class { echo(token) { return token; } get other() { return foreign; } };",
    ],
    [
      "duplicate method",
      "export const Renderer = class { echo(token) { return token; } echo(token) { return token; } };",
    ],
    ["computed method", "export const Renderer = class { [key](token) { return token; } };"],
    ["async method", "export const Renderer = class { async echo(token) { return token; } };"],
    ["generator method", "export const Renderer = class { *echo(token) { return token; } };"],
    [
      "parameter getter evaluation",
      "export const Renderer = class { echo({ token }) { return token; } };",
    ],
    [
      "default parameter evaluation",
      "export const Renderer = class { echo(token = notify()) { return token; } };",
    ],
    ["getter return", "export const Renderer = class { echo(token) { return token.value; } };"],
    ["coercion return", "export const Renderer = class { echo(token) { return String(token); } };"],
    [
      "application call",
      "export const Renderer = class { echo(token) { notify(); return token; } };",
    ],
    [
      "method callback invocation",
      "export const Renderer = class { echo(token) { return token(); } };",
    ],
    [
      "mutable class binding",
      "export let Renderer = class { echo(token) { return token; } }; Renderer = foreign;",
    ],
    ["ambient class", "export declare class Renderer { echo(token): unknown; }"],
  ])("refuses %s", (_label, constructorSource) => {
    expect(certifies(consumerSource, constructorSource)).toBe(false);
  });

  it("checks other source consumers of the same constructor", () => {
    expect(
      certifies(consumerSource, sourceClass, {
        "other.ts": 'import { Renderer } from "./sdk"; publish(Renderer);',
      }),
    ).toBe(false);
    expect(
      certifies(consumerSource, sourceClass, {
        "other.ts": 'import * as sdk from "./sdk"; publish(sdk);',
      }),
    ).toBe(false);
    expect(
      certifies(consumerSource, sourceClass, { "other.ts": 'export { Renderer } from "./sdk";' }),
    ).toBe(false);
    expect(
      certifies(consumerSource, sourceClass, {
        "other.ts":
          'import { Renderer } from "./sdk"; export function fallback(token) { return Renderer.prototype.echo.call(this, token); }',
      }),
    ).toBe(true);
  });

  it("refuses opaque consumer surfaces", () => {
    const current = fixture();
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, {
        ...current.project,
        hasOpaqueMdxConsumerSurface: true,
      }),
    ).toBe(false);
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, {
        ...current.project,
        htmlFilePaths: ["/page.html"],
      }),
    ).toBe(false);
  });

  it("refuses a module detached from its current project evidence", () => {
    const current = fixture();
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, { ...current.module }, current.project),
    ).toBe(false);
  });

  it("bounds constructor alias resolution", () => {
    const aliases = Array.from(
      { length: NATIVE_DELAY_MAX_ALIAS_DEPTH },
      (_value, index) => `const Alias${index} = ${index === 0 ? "Renderer" : `Alias${index - 1}`};`,
    ).join("\n");
    expect(
      certifies(
        `import { Renderer } from "./sdk"; ${aliases} export function fallback(token) { return Alias${NATIVE_DELAY_MAX_ALIAS_DEPTH - 1}.prototype.echo.call(this, token); }`,
      ),
    ).toBe(false);
  });

  it("rechecks changed sources and newly added consumers with a fresh index", () => {
    expect(certifies()).toBe(true);
    expect(
      certifies(
        consumerSource,
        "export const Renderer = class { echo(token) { return token.value; } };",
      ),
    ).toBe(false);
    expect(
      certifies(consumerSource, sourceClass, {
        "new-consumer.ts": 'import { Renderer } from "./sdk"; register(Renderer.prototype.echo);',
      }),
    ).toBe(false);
  });
});

const ownedBuilderSource = `import {Marked,Renderer} from 'marked';
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

describe("owned SDK renderer builders", () => {
  it("preserves an authoritative fallback through a transparent receiver assertion", () => {
    const current = sdkFixture(
      ownedBuilderSource.replace(
        "Renderer.prototype.code.call",
        "(Renderer.prototype.code as any).call",
      ),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });

  it.each(["original", "asserted"])(
    "preserves an authoritative parser call with %s receiver",
    (form) => {
      const source = ownedBuilderSource
        .replaceAll("code(", "heading(")
        .replaceAll(".code.", ".heading.")
        .replace("token.text", "this.parser.parseInline(token.tokens)");
      const candidate =
        form === "original"
          ? source
          : source.replace("this.parser.parseInline", "(this.parser as any).parseInline");
      const current = sdkFixture(candidate);
      expect(
        certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
      ).toBe(true);
    },
  );

  it.each([
    ["link", "token.href"],
    ["image", "token.href"],
    ["image", "token.text"],
    ["image", "token.title.trim()"],
    ["image", "(token.title ?? '').trim()"],
  ])("accepts official own %s field %s", (method, field) => {
    const source = ownedBuilderSource
      .replaceAll("code(", `${method}(`)
      .replaceAll(".code.", `.${method}.`)
      .replace("token.text", field);
    const current = sdkFixture(source);
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });
  it("refuses omitted Link.title even with a scalar fallback", () => {
    const current = sdkFixture(
      ownedBuilderSource
        .replaceAll("code(", "link(")
        .replaceAll(".code.", ".link.")
        .replace("token.text", "token.title ?? ''"),
    );
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(false);
  });

  it("accepts module scalar formatting and bounded callback branches", () => {
    const source = ownedBuilderSource
      .replace(
        "export const build",
        "const normalize=value=>value.replace(/[^a-z ]/gi,'').trim().toLowerCase(); export const build",
      )
      .replace("const key=token.text", "const key=normalize(token.text)")
      .replace(
        "records.push({key,count});",
        "if ((/^skip/.test(key) || key.startsWith('omit')) && count >= 1) { records.push({key,count}); return ''; } if(key === 'quiet') return false; records.push({key:key ? key : 'empty',count});",
      );
    const current = sdkFixture(source);
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });
  it("accepts source-proven synchronous scalar record collection", () => {
    const current = sdkFixture(ownedBuilderSource);
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(true);
  });
  it.each([
    ["array seed", "const records=[]", "const records=[foreign]"],
    ["map capability", "counts.set(key,count)", "counts.set(key,document)"],
    ["early array publication", "markdown.use", "publish(records); markdown.use"],
    ["second parse", "const html=", "markdown.parse(source,{async:false}); const html="],
    [
      "live parser return",
      "return {html,records}",
      "return {html,records:()=>markdown.parse(source)}",
    ],
    ["async output", "async:false", "async:true"],
    ["native map replacement", "import {Marked,Renderer}", "import {Marked,Renderer}"],
  ])("refuses %s", (label, before, after) => {
    const source =
      ownedBuilderSource.replace(before, after) +
      (label === "native map replacement" ? "\nglobalThis.Map=foreign;" : "");
    const current = sdkFixture(source);
    expect(
      certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
    ).toBe(false);
  });
});

describe("readonly prototype inventory with erased defaults in another module", () => {
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
      nextVersion: "~16.3.6",
      expected: false,
    },
    {
      label: "type before prototype escape",
      emission: "type Model = {}; const Model = Renderer.prototype; export default Model;",
      configuration: "{}",
      nextVersion: "16.3.6",
      expected: false,
    },
    {
      label: "prototype escape before type",
      emission: "const Model = Renderer.prototype; type Model = {}; export default Model;",
      configuration: "{}",
      nextVersion: "16.3.6",
      expected: false,
    },
  ])(
    "keeps the source-class proof causal for $label",
    ({ emission, configuration, nextVersion, expected }) => {
      const directory = fs.mkdtempSync(path.join(temporaryDirectory, "erasure-"));
      const constructorSource = `${sourceClass}\n${emission}`;
      fs.writeFileSync(path.join(directory, "consumer.ts"), consumerSource);
      fs.writeFileSync(path.join(directory, "sdk.ts"), constructorSource);
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          dependencies: { next: nextVersion, react: "19.0.0", "react-dom": "19.0.0" },
        }),
      );
      fs.writeFileSync(path.join(directory, "tsconfig.json"), configuration);
      resetFilesystemCaches();
      const current = fixture(consumerSource, constructorSource, {}, directory);
      const project = { ...current.project, rootDirectory: directory };
      expect(certifyReadonlySourcePrototypeUse(current.prototype, current.module, project)).toBe(
        expected,
      );
      if (expected)
        expect(
          certifyReadonlySourcePrototypeUse(current.prototype, current.module, current.project),
        ).toBe(false);
    },
  );

  it("rechecks the same source-class graph after emitter metadata changes", () => {
    const directory = fs.mkdtempSync(path.join(temporaryDirectory, "erasure-cache-"));
    const constructorSource = `${sourceClass}\ntype Model = {}; export default Model;`;
    fs.writeFileSync(path.join(directory, "consumer.ts"), consumerSource);
    fs.writeFileSync(path.join(directory, "sdk.ts"), constructorSource);
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "16.3.6", react: "19.0.0", "react-dom": "19.0.0" } }),
    );
    fs.writeFileSync(path.join(directory, "tsconfig.json"), "{}");
    const current = fixture(consumerSource, constructorSource, {}, directory);
    const project = { ...current.project, rootDirectory: directory };
    resetFilesystemCaches();
    expect(certifyReadonlySourcePrototypeUse(current.prototype, current.module, project)).toBe(
      true,
    );
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "16.3.5", react: "19.0.0", "react-dom": "19.0.0" } }),
    );
    resetFilesystemCaches();
    expect(certifyReadonlySourcePrototypeUse(current.prototype, current.module, project)).toBe(
      false,
    );
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { next: "16.3.6", react: "19.0.0", "react-dom": "19.0.0" } }),
    );
    resetFilesystemCaches();
    expect(certifyReadonlySourcePrototypeUse(current.prototype, current.module, project)).toBe(
      true,
    );
  });
});
