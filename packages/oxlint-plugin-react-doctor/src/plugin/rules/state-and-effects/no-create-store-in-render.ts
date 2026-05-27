import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface StoreApi {
  readonly module: string;
  readonly exportedName: string;
  readonly humanLabel: string;
}

// External-store factories that allocate fresh state when called. Each
// entry pairs the npm module with the canonical export name we want
// to flag when invoked inside a render scope.
//
// NOTE: We deliberately list only factories whose return value is a
// store/atom/observable instance — NOT functions like `useStore` or
// `useAtom` which are React hooks and meant to be called per render.
const STORE_FACTORIES: ReadonlyArray<StoreApi> = [
  { module: "zustand", exportedName: "create", humanLabel: "zustand.create" },
  { module: "zustand", exportedName: "createStore", humanLabel: "zustand.createStore" },
  { module: "zustand/vanilla", exportedName: "createStore", humanLabel: "zustand.createStore" },
  { module: "zustand/vanilla", exportedName: "create", humanLabel: "zustand.create" },
  { module: "redux", exportedName: "createStore", humanLabel: "redux.createStore" },
  { module: "redux", exportedName: "configureStore", humanLabel: "redux.configureStore" },
  {
    module: "@reduxjs/toolkit",
    exportedName: "configureStore",
    humanLabel: "@reduxjs/toolkit.configureStore",
  },
  { module: "@reduxjs/toolkit", exportedName: "createSlice", humanLabel: "createSlice" },
  { module: "jotai", exportedName: "atom", humanLabel: "jotai.atom" },
  { module: "jotai/vanilla", exportedName: "atom", humanLabel: "jotai.atom" },
  { module: "jotai", exportedName: "createStore", humanLabel: "jotai.createStore" },
  { module: "valtio", exportedName: "proxy", humanLabel: "valtio.proxy" },
  { module: "valtio/vanilla", exportedName: "proxy", humanLabel: "valtio.proxy" },
  { module: "mobx", exportedName: "observable", humanLabel: "mobx.observable" },
  { module: "mobx", exportedName: "makeAutoObservable", humanLabel: "mobx.makeAutoObservable" },
  { module: "mobx", exportedName: "makeObservable", humanLabel: "mobx.makeObservable" },
  { module: "nanostores", exportedName: "atom", humanLabel: "nanostores.atom" },
  { module: "nanostores", exportedName: "map", humanLabel: "nanostores.map" },
  { module: "@xstate/store", exportedName: "createStore", humanLabel: "@xstate/store.createStore" },
];

const STORE_FACTORY_LOOKUP = new Map<string, ReadonlyArray<StoreApi>>();
for (const factory of STORE_FACTORIES) {
  const bucket = STORE_FACTORY_LOOKUP.get(factory.exportedName) ?? [];
  STORE_FACTORY_LOOKUP.set(factory.exportedName, [...bucket, factory]);
}

const resolveStoreFactoryForCallee = (callee: EsTreeNode): StoreApi | null => {
  if (!isNodeOfType(callee, "Identifier")) return null;
  const localName = callee.name;
  for (const factoryBucket of STORE_FACTORY_LOOKUP.values()) {
    for (const factory of factoryBucket) {
      const canonicalName = getImportedNameFromModule(callee, localName, factory.module);
      if (canonicalName === factory.exportedName) return factory;
    }
  }
  return null;
};

const enclosingComponentOrHookName = (node: EsTreeNode): string | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "FunctionDeclaration")) {
      const name = cursor.id?.name ?? null;
      if (name && isReactComponentOrHookName(name)) return name;
    }
    if (isNodeOfType(cursor, "VariableDeclarator")) {
      const initializer = cursor.init;
      const isFunctionInitializer =
        initializer &&
        (isNodeOfType(initializer, "ArrowFunctionExpression") ||
          isNodeOfType(initializer, "FunctionExpression"));
      if (isFunctionInitializer && isNodeOfType(cursor.id, "Identifier")) {
        const identifierName = cursor.id.name;
        if (isReactComponentOrHookName(identifierName)) return identifierName;
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

// External-store libraries (zustand, jotai, valtio, redux, mobx,
// nanostores, …) split state into a store object that lives ONE level
// above the React tree. Creating that store inside a render function
// or hook means a brand-new store is allocated on every render: every
// subscriber sees stale references, persisted state resets, and any
// component that subscribed to the previous instance silently
// disconnects. This is the same identity-stability bug as
// `no-create-context-in-render`, just for the external-store world.
//
// Detection (v1):
//   - The callee resolves to a known store-factory export from a
//     supported library (see `STORE_FACTORIES`).
//   - The call sits inside a function whose name looks like a React
//     component (PascalCase) or hook (`use*`).
//   - Calls at module scope or inside plain helper functions are NOT
//     flagged — that's the supported pattern.
//
// Out of scope (v2 ideas):
//   - Custom-named selectors or stores re-exported through the
//     project's own modules (cross-file resolution).
//   - Subclasses of the store factory.
//   - User-defined helpers that wrap a factory and are themselves
//     named like a component/hook (`useMakeStore`).
export const noCreateStoreInRender = defineRule<Rule>({
  id: "no-create-store-in-render",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Hoist the store/atom/observable construction to module scope — render functions and hooks must not allocate state containers.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const factory = resolveStoreFactoryForCallee(node.callee);
      if (!factory) return;
      const componentOrHookName = enclosingComponentOrHookName(node);
      if (!componentOrHookName) return;
      context.report({
        node,
        message: `\`${factory.humanLabel}(...)\` called inside "${componentOrHookName}" allocates a fresh store on every render — every subscriber disconnects and state resets. Hoist the call to module scope.`,
      });
    },
  }),
});
