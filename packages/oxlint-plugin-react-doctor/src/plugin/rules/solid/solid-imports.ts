import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

type Source = "solid-js" | "solid-js/web" | "solid-js/store";

const SOURCE_PATTERN = /^solid-js(?:\/web|\/store)?$/;
const isKnownSource = (source: string): source is Source => SOURCE_PATTERN.test(source);

const PRIMITIVE_SOURCE_MAP = new Map<string, Source>();
const TYPE_SOURCE_MAP = new Map<string, Source>();

for (const primitive of [
  "createSignal",
  "createEffect",
  "createMemo",
  "createResource",
  "onMount",
  "onCleanup",
  "onError",
  "untrack",
  "batch",
  "on",
  "createRoot",
  "getOwner",
  "runWithOwner",
  "mergeProps",
  "splitProps",
  "useTransition",
  "observable",
  "from",
  "mapArray",
  "indexArray",
  "createContext",
  "useContext",
  "children",
  "lazy",
  "createUniqueId",
  "createDeferred",
  "createRenderEffect",
  "createComputed",
  "createReaction",
  "createSelector",
  "DEV",
  "For",
  "Show",
  "Switch",
  "Match",
  "Index",
  "ErrorBoundary",
  "Suspense",
  "SuspenseList",
]) {
  PRIMITIVE_SOURCE_MAP.set(primitive, "solid-js");
}
for (const primitive of [
  "Portal",
  "render",
  "hydrate",
  "renderToString",
  "renderToStream",
  "isServer",
  "renderToStringAsync",
  "generateHydrationScript",
  "HydrationScript",
  "Dynamic",
]) {
  PRIMITIVE_SOURCE_MAP.set(primitive, "solid-js/web");
}
for (const primitive of [
  "createStore",
  "produce",
  "reconcile",
  "unwrap",
  "createMutable",
  "modifyMutable",
]) {
  PRIMITIVE_SOURCE_MAP.set(primitive, "solid-js/store");
}

for (const typeName of [
  "Signal",
  "Accessor",
  "Setter",
  "Resource",
  "ResourceActions",
  "ResourceOptions",
  "ResourceReturn",
  "ResourceFetcher",
  "InitializedResourceReturn",
  "Component",
  "VoidProps",
  "VoidComponent",
  "ParentProps",
  "ParentComponent",
  "FlowProps",
  "FlowComponent",
  "ValidComponent",
  "ComponentProps",
  "Ref",
  "MergeProps",
  "SplitProps",
  "Context",
  "JSX",
  "ResolvedChildren",
  "MatchProps",
]) {
  TYPE_SOURCE_MAP.set(typeName, "solid-js");
}
for (const typeName of ["MountableElement"]) {
  TYPE_SOURCE_MAP.set(typeName, "solid-js/web");
}
for (const typeName of ["StoreNode", "Store", "SetStoreFunction"]) {
  TYPE_SOURCE_MAP.set(typeName, "solid-js/store");
}

// Port of `solid/imports` — flags specifiers that are imported from
// the wrong solid-js subpath (`{ render } from "solid-js"` →
// `"solid-js/web"`, etc.). The lookup tables come straight from the
// upstream plugin, kept as the canonical source of public exports.
export const solidImports = defineRule<Rule>({
  id: "solid-imports",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Import each Solid primitive from its canonical subpath (solid-js / web / store).",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source.value;
      if (typeof source !== "string" || !isKnownSource(source)) return;
      for (const specifier of node.specifiers) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        const importedIdentifier = specifier.imported;
        if (!isNodeOfType(importedIdentifier, "Identifier")) continue;
        const isTypeOnlyImport = specifier.importKind === "type" || node.importKind === "type";
        const sourceMap = isTypeOnlyImport ? TYPE_SOURCE_MAP : PRIMITIVE_SOURCE_MAP;
        const correctSource = sourceMap.get(importedIdentifier.name);
        if (correctSource && correctSource !== source) {
          context.report({
            node: specifier,
            message: `Prefer importing \`${importedIdentifier.name}\` from "${correctSource}".`,
          });
        }
      }
    },
  }),
});
