import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { isNodeOfType } from "../is-node-of-type.js";
import type { RuleContext } from "../rule-context.js";
import {
  OWNED_NATIVE_DOM_PROJECT_NODE_BUDGET,
  OWNED_NATIVE_DOM_LUCIDE_NAMES,
  OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT,
} from "./owned-native-dom/constants.js";
import { walkAst } from "../walk-ast.js";
import {
  certifyOwnedNativeDomOperation,
  certifyOwnedNativeDomMutation,
  isOwnedNativeCollection,
  isOwnedNativeEventDispatch,
  isOwnedNativePrimitive,
  isOwnedNativeRefValue,
  isClosedReactRefRead,
} from "./certify-owned-native-dom-operation.js";

interface NativeDomFixtureOptions {
  readonly imports?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly overflowInventory?: boolean;
  readonly reuseCurrentModule?: SourceProjectModule;
  readonly captureCurrentModule?: (module: SourceProjectModule) => void;
  readonly opaqueConsumerSurface?: boolean;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

const certify = (
  body: string,
  template = '<div ref={host}><button data-key="tile"><span>Tile</span></button></div>',
  extraModules: Readonly<Record<string, string>> = {},
  mode: "call" | "primitive" | "mutation" | "collection" | "event" | "ref" | "read" = "call",
  options: NativeDomFixtureOptions = {},
): boolean => {
  const directory = options.dependencies
    ? fs.mkdtempSync(path.join(os.tmpdir(), "native-ui-host-"))
    : null;
  if (directory) {
    temporaryDirectories.push(directory);
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          next: "^16.0.0",
          ...options.dependencies,
        },
      }),
    );
  }
  const extraModulePaths = new Map(
    Object.keys(extraModules).map((filePath) => [
      filePath,
      directory ? path.join(directory, path.basename(filePath)) : filePath,
    ]),
  );
  const code = `import { useRef } from "react"; ${options.imports ?? ""}
    ${Object.keys(extraModules)
      .map((filePath) => `import { Visual } from "${extraModulePaths.get(filePath)}";`)
      .join("\n")}
    function View() { const host = useRef(null); ${body}; return ${template}; }`;
  const parseModule = (filePath: string, source: string): SourceProjectModule => {
    const parsed = parseFixture(source);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("expected program");
    return { filePath, programNode: parsed.program, scopes: analyzeScopes(parsed.program) };
  };
  const currentModule =
    options.reuseCurrentModule ??
    parseModule(directory ? path.join(directory, "view.tsx") : "/public/view.tsx", code);
  options.captureCurrentModule?.(currentModule);
  if (directory) fs.writeFileSync(currentModule.filePath, code);
  const modules = new Map<string, SourceProjectModule>([[currentModule.filePath, currentModule]]);
  for (const [filePath, source] of Object.entries(extraModules)) {
    const modulePath = extraModulePaths.get(filePath) ?? filePath;
    modules.set(modulePath, parseModule(modulePath, source));
    if (directory) fs.writeFileSync(modulePath, source);
  }
  if (options.overflowInventory) {
    const inventoryModule = [...modules.values()].at(-1);
    if (!inventoryModule) throw new Error("expected inventory module");
    let nodeCount = 0;
    walkAst(inventoryModule.programNode, () => {
      nodeCount += 1;
    });
    const copies = Math.ceil(OWNED_NATIVE_DOM_PROJECT_NODE_BUDGET / nodeCount) + 1;
    for (let index = 0; index < copies; index += 1) {
      const filePath = `${inventoryModule.filePath}.inventory-${index}.tsx`;
      modules.set(filePath, { ...inventoryModule, filePath });
    }
  }
  const resolvedSourcePathByNode = new WeakMap<EsTreeNode, string>();
  const consumerModulesByFilePath = new Map<string, Set<SourceProjectModule>>();
  for (const module of modules.values())
    walkAst(module.programNode, (candidate) => {
      if (
        isNodeOfType(candidate, "ImportDeclaration") &&
        typeof candidate.source.value === "string" &&
        modules.has(candidate.source.value)
      ) {
        resolvedSourcePathByNode.set(candidate, candidate.source.value);
        const consumers = consumerModulesByFilePath.get(candidate.source.value) ?? new Set();
        consumers.add(module);
        consumerModulesByFilePath.set(candidate.source.value, consumers);
      }
    });
  const projectIndex: SourceProjectIndex = {
    modulesByFilePath: modules,
    consumerModulesByFilePath,
    resolvedSourcePathByNode,
    unresolvedRuntimeSources: new Set(),
    htmlFilePaths: [],
    hasOpaqueMdxConsumerSurface: options.opaqueConsumerSurface ?? false,
  };
  const context: RuleContext = {
    scopes: currentModule.scopes,
    cfg: analyzeControlFlow(currentModule.programNode),
    report: () => {},
    sourceCode: { ast: currentModule.programNode },
    filename: currentModule.filePath,
  };
  let verdict: EsTreeNode | null = null;
  walkAst(currentModule.programNode, (candidate) => {
    if (
      isNodeOfType(candidate, "VariableDeclarator") &&
      isNodeOfType(candidate.id, "Identifier") &&
      candidate.id.name === "verdict"
    )
      verdict = candidate.init;
  });
  if (!verdict) throw new Error("expected verdict");
  if (mode === "primitive") return isOwnedNativePrimitive(verdict, context, projectIndex);
  if (mode === "mutation") return certifyOwnedNativeDomMutation(verdict, context, projectIndex);
  if (mode === "collection") return isOwnedNativeCollection(verdict, context, projectIndex);
  if (mode === "ref") return isOwnedNativeRefValue(verdict, context, projectIndex);
  if (mode === "read") return isClosedReactRefRead(verdict, context, projectIndex);
  if (!isNodeOfType(verdict, "CallExpression")) throw new Error("expected call");
  if (mode === "event") return isOwnedNativeEventDispatch(verdict, context, projectIndex);
  return certifyOwnedNativeDomOperation(verdict, context, projectIndex);
};

