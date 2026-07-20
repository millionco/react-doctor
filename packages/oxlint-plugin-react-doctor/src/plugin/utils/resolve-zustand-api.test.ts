import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  resolveZustandApiBinding,
  resolveZustandStoreCreator,
  resolveZustandStoreFactoryCall,
  type ZustandStoreFactoryCall,
  type ZustandStoreCreator,
} from "./resolve-zustand-api.js";
import { walkAst } from "./walk-ast.js";

const collectResolvedCreators = (code: string): ZustandStoreCreator[] => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const creators: ZustandStoreCreator[] = [];
  walkAst(parsed.program, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    const creator = resolveZustandStoreCreator(node, scopes);
    if (creator) creators.push(creator);
  });
  return creators;
};

const collectResolvedFactoryCalls = (code: string): ZustandStoreFactoryCall[] => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const factoryCalls: ZustandStoreFactoryCall[] = [];
  walkAst(parsed.program, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    const factoryCall = resolveZustandStoreFactoryCall(node, scopes);
    if (factoryCall) factoryCalls.push(factoryCall);
  });
  return factoryCalls;
};

describe("resolveZustandApiBinding", () => {
  it("resolves named, namespace, default, and immutable aliases", () => {
    const parsed = parseFixture(`
      import createDefault, { create as createNamed } from "zustand";
      import * as Traditional from "zustand/traditional";
      const createAlias = createNamed;
      createDefault(() => ({}));
      createAlias(() => ({}));
      Traditional.createWithEqualityFn(() => ({}));
    `);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const apiNames: string[] = [];
    walkAst(parsed.program, (node: EsTreeNode) => {
      if (!isNodeOfType(node, "CallExpression")) return;
      const binding = resolveZustandApiBinding(node.callee, scopes);
      if (binding) apiNames.push(binding.apiName);
    });
    expect(apiNames).toEqual(["create", "create", "createWithEqualityFn"]);
  });

  it("rejects shadowed, mutable, computed, type-only, and userland bindings", () => {
    const parsed = parseFixture(`
      import type { create as createType } from "zustand";
      import * as Zustand from "zustand";
      import { create } from "zustand";
      let mutableCreate = create;
      mutableCreate = customCreate;
      function read(create) { create(() => ({})); }
      createType(() => ({}));
      mutableCreate(() => ({}));
      Zustand[factoryName](() => ({}));
      customCreate(() => ({}));
    `);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let resolvedCount = 0;
    walkAst(parsed.program, (node: EsTreeNode) => {
      if (isNodeOfType(node, "CallExpression") && resolveZustandApiBinding(node.callee, scopes)) {
        resolvedCount += 1;
      }
    });
    expect(resolvedCount).toBe(0);
  });
});

describe("resolveZustandStoreCreator", () => {
  it("resolves direct, curried, aliased, and known middleware creators", () => {
    const creators = collectResolvedCreators(`
      import { create } from "zustand";
      import { createStore as makeStore } from "zustand/vanilla";
      import { createWithEqualityFn } from "zustand/traditional";
      import { devtools, persist } from "zustand/middleware";
      import { immer } from "zustand/middleware/immer";
      const makeHook = create;
      const creator = (set, get) => ({ count: 0 });
      makeHook(creator);
      const curriedHook = create<{ count: number }>();
      curriedHook(creator);
      makeStore()((set, get) => ({ count: 0 }));
      createWithEqualityFn()(devtools(persist(immer((set, get) => ({ count: 0 })), {})));
    `);
    expect(creators).toHaveLength(4);
    expect(creators.map((creator) => creator.factoryApiName)).toEqual([
      "create",
      "create",
      "createStore",
      "createWithEqualityFn",
    ]);
    expect([...creators[3].middlewareNames]).toEqual(["devtools", "persist", "immer"]);
  });

  it("resolves combine's second argument", () => {
    const creators = collectResolvedCreators(`
      import { create } from "zustand";
      import { combine } from "zustand/middleware";
      create(combine({ count: 0 }, (set, get) => ({ increment: () => set({ count: 1 }) })));
    `);
    expect(creators).toHaveLength(1);
    expect([...creators[0].middlewareNames]).toEqual(["combine"]);
  });

  it("skips unknown wrappers, redux middleware, and imported creators", () => {
    const creators = collectResolvedCreators(`
      import { create } from "zustand";
      import { redux } from "zustand/middleware";
      import { creator } from "./creator";
      create(customMiddleware((set, get) => ({ count: get().count })));
      create(redux(reducer, { count: 0 }));
      create(creator);
    `);
    expect(creators).toHaveLength(0);
  });
});

describe("resolveZustandStoreFactoryCall", () => {
  it("resolves completed direct and curried factories without inspecting the creator", () => {
    const factoryCalls = collectResolvedFactoryCalls(`
      import { create } from "zustand";
      import { createStore } from "zustand/vanilla";
      import { createWithEqualityFn } from "zustand/traditional";
      import { creator } from "./creator";
      create(creator);
      createStore()((set) => ({ count: 0 }));
      createWithEqualityFn()(creator, Object.is);
      const makeStore = create<{ count: number }>();
      const makeStoreAlias = makeStore;
      makeStoreAlias(creator);
    `);
    expect(factoryCalls.map((factoryCall) => factoryCall.factoryApiName)).toEqual([
      "create",
      "createStore",
      "createWithEqualityFn",
      "create",
    ]);
  });

  it("skips incomplete curried factories and userland calls", () => {
    const factoryCalls = collectResolvedFactoryCalls(`
      import { create } from "zustand";
      const makeStore = create();
      customCreate(() => ({ count: 0 }));
    `);
    expect(factoryCalls).toEqual([]);
  });
});
