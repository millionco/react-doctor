import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  PROVIDER_PROOF_SMALL_COMPONENT_COUNT,
  PROVIDER_PROOF_LARGE_COMPONENT_COUNT,
  PROVIDER_PROOF_MAX_GROWTH_RATIO,
} from "../../../test-utils/constants.js";
import * as astWalking from "../../utils/walk-ast.js";
import * as tsconfigAliasResolution from "../../utils/resolve-tsconfig-alias.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { Rule } from "../../utils/rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";
import { isTypedReduxStoreFactoryInitialization } from "./utils/is-typed-redux-store-factory-initialization.js";

interface TypedStoreCase {
  readonly name: string;
  readonly consumer?: string;
  readonly provider?: string;
  readonly companions?: Readonly<Record<string, string>>;
  readonly certificate: boolean;
  readonly diagnostics?: number;
}

const consumer = `import { useRef } from "react";
import { Provider } from "react-redux";
import { makeEngine, type Engine } from "./engine";
export const StorePanel = ({ children }) => {
  const storeSlot = useRef<Engine>(undefined);
  if (!storeSlot.current) {
    storeSlot.current = makeEngine();
  }
  return <Provider store={storeSlot.current}>{children}</Provider>;
};`;
const provider = `import { configureStore } from "@reduxjs/toolkit";
import reducer from "./reducer";
export const makeEngine = () => {
  return configureStore({ reducer: { counter: reducer } });
};
export type Engine = ReturnType<typeof makeEngine>;`;
const replaceConsumer = (before: string, after: string): string => consumer.replace(before, after);
const replaceProvider = (before: string, after: string): string => provider.replace(before, after);
const cases: ReadonlyArray<TypedStoreCase> = [
  { name: "typed fixed reducer factory", certificate: true, diagnostics: 0 },
  {
    name: "shorthand reducer map",
    provider: provider.replaceAll("counter: reducer", "reducer"),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "shorthand reducer escapes",
    provider: provider.replaceAll("counter: reducer", "reducer") + "\npublish(reducer);",
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "parenthesized factory",
    consumer: replaceConsumer("= makeEngine();", "= (makeEngine());"),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "asserted factory",
    consumer: replaceConsumer("= makeEngine();", "= (makeEngine() as Engine);"),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "satisfies factory",
    consumer: replaceConsumer("= makeEngine();", "= (makeEngine() satisfies Engine);"),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "renamed factory type and SDK imports",
    consumer: consumer
      .replaceAll("makeEngine", "allocateStore")
      .replaceAll("Engine", "StoreShape")
      .replace(
        "import { allocateStore, type StoreShape }",
        "import { makeEngine as allocateStore, type Engine as StoreShape }",
      ),
    provider: provider
      .replace("import { configureStore }", "import { configureStore as assembleStore }")
      .replace("return configureStore(", "return assembleStore("),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "concise returned SDK call",
    provider: replaceProvider(
      "() => {\n  return configureStore({ reducer: { counter: reducer } });\n}",
      "() => configureStore({ reducer: { counter: reducer } })",
    ),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "ordinary value import used as store type",
    consumer: replaceConsumer("makeEngine, type Engine", "makeEngine, Engine"),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "null sentinel",
    consumer: replaceConsumer("useRef<Engine>(undefined)", "useRef<Engine>(null)"),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "relative spelling resolves to same immediate provider",
    consumer: replaceConsumer('"./engine"', '"./engine.ts"'),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "provider with additional derived erased aliases",
    provider: provider + '\nexport type EngineState = ReturnType<Engine["getState"]>;',
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "opaque factory returning falsy",
    provider: replaceProvider("configureStore({ reducer: { counter: reducer } })", "undefined"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "registration inside factory",
    provider: replaceProvider("return configureStore", "registerListener(); return configureStore"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "cleanup resource returned alongside store",
    provider: replaceProvider(
      "return configureStore({ reducer: { counter: reducer } });",
      "const store = configureStore({ reducer: { counter: reducer } }); attachTransport(store); return store;",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "factory takes render input",
    consumer: replaceConsumer("makeEngine()", "makeEngine(children)"),
    provider: replaceProvider("() =>", "(seed) =>"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "asynchronous factory",
    provider: replaceProvider("() =>", "async () =>"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "wrong API provider",
    provider: replaceProvider('"@reduxjs/toolkit"', '"other-state-kit"'),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "type-only SDK constructor",
    provider: replaceProvider("import { configureStore }", "import type { configureStore }"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "secondary SDK namespace exposure",
    provider: 'import * as Toolkit from "@reduxjs/toolkit";\n' + provider,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "custom middleware",
    provider: replaceProvider(
      "{ reducer: { counter: reducer } }",
      "{ reducer: { counter: reducer }, middleware: tuneMiddleware }",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "custom enhancer",
    provider: replaceProvider(
      "{ reducer: { counter: reducer } }",
      "{ reducer: { counter: reducer }, enhancers: tuneEnhancers }",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "preloaded render state",
    provider: replaceProvider(
      "{ reducer: { counter: reducer } }",
      "{ reducer: { counter: reducer }, preloadedState: suppliedState }",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "computed reducer key",
    provider: replaceProvider("counter: reducer", "[reducerKey]: reducer"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "reducer map spread",
    provider: replaceProvider("counter: reducer", "...sharedReducers"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "duplicate reducer key",
    provider: replaceProvider("counter: reducer", "counter: reducer, counter: reducer"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "type alias points at another factory",
    provider: provider.replace("typeof makeEngine", "typeof unrelatedFactory"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "generic shadow of builtin ReturnType",
    provider: "type ReturnType<Value> = object;\n" + provider,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "generic owner shadows imported store type",
    consumer: replaceConsumer(
      "StorePanel = ({ children })",
      "StorePanel = <Engine,>({ children })",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "wrong imported store type",
    provider: provider + "\nexport type OtherEngine = { valid: true };",
    consumer: replaceConsumer("type Engine", "type OtherEngine as Engine"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "barrel provider",
    consumer: replaceConsumer('"./engine"', '"./bridge"'),
    companions: {
      "src/bridge.ts":
        'export { makeEngine } from "./engine"; export type { Engine } from "./engine";',
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "provider absent",
    companions: { "src/engine.ts": "" },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "actual local SDK remap",
    companions: {
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@reduxjs/toolkit":["src/fake-toolkit.ts"]}}}',
      "src/fake-toolkit.ts": "export const configureStore = () => undefined;",
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "actual local React provider remap",
    companions: {
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"react":["src/fake-react.ts"]}}}',
      "src/fake-react.ts": "export const useRef = () => ({ current: undefined });",
    },
    certificate: false,
  },
  {
    name: "actual local Redux Provider remap",
    companions: {
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"react-redux":["src/fake-provider.ts"]}}}',
      "src/fake-provider.ts": "export const Provider = () => null;",
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "module initialization registration",
    provider: provider + "\nregisterListener();",
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "unused value import can execute module",
    provider: 'import { sideEffect } from "./side-effect";\n' + provider,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "runtime enum capability mutation",
    provider: 'enum Patch { Applied = (eval("patch()"), 0) }\n' + provider,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "React provider namespace mutation",
    consumer: 'import React from "react";\n' + consumer + "\nReact.useRef = replacement;",
    certificate: false,
  },
  {
    name: "secondary React Redux namespace replacement",
    consumer:
      'import * as Bindings from "react-redux";\n' +
      consumer +
      "\nBindings.Provider = replacement;",
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "secondary React Redux default replacement",
    consumer:
      'import Bindings from "react-redux";\n' + consumer + "\nBindings.Provider = replacement;",
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "secondary named Provider transport",
    consumer:
      'import { Provider as AnotherProvider } from "react-redux";\n' +
      consumer +
      "\nconfigureBinding(AnotherProvider);",
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "same declaration secondary Provider binding",
    consumer: replaceConsumer(
      "import { Provider }",
      "import { Provider, Provider as AnotherProvider }",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "unused runtime React Redux binding remains unsupported",
    consumer: 'import { useSelector } from "react-redux";\n' + consumer,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "explicit erased React Redux type import",
    consumer: 'import type { TypedUseSelectorHook } from "react-redux";\n' + consumer,
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "explicit erased React Redux type specifier",
    consumer: replaceConsumer(
      "import { Provider }",
      "import { Provider, type TypedUseSelectorHook }",
    ),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "custom Provider context",
    consumer: replaceConsumer("<Provider store=", "<Provider context={customContext} store="),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "Provider attribute spread before store",
    consumer: replaceConsumer("<Provider store=", "<Provider {...providerOptions} store="),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "Provider attribute spread after store",
    consumer: replaceConsumer(
      "store={storeSlot.current}",
      "store={storeSlot.current} {...providerOptions}",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "other Provider attribute",
    consumer: replaceConsumer("<Provider store=", '<Provider stabilityCheck="always" store='),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "standard configured React JSX",
    companions: { "tsconfig.json": '{"compilerOptions":{"jsx":"react-jsx"}}' },
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "configured custom factory publishes store before commit",
    consumer:
      "let observedStore; const jsxPublisher = (component, props) => { observedStore = props.store; return null; };\n" +
      consumer,
    companions: {
      "tsconfig.json": '{"compilerOptions":{"jsx":"react","jsxFactory":"jsxPublisher"}}',
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "nearest JSX-only jsconfig publisher",
    companions: { "src/jsconfig.json": '{"compilerOptions":{"jsxFactory":"jsxPublisher"}}' },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "configured custom fragment factory",
    companions: { "tsconfig.json": '{"compilerOptions":{"jsxFragmentFactory":"customFragment"}}' },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "configured non-React import source",
    companions: {
      "tsconfig.json": '{"compilerOptions":{"jsx":"react-jsx","jsxImportSource":"custom-runtime"}}',
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "inherited custom JSX factory",
    companions: {
      "tsconfig.json": '{"extends":"./base"}',
      "base.json": '{"compilerOptions":{"jsxFactory":"jsxPublisher"}}',
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "source-visible local classic React factory",
    consumer:
      "let observedStore; const React = { createElement: (component, props) => { observedStore = props.store; return null; } };\n" +
      consumer,
    companions: { "tsconfig.json": '{"compilerOptions":{"jsx":"react"}}' },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "actual automatic JSX runtime remap",
    companions: {
      "tsconfig.json":
        '{"compilerOptions":{"jsx":"react-jsx","baseUrl":".","paths":{"react/jsx-runtime":["src/custom-jsx.ts"]}}}',
      "src/custom-jsx.ts":
        "export const jsx = (component, props) => { publishStore(props.store); return null; };",
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "actual development JSX runtime remap",
    companions: {
      "tsconfig.json":
        '{"compilerOptions":{"jsx":"react-jsxdev","baseUrl":".","paths":{"react/jsx-dev-runtime":["src/custom-jsx.ts"]}}}',
      "src/custom-jsx.ts":
        "export const jsxDEV = (component, props) => { publishStore(props.store); return null; };",
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "unresolved JSX inheritance",
    companions: { "tsconfig.json": '{"extends":"./missing"}' },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "malformed nearest JSX config",
    companions: { "src/tsconfig.json": "{" },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "type-only React ref producer",
    consumer: replaceConsumer("import { useRef }", "import type { useRef }"),
    certificate: false,
  },
  {
    name: "untyped opaque factory remains unsupported",
    consumer: replaceConsumer("useRef<Engine>", "useRef"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "guard also publishes store dispatch to listener registration",
    consumer: replaceConsumer(
      "storeSlot.current = makeEngine();",
      "storeSlot.current = makeEngine(); attachListeners(storeSlot.current.dispatch);",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "persistence registration after the guard",
    consumer: replaceConsumer(
      "return <Provider",
      "persistStore(storeSlot.current); return <Provider",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "opaque child receives stored value",
    consumer: replaceConsumer(
      'import { Provider } from "react-redux";',
      'import { Provider } from "./custom-provider";',
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "ref object escape retains legacy diagnostic",
    consumer: replaceConsumer("return <Provider", "publishSlot(storeSlot); return <Provider"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "later slot reset retains legacy diagnostic",
    consumer: replaceConsumer(
      "return <Provider",
      "storeSlot.current = undefined; return <Provider",
    ),
    certificate: false,
    diagnostics: 2,
  },
  {
    name: "unconditional slot write retains legacy diagnostic",
    consumer: replaceConsumer("if (!storeSlot.current)", "if (true)"),
    certificate: false,
    diagnostics: 1,
  },
];

const certificateProbe: Rule = {
  id: "typed-redux-store-initialization-certificate",
  severity: "warn",
  create: (context) => ({
    AssignmentExpression: (node) => {
      const refSymbol = resolveReactRefSymbol(node.left, context.scopes);
      if (refSymbol && isTypedReduxStoreFactoryInitialization(node.right, refSymbol, context))
        context.report({ node, message: "typed store value certificate" });
    },
  }),
};
let temporaryDirectory: string;
const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
  return absolutePath;
};
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "typed-store-ref-"));
  writeFile("tsconfig.json", '{"compilerOptions":{"jsx":"react-jsx"}}');
  resetFilesystemCaches();
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("typed Redux store guarded initialization", () => {
  it.each(cases)("$name", (fixture) => {
    writeFile("src/engine.ts", fixture.provider ?? provider);
    writeFile("src/reducer.ts", "export default (state = { count: 0 }) => state;");
    for (const [relativePath, contents] of Object.entries(fixture.companions ?? {}))
      writeFile(relativePath, contents);
    const code = fixture.consumer ?? consumer;
    const filename = writeFile("src/panel.tsx", code);
    const proof = runRule(certificateProbe, code, { filename });
    const result = runRule(noRefCurrentInRender, code, { filename });
    expect(proof.parseErrors).toEqual([]);
    expect(result.parseErrors).toEqual([]);
    expect(proof.diagnostics.length > 0).toBe(fixture.certificate);
    if (fixture.diagnostics !== undefined)
      expect(result.diagnostics).toHaveLength(fixture.diagnostics);
  });

  it("keeps whole-program proof work linear across refused shared-factory consumers", () => {
    writeFile("src/engine.ts", provider);
    writeFile("src/reducer.ts", "export default (state = { count: 0 }) => state;");
    const countVisitedNodes = (componentCount: number): number => {
      const imports = consumer.match(/^import[^\n]+\n/gm)?.join("") ?? "";
      const component = consumer.replace(/^import[^\n]+\n/gm, "");
      const code =
        imports +
        Array.from({ length: componentCount }, (_, index) =>
          component.replace("StorePanel", `StorePanel${index}`),
        ).join("\n");
      const filename = writeFile("src/panel.tsx", code);
      resetFilesystemCaches();
      let visitedNodes = 0;
      let wholeProgramWalks = 0;
      const walkAst = astWalking.walkAst;
      const traversal = vi.spyOn(astWalking, "walkAst").mockImplementation((node, visitor) => {
        if (node.type === "Program") wholeProgramWalks++;
        return walkAst(node, (candidate) => {
          visitedNodes++;
          return visitor(candidate);
        });
      });
      const jsxConfigurationProof = vi.spyOn(
        tsconfigAliasResolution,
        "hasStandardReactJsxConfiguration",
      );
      try {
        const result = runRule(noRefCurrentInRender, code, { filename });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(componentCount);
        expect(jsxConfigurationProof).not.toHaveBeenCalled();
        expect(wholeProgramWalks).toBe(0);
      } finally {
        traversal.mockRestore();
        jsxConfigurationProof.mockRestore();
      }
      return visitedNodes;
    };
    const smallVisits = countVisitedNodes(PROVIDER_PROOF_SMALL_COMPONENT_COUNT);
    const largeVisits = countVisitedNodes(PROVIDER_PROOF_LARGE_COMPONENT_COUNT);
    expect(smallVisits).toBeGreaterThan(0);
    expect(largeVisits).toBeLessThan(smallVisits * PROVIDER_PROOF_MAX_GROWTH_RATIO);
  });
});

describe("typed store provider read sets", () => {
  it("records provider content and negative local SDK mappings", () => {
    const filename = writeFile("src/panel.tsx", consumer);
    const providerPath = writeFile("src/engine.ts", provider);
    writeFile("src/reducer.ts", "export default (state = { count: 0 }) => state;");
    const configPath = writeFile(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@reduxjs/toolkit": ["src/local-toolkit"] },
        },
      }),
    );
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: consumer,
      ruleIds: ["no-ref-current-in-render"],
    });
    expect(trace?.contentPaths).toContain(providerPath);
    expect(trace?.contentPaths).toContain(configPath);
    expect(trace?.existencePaths).toContain(path.join(temporaryDirectory, "src/local-toolkit.ts"));
    const before = runRule(noRefCurrentInRender, consumer, { filename });
    expect(before.parseErrors).toEqual([]);
    expect(before.diagnostics).toHaveLength(0);
    writeFile("src/local-toolkit.ts", "export const configureStore = () => undefined;");
    resetFilesystemCaches();
    const after = runRule(noRefCurrentInRender, consumer, { filename });
    expect(after.parseErrors).toEqual([]);
    expect(after.diagnostics).toHaveLength(1);
  });

  it("refreshes the exported type witness with equal size and restored mtime", () => {
    const filename = writeFile("src/panel.tsx", consumer);
    const providerPath = writeFile("src/engine.ts", provider);
    writeFile("src/reducer.ts", "export default (state = { count: 0 }) => state;");
    const originalStat = fs.statSync(providerPath);
    const changed = provider.replace("ReturnType", "RecordType");
    expect(changed.length).toBe(provider.length);
    const phases = [
      { contents: provider, count: 0 },
      { contents: changed, count: 1 },
      { contents: provider, count: 0 },
    ];
    for (const { contents, count } of phases) {
      fs.writeFileSync(providerPath, contents);
      fs.utimesSync(providerPath, originalStat.atime, originalStat.mtime);
      resetFilesystemCaches();
      const result = runRule(noRefCurrentInRender, consumer, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(count);
    }
  });
});

describe("typed store JSX configuration dependencies", () => {
  it("captures nearest JSX-only config inheritance and replays the same probes", () => {
    const filename = writeFile("src/panel.tsx", consumer);
    writeFile("src/engine.ts", provider);
    writeFile("src/reducer.ts", "export default (state = { count: 0 }) => state;");
    const configPath = writeFile("src/jsconfig.json", '{"extends":"../jsx.base"}');
    const inheritedPath = writeFile("jsx.base.json", '{"compilerOptions":{"jsx":"react-jsx"}}');
    const first = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: consumer,
      ruleIds: ["no-ref-current-in-render"],
    });
    const second = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: consumer,
      ruleIds: ["no-ref-current-in-render"],
    });
    expect(first?.contentPaths).toContain(configPath);
    expect(first?.contentPaths).toContain(inheritedPath);
    expect(first?.existencePaths).toContain(path.join(temporaryDirectory, "src/tsconfig.json"));
    expect(second).toEqual(first);
    expect(runRule(noRefCurrentInRender, consumer, { filename }).diagnostics).toHaveLength(0);
  });

  it("retains a warning after inherited JSX publisher appearance and resets back", () => {
    const filename = writeFile("src/panel.tsx", consumer);
    writeFile("src/engine.ts", provider);
    writeFile("src/reducer.ts", "export default (state = { count: 0 }) => state;");
    const original = '{"compilerOptions":{"jsxImportSource":"react"}}';
    const changed = original.replace("react", "other");
    writeFile("src/jsconfig.json", '{"extends":"../jsx.base"}');
    const inheritedPath = writeFile("jsx.base.json", original);
    const originalStat = fs.statSync(inheritedPath);
    const phases = [
      { contents: original, count: 0 },
      { contents: changed, count: 1 },
      { contents: original, count: 0 },
    ];
    for (const { contents, count } of phases) {
      fs.writeFileSync(inheritedPath, contents);
      fs.utimesSync(inheritedPath, originalStat.atime, originalStat.mtime);
      resetFilesystemCaches();
      const result = runRule(noRefCurrentInRender, consumer, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(count);
    }
  });
});