describe("owned native DOM source certificate", () => {
  it("reads a private ref data property without requiring an opaque child subtree", () => {
    const body =
      "const OpaqueChild = () => <x-widget />; if (!host.current) return; const verdict = host.current";
    expect(certify(body, "<div ref={host}><OpaqueChild /></div>", {}, "read")).toBe(true);
    expect(certify(body, "<div ref={host}><OpaqueChild /></div>", {}, "ref")).toBe(false);
    expect(
      certify(
        body.replace(
          "const verdict = host.current",
          "const verdict = host.current.cloneNode(true)",
        ),
        "<div ref={host}><OpaqueChild /></div>",
      ),
    ).toBe(false);
  });

  it.each([
    "const alias = host; if (!alias.current) return; const verdict = alias.current",
    "const first = host; const alias = first; const verdict = alias.current",
    "publish(host.current); const verdict = host.current",
    "delete host.current.title; const verdict = host.current",
  ])("closes private ref data reads independently of node contents: %s", (body) => {
    expect(certify(body, "<div ref={host}><OpaqueChild /></div>", {}, "read")).toBe(true);
  });

  it("ignores unrelated native world contradictions for a private ref data read", () => {
    const modules = {
      "/public/noise.tsx":
        'document.querySelector("aside"); Node.prototype.cloneNode = () => null; export const Visual = () => null;',
    };
    expect(
      certify(
        "const verdict = host.current",
        "<div ref={host}><OpaqueChild /></div>",
        modules,
        "read",
      ),
    ).toBe(true);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><OpaqueChild /></div>",
        modules,
      ),
    ).toBe(false);
  });

  it.each([
    "publish(host); const verdict = host.current",
    'Object.defineProperty(host, "current", { get: () => false }); const verdict = host.current',
    'const alias = host; Object.defineProperty(alias, "current", { get: () => false }); const verdict = host.current',
    "delete host.current; const verdict = host.current",
    "const alias = host; delete alias.current; const verdict = alias.current",
    "let alias = host; const verdict = alias.current",
    "let alias = host; alias = {}; const verdict = host.current",
    "host.current = null; const verdict = host.current",
    "const target = { get current() { return false; } }; const verdict = target.current",
  ])("refuses ref container escape, mutable aliases, and descriptor changes: %s", (body) => {
    expect(certify(body, "<div ref={host}><OpaqueChild /></div>", {}, "read")).toBe(false);
  });

  it.each([
    "<OpaqueChild ref={host} />",
    "<x-widget ref={host} />",
    '<div is="x-widget" ref={host} />',
    "<div ref={host} {...unknownProps} />",
    "<div ref={host}><OpaqueChild api={host} /></div>",
    "<OpaqueParent><div ref={host} /></OpaqueParent>",
  ])("requires a private native ref owner without opaque ref projection: %s", (template) => {
    expect(certify("const verdict = host.current", template, {}, "read")).toBe(false);
  });

  it.each([
    "function Parent(props) { const element = View(props); publish(element.props.ref); return element; }",
    'function Parent(props) { const element = View(props); Object.defineProperty(element.props.ref, "current", { get: foreignGetter }); return element; }',
    "function Parent() { return <View />; } function Extract() { const element = Parent(); publish(element.type().props.ref); return element; }",
  ])("closes owner component invocation and returned element consumers: %s", (imports) => {
    expect(
      certify("const verdict = host.current", "<div ref={host}><OpaqueChild /></div>", {}, "read", {
        imports,
      }),
    ).toBe(false);
  });

  it.each([
    ["const element = View(props); publish(element.props.ref); return element;", false],
    ["return <View />;", true],
  ])("closes imported owner component consumer roles: %s", (body, expected) => {
    expect(
      certify(
        "const verdict = host.current",
        "<div ref={host}><OpaqueChild /></div>",
        {
          "/public/parent.tsx": `import { View } from "/public/view.tsx"; export const Visual = (props) => { ${body} };`,
        },
        "read",
        { imports: "export { View };" },
      ),
    ).toBe(expected);
  });

  it("does not blacklist unrelated imported ref providers or element properties", () => {
    expect(
      certify(
        "const verdict = host.current",
        "<div ref={host}><OpaqueChild /></div>",
        {
          "/public/parent.tsx":
            'import { RefProvider } from "/public/view.tsx"; export const Visual = () => RefProvider().props.ref;',
        },
        "read",
        { imports: "export const RefProvider = () => null; export { View };" },
      ),
    ).toBe(true);
  });

  it("refuses owner aliases through transparent type assertions and unknown consumer surfaces", () => {
    const parsed = parseFixture(
      'import { useRef } from "react"; const View = (() => { const host = useRef(null); const verdict = host.current; return <div ref={host}><OpaqueChild /></div>; }) as () => unknown; export const Alias = View;',
    );
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("expected program");
    const module: SourceProjectModule = {
      filePath: "/public/view.tsx",
      programNode: parsed.program,
      scopes: analyzeScopes(parsed.program),
    };
    expect(
      certify(
        "",
        undefined,
        {
          "/public/parent.tsx":
            'import { Alias } from "/public/view.tsx"; export const Visual = () => { const element = Alias(); publish(element.props.ref); return element; };',
        },
        "read",
        { reuseCurrentModule: module },
      ),
    ).toBe(false);
    expect(
      certify("const verdict = host.current", undefined, {}, "read", {
        opaqueConsumerSurface: true,
      }),
    ).toBe(false);
  });

  it.each([
    ["opaque(function Named()", ")", false],
    ["function Named()", "", true],
  ])("closes named owner function value transport: %s", (header, suffix, expected) => {
    const parsed = parseFixture(
      `import { useRef } from "react"; const Panel = ${header} { const host = useRef(null); const verdict = host.current; return <div ref={host}><OpaqueChild /></div>; }${suffix};`,
    );
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("expected program");
    const module: SourceProjectModule = {
      filePath: "/public/view.tsx",
      programNode: parsed.program,
      scopes: analyzeScopes(parsed.program),
    };
    expect(certify("", undefined, {}, "read", { reuseCurrentModule: module })).toBe(expected);
  });

  it.each([
    "const enabled = true; if (!enabled || !host.current) return; const verdict = host.current",
    'if (!host["current"]) return; const verdict = host["current"]',
  ])("proves owned native ref values used in leading guards: %s", (body) => {
    expect(certify(body, undefined, {}, "ref")).toBe(true);
  });

  it.each([
    "const target = { get current() { return arbitraryWork(); } }; const verdict = target.current",
    'const target = { current: document.createElement("div") }; const verdict = target.current',
    "escape(host); const verdict = host.current",
    "host.current = null; const verdict = host.current",
    'Object.defineProperty(host, "current", { get: () => arbitraryWork() }); const verdict = host.current',
    'const field = "current"; const verdict = host[field]',
    "const verdict = readTarget().current",
    "const verdict = host.current.clientWidth",
  ])("refuses unproved or escaped guard ref values: %s", (body) => {
    expect(certify(body, undefined, {}, "ref")).toBe(false);
  });

  it("requires complete native templates for a guard ref value", () => {
    expect(
      certify(
        "if (!host.current) return; const verdict = host.current",
        "<div ref={host}><x-widget /></div>",
        {},
        "ref",
      ),
    ).toBe(false);
  });

  it.each([
    "escape(host.current);",
    "escape(host.current || null);",
    "escape(host.current ?? null);",
    "escape(condition && host.current);",
    "const extracted = host.current || null; escape(extracted);",
  ])("closes direct and logical owned ref node consumers: %s", (prefix) => {
    expect(certify(`${prefix} const verdict = host.current`, undefined, {}, "ref")).toBe(false);
    expect(certify(`${prefix} const verdict = host.current.cloneNode(true)`)).toBe(false);
  });

  it.each([
    "if (!host.current) return;",
    "const enabled = true; if (!enabled || !host.current) return;",
    "const condition = false; if (condition || host.current) return;",
    "escape(host.current && true);",
    "const present = host.current && true; escape(present);",
  ])("retains Boolean-only owned ref node consumers: %s", (prefix) => {
    expect(certify(`${prefix} const verdict = host.current`, undefined, {}, "ref")).toBe(true);
    expect(certify(`${prefix} const verdict = host.current.cloneNode(true)`)).toBe(true);
  });

  it.each([
    "escape(host.current == null);",
    "escape(undefined != host.current);",
    "escape(host.current == void 0);",
    "const absent = null; escape(host.current == absent);",
    "escape(host.current === 1);",
  ])("retains native equality consumers without coercion: %s", (prefix) => {
    expect(certify(`${prefix} const verdict = host.current`, undefined, {}, "ref")).toBe(true);
    expect(certify(`${prefix} const verdict = host.current.cloneNode(true)`)).toBe(true);
  });

  it.each([
    "escape(host.current == 1);",
    'escape(host.current != "closed");',
    "const undefined = 1; escape(host.current == undefined);",
    "const absent = { get value() { return null; } }; escape(host.current == absent.value);",
  ])("refuses loose native equality with an unproved nullish operand: %s", (prefix) => {
    expect(certify(`${prefix} const verdict = host.current`, undefined, {}, "ref")).toBe(false);
    expect(certify(`${prefix} const verdict = host.current.cloneNode(true)`)).toBe(false);
  });

  it.each([
    "window.parent",
    "window.top",
    "window.opener",
    "window.frames",
    "parent",
    "top",
    "globalThis.window.parent",
    "window.unknownRealm",
  ])("refuses alternate and unknown Window capabilities: %s", (root) => {
    expect(
      certify(
        `${root}.document.querySelector("#owned").append(document.createElement("x-widget")); const verdict = host.current.cloneNode(true)`,
      ),
    ).toBe(false);
  });

  it("rejects source-visible global queries, native overrides, and upgrade registration", () => {
    expect(
      certify(
        'document.querySelector("#owned").append(document.createElement("x-gadget")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify(
        'const realm = globalThis; realm.document.getElementById("owned").append(realm.document.createElement("x-gadget")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify(
        'const { document: page } = globalThis; page.getElementById("owned").append(page.createElement("x-gadget")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify(
        'document.defaultView.document.querySelector("#owned").append(document.createElement("x-gadget")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify(
        'document.getRootNode().querySelector("#owned").append(document.createElement("x-gadget")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify(
        'globalThis.window.document.querySelector("#owned").append(document.createElement("x-gadget")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify(
        'globalThis[slot].querySelector("#owned").append(document.createElement("x-gadget")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify("Node.prototype.cloneNode = callback; const verdict = host.current.cloneNode(true)"),
    ).toBe(false);
    expect(
      certify(
        'NodeList.prototype[Symbol.iterator] = callback; const verdict = host.current.querySelectorAll("button")',
      ),
    ).toBe(false);
    expect(
      certify('document.createElement = callback; const verdict = document.createElement("span")'),
    ).toBe(false);
    expect(
      certify(
        'customElements.define("x-gadget", Constructor); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify(
        'document.dispatchEvent(new Event("notice")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(true);
  });

  it("rejects escaped animation records and inherited nonprimitive dataset members", () => {
    expect(
      certify(
        "const frames = { opacity: 0 }; const expose = () => { return frames; }; external(expose); const verdict = host.current.animate(frames)",
      ),
    ).toBe(false);
    expect(
      certify(
        "const frames = { opacity: 0 }; const box = { frames }; external(box); const verdict = host.current.animate(frames)",
      ),
    ).toBe(false);
    expect(
      certify("const verdict = host.current.dataset.toString", undefined, {}, "primitive"),
    ).toBe(false);
    expect(
      certify(
        "Object.prototype.key = callback; const verdict = host.current.dataset.key",
        undefined,
        {},
        "primitive",
      ),
    ).toBe(false);
  });

  it("admits inert React event callback acquisition without inspecting callback bodies", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><button onClick={() => arbitraryApplicationWork()} onFocus={() => focusCallback()} /></div>",
      ),
    ).toBe(true);
    expect(
      certify(
        "const callback = () => arbitraryApplicationWork(); const verdict = host.current.cloneNode(true)",
        "<div ref={host}><button onClick={callback} /></div>",
      ),
    ).toBe(true);
    expect(
      certify(
        "const handlers = { click: () => arbitraryApplicationWork() }; const verdict = host.current.cloneNode(true)",
        "<div ref={host}><button onClick={handlers.click} /></div>",
      ),
    ).toBe(true);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><button onClick={unknownCallback} /></div>",
      ),
    ).toBe(false);
    expect(
      certify(
        "const handlers = { get click() { return arbitraryApplicationWork(); } }; const verdict = host.current.cloneNode(true)",
        "<div ref={host}><button onClick={handlers.click} /></div>",
      ),
    ).toBe(false);
    expect(
      certify(
        "let callback = () => {}; callback = externalCallback; const verdict = host.current.cloneNode(true)",
        "<div ref={host}><button onClick={callback} /></div>",
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        '<div ref={host}><button onclick="arbitraryApplicationWork()" /></div>',
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><button onArbitrary={() => arbitraryApplicationWork()} /></div>",
      ),
    ).toBe(false);
  });

  it.each([
    "event => foreign(event)",
    "event => foreign(event.currentTarget)",
    "event => { const suppliedMethods = { replacement: () => null }; ({ replacement: event.currentTarget.cloneNode } = suppliedMethods); }",
    "event => { const suppliedMethods = [() => null]; for (event.currentTarget.cloneNode of suppliedMethods) {} }",
    "() => foreign(event)",
    "() => foreign(getSelection())",
    "() => foreign(nativeOwned)",
    "function () { foreign(arguments[0]); }",
    "({ currentTarget }) => foreign(currentTarget)",
    "(...events) => foreign(events)",
  ])("refuses event or ambient native capabilities escaping through %s", (callback) => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        `<button id="nativeOwned" ref={host} onClick={${callback}}>Tile</button>`,
      ),
    ).toBe(false);
  });

  it.each([
    "event => foreign(event.currentTarget.id)",
    "event => event.preventDefault()",
    "function () { arbitraryWork(); }",
    "() => foreign(event)",
    "() => foreign(nativeOwned)",
  ])("preserves primitive controls and opaque callback work in %s", (callback) => {
    expect(
      certify(
        'const event = "label"; const nativeOwned = "label"; const verdict = host.current.cloneNode(true)',
        `<button ref={host} onClick={${callback}}>Tile</button>`,
      ),
    ).toBe(true);
  });

  it.each([
    "const alias = nativeOwned;",
    "const readNative = () => nativeOwned; const alias = readNative();",
    "const readNative = () => nativeOwned; const alias = () => readNative();",
    "let readNative = () => null; readNative = () => nativeOwned; const alias = () => readNative();",
    "const readers = {}; readers.read = () => nativeOwned; const alias = () => readers.read();",
  ])("closes captured named-element global aliases: %s", (prefix) => {
    expect(
      certify(
        `${prefix} const verdict = host.current.cloneNode(true)`,
        '<button id="nativeOwned" ref={host} onClick={() => foreign(alias)}>Tile</button>',
      ),
    ).toBe(false);
  });

  it("closes captured primitive aliases and surrounding native event owners", () => {
    expect(
      certify(
        "const alias = nativeOwned; const verdict = host.current.cloneNode(true)",
        '<button id="nativeOwned" ref={host} onClick={() => foreign(alias)}>Tile</button>',
      ),
    ).toBe(false);
    expect(
      certify(
        'const alias = "tile"; const verdict = host.current.cloneNode(true)',
        "<button ref={host} onClick={() => foreign(alias)}>Tile</button>",
      ),
    ).toBe(true);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div onClick={event => foreign(event.target)}><button ref={host}>Tile</button></div>",
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div onClick={() => arbitraryWork()}><button ref={host}>Tile</button></div>",
      ),
    ).toBe(true);
  });

  it.each([
    ["nativeOwned", false],
    ['"label"', true],
  ])("closes source-visible imported callback helper values: %s", (returnedValue, expected) => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        '<button id="nativeOwned" ref={host} onClick={() => foreign(readNative())}>Tile</button>',
        {
          "/public/helper.tsx": `export const readNative = () => ${returnedValue}; export const Visual = () => null;`,
        },
        "call",
        { imports: 'import { readNative } from "/public/helper.tsx";' },
      ),
    ).toBe(expected);
  });

  it.each([
    "() => foreign(readNative())",
    "() => { const node = readNative(); foreign(node); }",
    "() => readNative().run()",
    "() => { const label = readNative().label; }",
    "() => { const label = `${readNative()}`; }",
    "() => foreign({ item: readNative() })",
    "() => { const target = {}; target.item = readNative(); }",
    "() => { new Foreign(readNative()); }",
    "() => { const { item } = readNative(); }",
    "() => { const record = { [readNative()]: 'value' }; }",
    "() => { for (const item of readNative()) {} }",
  ])("refuses consumed opaque callback results in %s", (callback) => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        `<button ref={host} onClick={${callback}}>Tile</button>`,
      ),
    ).toBe(false);
  });

  it.each([
    "() => notify()",
    "() => { notify(); }",
    "() => foreign(readNative())",
    "() => foreign({ label: 'tile' })",
    "() => foreign(!!unknownResult())",
    "() => foreign(unknownResult() === null)",
    "() => foreign(unknownResult() ? 'yes' : 'no')",
    "event => foreign(event.currentTarget.getAttribute('id'))",
    "({ currentTarget: { id } }) => foreign(id)",
    "event => { const { id } = event.currentTarget; foreign(id); }",
  ])("retains discarded work and proved callback data in %s", (callback) => {
    expect(
      certify(
        'const readNative = () => "label"; const verdict = host.current.cloneNode(true)',
        `<button ref={host} onClick={${callback}}>Tile</button>`,
      ),
    ).toBe(true);
  });

  it.each([
    "let helper = () => null; helper = () => foreign(readNative());",
    "const helper = condition ? () => foreign(readNative()) : () => null;",
    "const helper = async () => { foreign(readNative()); };",
  ])("refuses unresolved source helper capability flows: %s", (prefix) => {
    expect(
      certify(
        `${prefix} const verdict = host.current.cloneNode(true)`,
        "<button ref={host} onClick={() => helper()}>Tile</button>",
      ),
    ).toBe(false);
  });

  it.each([
    ["foreign(readNative())", false],
    ['return "label"', true],
  ])("closes source namespace helper capabilities: %s", (body, expected) => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<button ref={host} onClick={() => foreign(Helpers.read())}>Tile</button>",
        {
          "/public/helper.tsx": `export const read = () => { ${body}; }; export const Visual = () => null;`,
        },
        "call",
        { imports: 'import * as Helpers from "/public/helper.tsx";' },
      ),
    ).toBe(expected);
  });

  it("closes source helper result consumption and imported opaque callees", () => {
    expect(
      certify(
        "const helper = () => foreign(readNative()); const verdict = host.current.cloneNode(true)",
        "<button ref={host} onClick={() => helper()}>Tile</button>",
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<button ref={host} onClick={() => foreign(readNative())}>Tile</button>",
        {},
        "call",
        { imports: 'import { foreign, readNative } from "opaque-app";' },
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<button ref={host} onClick={() => notify()}>Tile</button>",
        {},
        "call",
        { imports: 'import { notify } from "opaque-app";' },
      ),
    ).toBe(true);
  });

  it.each([
    "captured = readNative();",
    "const result = readNative(); captured = result;",
    "({ item: captured } = { item: readNative() });",
    "({ item: captured = readNative() } = {});",
    "for (captured of readNative()) {}",
    "for ({ item: captured = readNative() } of [{}]) {}",
    "for (captured in readNative()) {}",
  ])("refuses opaque result publication to outer or exported bindings: %s", (body) => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        `<button ref={host} onClick={() => { ${body} }}>Tile</button>`,
        {},
        "call",
        { imports: "export let captured = null;" },
      ),
    ).toBe(false);
  });

  it.each([
    "captured = 'label';",
    "const readNative = () => 'label'; captured = readNative();",
    "({ item: captured } = { item: 'label' });",
    "({ item: captured = 'label' } = {});",
    "for (captured of ['label']) {}",
    "for ({ item: captured = 'label' } of [{}]) {}",
    "for (captured in { label: true }) {}",
  ])("retains closed data publication to outer or exported bindings: %s", (body) => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        `<button ref={host} onClick={() => { ${body} }}>Tile</button>`,
        {},
        "call",
        { imports: "export let captured = null;" },
      ),
    ).toBe(true);
  });

  it.each([
    ["let captured = readNative();", "captured++;", false],
    ["let captured = readNative();", "captured += 1;", false],
    ["let captured = 0; captured = readNative();", "captured++;", false],
    ["let captured = 0;", "captured++;", true],
    ["let captured = 0; captured = 1;", "captured--;", true],
    ["let captured = 0;", "captured += 1;", true],
    ["const readCount = () => 0; let captured = readCount();", "captured++;", true],
  ])("closes every primitive update source: %s %s", (prefix, body, expected) => {
    expect(
      certify(
        `${prefix} const verdict = host.current.cloneNode(true)`,
        `<button ref={host} onClick={() => { ${body} }}>Tile</button>`,
      ),
    ).toBe(expected);
  });

  it.each([
    'foreign(new Event("x")).preventDefault = () => arbitraryWork();',
    "foreign().Event = () => arbitraryWork();",
    "foreign().CustomEvent = () => arbitraryWork();",
    "const suppliedMethods = { replacement: () => null }; ({ replacement: foreign().cloneNode } = suppliedMethods);",
    "const suppliedMethods = [() => null]; for (foreign().cloneNode of suppliedMethods) {}",
  ])("refuses source-visible intrinsic replacement through %s", (prefix) => {
    expect(
      certify(
        `${prefix} const verdict = host.current.cloneNode(true)`,
        "<button ref={host} onClick={event => event.preventDefault()}>Tile</button>",
      ),
    ).toBe(false);
  });

  it.each([
    "javascript:foreign()",
    "JaVaScRiPt:foreign()",
    "java\tscript:foreign()",
    "data:text/html,foreign()",
  ])("refuses executable URL attributes including HTML case folding: %s", (url) => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        `<a ref={host} HREF={${JSON.stringify(url)}}>Tile</a>`,
      ),
    ).toBe(false);
  });

  it("admits closed ordinary anchor URLs", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        '<a ref={host} href="https://example.com/page">Tile</a>',
      ),
    ).toBe(true);
  });

  it("closes a private host and every scoped query candidate", () => {
    expect(certify('const verdict = host.current.querySelector("[data-key]")')).toBe(true);
  });

  it("admits geometry and native cloning with closed native descendants", () => {
    expect(
      certify(
        'const target = host.current.querySelector("button"); const verdict = target.cloneNode(true)',
      ),
    ).toBe(true);
    expect(
      certify("const target = host.current; const verdict = target.getBoundingClientRect()"),
    ).toBe(true);
  });

  it("admits primitive style and dataset writes only on closed native receivers", () => {
    expect(
      certify('const verdict = (host.current.style.opacity = "0")', undefined, {}, "mutation"),
    ).toBe(true);
    expect(
      certify(
        "const verdict = (host.current.style.opacity = foreignValue)",
        undefined,
        {},
        "mutation",
      ),
    ).toBe(false);
    expect(
      certify('const verdict = (foreignElement.style.opacity = "0")', undefined, {}, "mutation"),
    ).toBe(false);
    expect(
      certify(
        'const verdict = (host.current.innerHTML = "<x-widget />")',
        undefined,
        {},
        "mutation",
      ),
    ).toBe(false);
  });

  it("admits scoped native collections and their for-of element bindings", () => {
    expect(
      certify(
        'const verdict = host.current.querySelectorAll("button")',
        undefined,
        {},
        "collection",
      ),
    ).toBe(true);
    expect(
      certify(
        'for (const tile of host.current.querySelectorAll("button")) { const verdict = tile.cloneNode(true); }',
      ),
    ).toBe(true);
    const body =
      'for (const tile of host.current.querySelectorAll("button")) { const clone = tile.cloneNode(true); clone.style.opacity = "0"; host.current.append(clone); externalCommit(tile.dataset.key, true); const verdict = tile.dataset.key; }';
    expect(certify(body, undefined, {}, "primitive")).toBe(true);
    expect(
      certify(
        body.replace(
          "const verdict = tile.dataset.key",
          'const verdict = (clone.style.opacity = "0")',
        ),
        undefined,
        {},
        "mutation",
      ),
    ).toBe(true);
    expect(
      certify("for (const tile of externalItems) { const verdict = tile.cloneNode(true); }"),
    ).toBe(false);
  });

  it("closes local finite template alternatives and refuses mutated template escapes", () => {
    const body =
      "const content = condition ? <svg><circle /></svg> : <button />; const verdict = host.current.cloneNode(true)";
    expect(certify(body, "<div ref={host}>{content}</div>")).toBe(true);
    expect(
      certify(
        body.replace("const verdict", "mutate(content); const verdict"),
        "<div ref={host}>{content}</div>",
      ),
    ).toBe(false);
    const nestedEscape =
      "const content = <button />; const expose = () => { return content; }; external(expose); const verdict = host.current.cloneNode(true)";
    expect(certify(nestedEscape, "<div ref={host}>{content}</div>")).toBe(false);
  });

  it("closes finite SVG branches and default wrapper children", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        '<div ref={host}>{condition ? <svg><circle cx="2" /></svg> : <svg><path d="M 0 0" /></svg>}</div>',
      ),
    ).toBe(true);
    expect(
      certify("const verdict = host.current.cloneNode(true)", "<div ref={host}><Visual /></div>", {
        "/public/visual.tsx":
          "export const Visual = ({ children = <span>Fallback</span>, ...rest }) => <section {...rest}>{children}</section>",
      }),
    ).toBe(true);
  });

  it("distinguishes primitive geometry fields from SVG animated property objects", () => {
    expect(
      certify(
        "const verdict = host.current.getBoundingClientRect().width",
        undefined,
        {},
        "primitive",
      ),
    ).toBe(true);
    expect(certify("const verdict = host.current.offsetWidth", undefined, {}, "primitive")).toBe(
      true,
    );
    expect(
      certify(
        "const verdict = host.current.width",
        "<svg ref={host}><rect /></svg>",
        {},
        "primitive",
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.offsetWidth",
        '<form ref={host}><input name="offsetWidth" /></form>',
        {},
        "primitive",
      ),
    ).toBe(false);
  });

  it("closes local primitive choices without trusting annotations or opaque condition calls", () => {
    expect(
      certify(
        'const selected = externalValue; const verdict = selected ? "north" : "south"',
        undefined,
        {},
        "primitive",
      ),
    ).toBe(true);
    expect(
      certify(
        'const verdict = externalPredicate() ? "north" : "south"',
        undefined,
        {},
        "primitive",
      ),
    ).toBe(false);
    expect(
      certify(
        'const verdict = externalObject.selected ? "north" : "south"',
        undefined,
        {},
        "primitive",
      ),
    ).toBe(false);
  });

  it("derives dataset primitive arguments from owned query origins", () => {
    expect(
      certify(
        'const target = host.current.querySelector("button"); const verdict = target.dataset.key',
        undefined,
        {},
        "primitive",
      ),
    ).toBe(true);
  });

  it("admits local native creation and animation data", () => {
    expect(certify('const verdict = document.createElement("span")')).toBe(true);
    expect(
      certify(
        "const verdict = host.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 })",
      ),
    ).toBe(true);
  });

  it("closes a native child with a fresh data-only imperative factory", () => {
    const body = "const api = useRef(null); const verdict = host.current.cloneNode(true)";
    const template = "<div ref={host}><Visual apiRef={api} /></div>";
    const source =
      'import { useImperativeHandle } from "react"; export const Visual = ({ apiRef }) => { useImperativeHandle(apiRef, () => ({ commit: () => externalCommit(), focus: () => externalFocus() }), []); return <button data-key="tile" />; }';
    expect(certify(body, template, { "/public/visual.tsx": source })).toBe(true);
    expect(
      certify(body, template, {
        "/public/visual.tsx": source.replace(
          "() => ({ commit:",
          "() => (externalWork(), { commit:",
        ),
      }),
    ).toBe(false);
    expect(
      certify(body, template, {
        "/public/visual.tsx": source.replace(
          "commit: () => externalCommit()",
          "get commit() { return externalCommit; }",
        ),
      }),
    ).toBe(false);
  });

  it("closes genuine forwardRef wrappers with absent forwarded refs", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual><span>Tile</span></Visual></div>",
        {
          "/public/visual.tsx":
            'import { forwardRef } from "react"; export const Visual = forwardRef(({children, ...rest}, ref) => <section {...rest} ref={ref}>{children}</section>);',
        },
      ),
    ).toBe(true);
  });

  it("rejects mutation and escapes of structured children or rest props", () => {
    const body = "const verdict = host.current.cloneNode(true)";
    const template = "<div ref={host}><Visual><button>Tile</button></Visual></div>";
    expect(
      certify(body, template, {
        "/public/visual.tsx":
          "export const Visual = ({children}) => { mutate(children); return <div>{children}</div>; }",
      }),
    ).toBe(false);
    expect(
      certify(body, template, {
        "/public/visual.tsx":
          "export const Visual = ({children}) => { children.props.children = externalChildren; return <div>{children}</div>; }",
      }),
    ).toBe(false);
    expect(
      certify(body, template, {
        "/public/visual.tsx":
          "export const Visual = ({children, ...rest}) => { mutate(rest); return <div {...rest}>{children}</div>; }",
      }),
    ).toBe(false);
  });

  it("closes imported visual wrappers and actual rest props", () => {
    const visual =
      "export const Visual = ({ children, render, ...rest }) => <div {...rest}>{render ?? children}</div>";
    expect(
      certify(
        'const verdict = host.current.querySelector("button")',
        '<div ref={host}><Visual className="card"><button>Tile</button></Visual></div>',
        { "/public/visual.tsx": visual },
      ),
    ).toBe(true);
  });

  it.each([
    '<div ref={host}><button data-key="safe" /><x-widget data-key="unsafe" /></div>',
    '<div ref={host}><button data-key="safe" />{externalChildren}</div>',
    "<div ref={host}><button autoFocus /></div>",
    "<div ref={host}><script>run()</script></div>",
    '<div ref={host}><button is="special-button" /></div>',
    "<div ref={host}><div dangerouslySetInnerHTML={{ __html: content }} /></div>",
    "<div ref={host}><button ref={() => callback()} /></div>",
    "<div ref={host}><button onFocus={unknownCallback} /></div>",
    "<div ref={host}><button {...externalProps} /></div>",
  ])("rejects an unclosed candidate subtree: %s", (template) => {
    expect(certify('const verdict = host.current.querySelector("[data-key]")', template)).toBe(
      false,
    );
  });

  it("rejects an unknown imported candidate even beside a safe matching template", () => {
    expect(
      certify(
        'const verdict = host.current.querySelector("[data-key]")',
        '<div ref={host}><button data-key="safe" /><Visual /></div>',
        { "/public/visual.tsx": 'export const Visual = () => <x-widget data-key="unsafe" />' },
      ),
    ).toBe(false);
  });

  it("rejects an opaque render override and lifecycle callbacks", () => {
    expect(
      certify(
        'const verdict = host.current.querySelector("button")',
        "<div ref={host}><Visual render={foreignRender} /></div>",
        { "/public/visual.tsx": "export const Visual = ({ render }) => render" },
      ),
    ).toBe(false);
    expect(
      certify(
        'const verdict = host.current.querySelector("button")',
        "<div ref={host}><Visual /></div>",
        {
          "/public/visual.tsx":
            'import { useEffect } from "react"; export const Visual = () => { useEffect(() => externalWork(), []); return <button />; }',
        },
      ),
    ).toBe(false);
  });

  it("rejects foreign receivers, controller callbacks, and forged type annotations", () => {
    expect(
      certify(
        "const target = externalElement as HTMLButtonElement; const verdict = target.cloneNode(true)",
      ),
    ).toBe(false);
    expect(certify('const verdict = document.querySelector("button")')).toBe(false);
    expect(certify("const verdict = host.current.focus()")).toBe(false);
    expect(certify('const verdict = host.current.dispatchEvent(new Event("open"))')).toBe(false);
  });

  it("rejects escaped or overwritten native refs and aliases", () => {
    expect(certify("escape(host); const verdict = host.current.cloneNode(true)")).toBe(false);
    expect(
      certify("host.current = externalElement; const verdict = host.current.cloneNode(true)"),
    ).toBe(false);
    expect(
      certify(
        "const target = host.current; escape(target); const verdict = target.cloneNode(true)",
      ),
    ).toBe(false);
    expect(
      certify(
        'escape(host.current.querySelector("button")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(false);
    expect(
      certify("host.current.append(externalElement); const verdict = host.current.cloneNode(true)"),
    ).toBe(false);
    expect(
      certify("host.current.cloneNode = callback; const verdict = host.current.cloneNode(true)"),
    ).toBe(false);
    expect(
      certify("host.current.dataset = externalData; const verdict = host.current.cloneNode(true)"),
    ).toBe(false);
  });
});

describe("version-bound default UI host contracts", () => {
  const baseOptions: NativeDomFixtureOptions = {
    dependencies: { "@base-ui/react": "^1.0.0" },
    imports: 'import { Avatar } from "@base-ui/react/avatar";',
  };
  const iconOptions: NativeDomFixtureOptions = {
    dependencies: { "lucide-react": "^1.0.0" },
    imports: 'import { Check, Plus, Inbox, LayoutGrid } from "lucide-react";',
  };

  it.each([...OWNED_NATIVE_DOM_LUCIDE_NAMES])(
    "closes the verified named native glyph %s",
    (name) => {
      expect(
        certify(
          "const verdict = host.current.cloneNode(true)",
          "<div ref={host}><Glyph size={18} /></div>",
          {},
          "call",
          {
            dependencies: { "lucide-react": "^1.0.0" },
            imports: `import { ${name} as Glyph } from "lucide-react";`,
          },
        ),
      ).toBe(true);
    },
  );

  it("closes Avatar Root and Fallback native alternatives and ordinary event props", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        '<div ref={host}><Avatar.Root className="profile"><Avatar.Fallback onClick={() => arbitraryWork()}>AB</Avatar.Fallback></Avatar.Root></div>',
        {},
        "call",
        baseOptions,
      ),
    ).toBe(true);
  });

  it("closes readonly aliases to the genuine Avatar Root export", () => {
    expect(
      certify(
        "const RootPart = Avatar.Root; const verdict = host.current.cloneNode(true)",
        "<div ref={host}><RootPart>AB</RootPart></div>",
        {},
        "call",
        baseOptions,
      ),
    ).toBe(true);
    expect(
      certify(
        "const { Root: RootPart } = Avatar; const verdict = host.current.cloneNode(true)",
        "<div ref={host}><RootPart>AB</RootPart></div>",
        {},
        "call",
        baseOptions,
      ),
    ).toBe(true);
  });

  it.each([
    '<div ref={host}><Avatar.Root><Avatar.Image src="/photo.png" /></Avatar.Root></div>',
    "<div ref={host}><Avatar.Root render={<x-widget />} /></div>",
    "<div ref={host}><Avatar.Root render={() => <span />} /></div>",
    "<div ref={host}><Avatar.Fallback delay={250}>AB</Avatar.Fallback></div>",
    "<div ref={host}><Avatar.Root ref={() => arbitraryWork()} /></div>",
    "<div ref={host}><Avatar.Root autoFocus /></div>",
  ])("refuses nondefault Avatar contracts: %s", (template) => {
    expect(
      certify("const verdict = host.current.cloneNode(true)", template, {}, "call", baseOptions),
    ).toBe(false);
  });

  it("closes named useRender and data-only mergeProps residual forwarding", () => {
    const source =
      'import { useRender } from "@base-ui/react/use-render"; import { mergeProps } from "@base-ui/react/merge-props"; export const Visual = ({ render, children, ...rest }) => useRender({ defaultTagName: "button", render, props: mergeProps({ className: "tile", children }, rest) });';
    expect(
      certify(
        'const verdict = host.current.querySelector("button").cloneNode(true)',
        '<div ref={host}><Visual data-part="item" onClick={() => arbitraryWork()}>Tile</Visual></div>',
        { "/public/visual.tsx": source },
        "call",
        { dependencies: { "@base-ui/react": "^1.0.0" } },
      ),
    ).toBe(true);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual render={<x-widget />} /></div>",
        { "/public/visual.tsx": source },
        "call",
        { dependencies: { "@base-ui/react": "^1.0.0" } },
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual /></div>",
        {
          "/public/visual.tsx": source.replace(
            'mergeProps({ className: "tile", children }, rest)',
            "mergeProps(() => ({ children: <x-widget /> }), rest)",
          ),
        },
        "call",
        { dependencies: { "@base-ui/react": "^1.0.0" } },
      ),
    ).toBe(false);
  });

  it("closes finite named default Lucide glyphs and local alternatives", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Check size={16} onClick={() => arbitraryWork()} /><Inbox /><LayoutGrid /></div>",
        {},
        "call",
        iconOptions,
      ),
    ).toBe(true);
    expect(
      certify(
        "const enabled = externalValue; const Glyph = enabled ? Check : Plus; const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Glyph /></div>",
        {},
        "call",
        iconOptions,
      ),
    ).toBe(true);
    expect(
      certify(
        'const enabled = externalValue; const glyphs = { compact: Check, expanded: Plus }; const selected = enabled ? "compact" : "expanded"; const Glyph = glyphs[selected]; const verdict = host.current.cloneNode(true)',
        "<div ref={host}><Glyph /></div>",
        {},
        "call",
        iconOptions,
      ),
    ).toBe(true);
  });

  it("refuses inherited or open icon keys and source-visible component mutation", () => {
    expect(
      certify(
        "const glyphs = { compact: Check }; const selected = externalKey; const Glyph = glyphs[selected]; const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Glyph /></div>",
        {},
        "call",
        iconOptions,
      ),
    ).toBe(false);
    expect(
      certify(
        'const enabled = externalValue; const glyphs = { compact: Check }; const selected = enabled ? "compact" : "constructor"; const Glyph = glyphs[selected]; const verdict = host.current.cloneNode(true)',
        "<div ref={host}><Glyph /></div>",
        {},
        "call",
        iconOptions,
      ),
    ).toBe(false);
    expect(
      certify(
        "Check.render = externalRender; const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Check /></div>",
        {},
        "call",
        iconOptions,
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Check iconNode={externalNodes} /></div>",
        {},
        "call",
        iconOptions,
      ),
    ).toBe(false);
  });

  it("closes other source consumers of the same mutable SDK component objects", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Check /></div>",
        {
          "/public/other.tsx":
            'import { Check } from "lucide-react"; Check.render = () => <x-widget />; export const Visual = () => null;',
        },
        "call",
        iconOptions,
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Check /></div>",
        {
          "/public/other.tsx":
            'import * as Glyphs from "lucide-react"; Glyphs.Check.render = () => <x-widget />; export const Visual = () => null;',
        },
        "call",
        iconOptions,
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Avatar.Root /></div>",
        {
          "/public/other.tsx":
            'import { Avatar } from "@base-ui/react/avatar"; externalConsumer(Avatar.Root); export const Visual = () => null;',
        },
        "call",
        baseOptions,
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Check /></div>",
        {
          "/public/other.tsx":
            'import { Plus } from "lucide-react"; export const Visual = () => <Plus />;',
        },
        "call",
        iconOptions,
      ),
    ).toBe(true);
  });

  it.each([
    'const sdkName = "lucide-react"; import(sdkName).then(sdk => { sdk.Check.render = () => null; });',
    'import("lucide-" + "react").then(sdk => { sdk.Check.render = () => null; });',
    "import(`lucide-react`).then(sdk => { sdk.Check.render = () => null; });",
    'const load = require; load("lucide-react").Check.render = () => null;',
    'const sdkName = "lucide-react"; require(sdkName).Check.render = () => null;',
  ])("refuses unresolved SDK acquisition and require capability aliases: %s", (prefix) => {
    expect(
      certify(
        `${prefix} const verdict = host.current.cloneNode(true)`,
        "<div ref={host}><Check /></div>",
        {},
        "call",
        iconOptions,
      ),
    ).toBe(false);
  });

  it("refuses aliased SDK identities and TypeScript runtime SDK loaders", () => {
    expect(
      certify(
        'const verdict = host.current.querySelector("[data-part]").cloneNode(true)',
        '<div ref={host}><Check data-part="item" /></div>',
        {},
        "call",
        {
          imports:
            iconOptions.imports +
            ' import { Check as Same } from "icons"; Same.render = () => null;',
          dependencies: { ...iconOptions.dependencies, icons: "npm:lucide-react@^1.0.0" },
        },
      ),
    ).toBe(false);
    expect(
      certify(
        'const verdict = host.current.querySelector("[data-part]").cloneNode(true)',
        '<div ref={host}><Check data-part="item" /></div>',
        {},
        "call",
        {
          ...iconOptions,
          imports:
            iconOptions.imports +
            ' import Icons = require("lucide-react"); Icons.Check.render = () => null;',
        },
      ),
    ).toBe(false);
  });

  it("refuses unknown SDK versions and namespace imports", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Avatar.Root /></div>",
        {},
        "call",
        { ...baseOptions, dependencies: { "@base-ui/react": ">=1" } },
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Avatar.Root /></div>",
        {},
        "call",
        { ...baseOptions, dependencies: { "@base-ui/react": "^2.0.0" } },
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Icons.Check /></div>",
        {},
        "call",
        { ...iconOptions, imports: 'import * as Icons from "lucide-react";' },
      ),
    ).toBe(false);
  });

  it("closes actual default no-tooltip paths without admitting the unknown branch", () => {
    const source =
      "export const Visual = ({ tooltip = false, children, ...rest }) => { if (tooltip) return <UnknownTooltip>{children}</UnknownTooltip>; return <button {...rest}>{children}</button>; };";
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual>Tile</Visual></div>",
        { "/public/visual.tsx": source },
      ),
    ).toBe(true);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual tooltip={true}>Tile</Visual></div>",
        { "/public/visual.tsx": source },
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual tooltip>Tile</Visual></div>",
        { "/public/visual.tsx": source },
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual tooltip={false}>Tile</Visual></div>",
        { "/public/visual.tsx": source.replace("tooltip = false", "tooltip = true") },
      ),
    ).toBe(true);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual tooltip={externalValue}>Tile</Visual></div>",
        { "/public/visual.tsx": source },
      ),
    ).toBe(false);
  });

  it("bounds the project inventory separately from the selected native subtree proof", () => {
    const source =
      "export const Visual = () => <span />;" +
      Array.from({ length: 700 }, (_, index) => `const inertValue${index} = ${index};`).join("");
    expect(
      certify("const verdict = host.current.cloneNode(true)", "<div ref={host}><Visual /></div>", {
        "/public/visual.tsx": source,
      }),
    ).toBe(true);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual /><x-widget /></div>",
        { "/public/visual.tsx": source },
      ),
    ).toBe(false);
  });

  it("refuses inventory and recursive proof exhaustion and rechecks a new importer index", () => {
    const source =
      "export const Visual = () => <span />;" +
      Array.from({ length: 700 }, (_, index) => `const inertValue${index} = ${index};`).join("");
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}><Visual /></div>",
        { "/public/visual.tsx": source },
        "call",
        { overflowInventory: true },
      ),
    ).toBe(false);
    const nesting = OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT * 2;
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<div ref={host}>" +
          "<span>".repeat(nesting) +
          "Tile" +
          "</span>".repeat(nesting) +
          "</div>",
      ),
    ).toBe(false);
    let reusedModule: SourceProjectModule | undefined;
    expect(
      certify("const verdict = host.current.cloneNode(true)", undefined, {}, "call", {
        captureCurrentModule: (module) => {
          reusedModule = module;
        },
      }),
    ).toBe(true);
    if (!reusedModule) throw new Error("expected current module");
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        undefined,
        {
          "/public/importer.tsx":
            'import "/public/view.tsx"; document.querySelector("#owned").append(document.createElement("x-widget")); export const Visual = () => null;',
        },
        "call",
        { reuseCurrentModule: reusedModule },
      ),
    ).toBe(false);
  });

  it("retains complete candidate closure beside a certified SDK producer", () => {
    expect(
      certify(
        'const verdict = host.current.querySelector("[data-part]").cloneNode(true)',
        '<div ref={host}><Check data-part="item" /><x-widget data-part="item" /></div>',
        {},
        "call",
        iconOptions,
      ),
    ).toBe(false);
    expect(
      certify(
        'const verdict = host.current.querySelector("[data-part]").cloneNode(true)',
        '<div ref={host}><Check data-part="item" />{externalChildren}</div>',
        {},
        "call",
        iconOptions,
      ),
    ).toBe(false);
  });

  it("refuses actual intrinsic writes in callbacks without requiring callback-body purity", () => {
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<button ref={host} onClick={(event) => { event.currentTarget.cloneNode = () => arbitraryWork(); }}>Tile</button>",
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        '<button ref={host} onClick={(event) => { Object.defineProperty(event.currentTarget, "dataset", { get: () => arbitraryWork() }); }}>Tile</button>',
      ),
    ).toBe(false);
    expect(
      certify(
        "const verdict = host.current.cloneNode(true)",
        "<button ref={host} onClick={(event) => { Object.assign(event.currentTarget, { cloneNode: () => arbitraryWork() }); }}>Tile</button>",
      ),
    ).toBe(false);
    expect(
      certify(
        'const data = {}; Object.assign(data, { label: "tile" }); const verdict = host.current.cloneNode(true)',
        "<button ref={host} onClick={() => arbitraryWork()}>Tile</button>",
      ),
    ).toBe(true);
  });

  it("proves native event dispatch separately from passive operations", () => {
    expect(
      certify(
        "const verdict = host.current.click()",
        "<button ref={host} onClick={() => arbitraryWork()}>Tile</button>",
        {},
        "event",
      ),
    ).toBe(true);
    expect(
      certify(
        'const target = host.current.querySelector("button"); const verdict = target.dispatchEvent(new Event("notice", { bubbles: true }))',
        undefined,
        {},
        "event",
      ),
    ).toBe(true);
    expect(
      certify(
        'const verdict = host.current.dispatchEvent(new CustomEvent("notice", { detail: { label: "tile" }, bubbles: true }))',
        undefined,
        {},
        "event",
      ),
    ).toBe(true);
    expect(
      certify("const verdict = host.current.dispatchEvent(externalEvent)", undefined, {}, "event"),
    ).toBe(false);
    expect(
      certify(
        'const Event = ForeignEvent; const verdict = host.current.dispatchEvent(new Event("notice"))',
        undefined,
        {},
        "event",
      ),
    ).toBe(false);
    expect(
      certify(
        'Event.prototype.type = foreignValue; const verdict = host.current.dispatchEvent(new Event("notice"))',
        undefined,
        {},
        "event",
      ),
    ).toBe(false);
    expect(
      certify(
        'const verdict = host.current.dispatchEvent(new Event("notice", { get bubbles() { return arbitraryWork(); } }))',
        undefined,
        {},
        "event",
      ),
    ).toBe(false);
    expect(
      certify(
        'const verdict = host.current.dispatchEvent(new CustomEvent("notice", { detail: { then: () => arbitraryWork() } }))',
        undefined,
        {},
        "event",
      ),
    ).toBe(false);
    expect(
      certify(
        'const verdict = externalTarget.dispatchEvent(new Event("notice"))',
        undefined,
        {},
        "event",
      ),
    ).toBe(false);
  });

  it("preserves native facts across effectful dispatch without certifying it as passive", () => {
    expect(
      certify(
        "host.current.click(); const verdict = host.current.cloneNode(true)",
        "<div ref={host}><button onClick={() => arbitraryWork()} /></div>",
      ),
    ).toBe(true);
    expect(
      certify(
        'host.current.dispatchEvent(new Event("notice")); const verdict = host.current.cloneNode(true)',
      ),
    ).toBe(true);
    expect(certify("const verdict = host.current.click()")).toBe(false);
    expect(certify('const verdict = host.current.dispatchEvent(new Event("notice"))')).toBe(false);
  });
});
