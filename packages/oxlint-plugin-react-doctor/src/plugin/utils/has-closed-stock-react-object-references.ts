import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { walkAst } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";

const METHODS: Readonly<Record<string, ReadonlySet<string>>> = {
  react: new Set([
    "createElement",
    "cloneElement",
    "createContext",
    "createRef",
    "forwardRef",
    "isValidElement",
    "lazy",
    "memo",
    "startTransition",
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
  ]),
  "react-dom": new Set([
    "createPortal",
    "flushSync",
    "render",
    "hydrate",
    "unmountComponentAtNode",
  ]),
  "react-dom/client": new Set(["createRoot", "hydrateRoot"]),
  "react/jsx-runtime": new Set(["jsx", "jsxs"]),
  "react/jsx-dev-runtime": new Set(["jsxDEV"]),
};
const TAGS = new Set(["Fragment", "Suspense", "StrictMode", "Profiler"]);

const isDirectCall = (node: EsTreeNode): boolean => {
  const call = node.parent;
  return isNodeOfType(call, "CallExpression") && !call.optional && call.callee === node;
};

const isErasedProviderReference = (reference: EsTreeNode): boolean => {
  let node = reference;
  while (isNodeOfType(node.parent, "MemberExpression") && node.parent.object === node)
    node = node.parent;
  if (
    String(node.parent?.type) === "TSImportEqualsDeclaration" ||
    String(node.parent?.type) === "TSExternalModuleReference"
  )
    return false;
  let parent = node.parent;
  while (parent && String(parent.type) === "TSQualifiedName") parent = parent.parent;
  if (String(parent?.type) === "TSImportEqualsDeclaration") return false;
  return isTypeScriptTypePosition(node);
};
const isChildrenCall = (node: EsTreeNode): boolean => {
  const member = node.parent;
  return (
    isNodeOfType(member, "MemberExpression") &&
    member.object === node &&
    !member.computed &&
    !member.optional &&
    isNodeOfType(member.property, "Identifier") &&
    ["map", "forEach", "count", "only", "toArray"].includes(member.property.name) &&
    isDirectCall(member)
  );
};

const isReadOnlyNamedBuildReactValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const member = node.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    member.object !== node ||
    !isNodeOfType(member.property, "Identifier")
  )
    return false;
  if (member.property.name === "version") {
    const split = member.parent;
    return (
      isNodeOfType(split, "MemberExpression") &&
      !split.optional &&
      !split.computed &&
      split.object === member &&
      isNodeOfType(split.property, "Identifier") &&
      split.property.name === "split" &&
      isNodeOfType(split.parent, "CallExpression") &&
      !split.parent.optional &&
      split.parent.callee === split &&
      split.parent.arguments.length === 1 &&
      isNodeOfType(split.parent.arguments[0], "Literal") &&
      split.parent.arguments[0].value === "."
    );
  }

  if (!["useLayoutEffect", "useEffect"].includes(member.property.name)) return false;
  const choice = member.parent;
  if (!isNodeOfType(choice, "ConditionalExpression")) return false;
  const other =
    choice.consequent === member
      ? choice.alternate
      : choice.alternate === member
        ? choice.consequent
        : null;
  if (
    !isNodeOfType(other, "MemberExpression") ||
    other.computed ||
    other.optional ||
    !isNodeOfType(other.object, "Identifier") ||
    !isNodeOfType(other.property, "Identifier") ||
    other.property.name !== (member.property.name === "useEffect" ? "useLayoutEffect" : "useEffect")
  )
    return false;
  const receiver = scopes.symbolFor(node);
  if (!receiver || scopes.symbolFor(other.object) !== receiver) return false;
  const declaration = choice.parent;
  return (
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.init === choice &&
    isNodeOfType(declaration.id, "Identifier") &&
    isNodeOfType(declaration.parent, "VariableDeclaration") &&
    declaration.parent.kind === "const" &&
    declaration.parent.declarations.length === 1 &&
    isNodeOfType(declaration.parent.parent, "ExportNamedDeclaration")
  );
};

// A deliberately narrow own-source integrity fence, supplementary to physical
// package identity. It never executes imports and does not certify external packages.
const inspectStockReactObjectReferences = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  isProvenDataImport?: (node: EsTreeNode) => boolean,
  allowNamedBuildReadOnlyValues = false,
): readonly { reason: string; name?: string; node: EsTreeNode }[] => {
  const failures: { reason: string; name?: string; node: EsTreeNode }[] = [];
  if (!isNodeOfType(program, "Program")) return [{ reason: "not-program", node: program }];
  walkAst(program, (node) => {
    if (String(node.type) === "TSExternalModuleReference")
      failures.push({ reason: "typescript-runtime-module-acquisition", node });
    if (
      isNodeOfType(node, "ImportExpression") &&
      (isNodeOfType(node.source, "Literal") && typeof node.source.value === "string"
        ? /^(?:react|react-dom)(?:\/|$)/u.test(node.source.value)
        : !isProvenDataImport?.(node))
    )
      failures.push({ reason: "runtime-module-acquisition", node });
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "require" &&
      scopes.isGlobalReference(node)
    )
      failures.push({ reason: "commonjs-runtime-acquisition", node });
  });
  for (const statement of program.body) {
    if (
      (isNodeOfType(statement, "ExportNamedDeclaration") ||
        isNodeOfType(statement, "ExportAllDeclaration")) &&
      statement.source &&
      typeof statement.source.value === "string" &&
      Object.hasOwn(METHODS, statement.source.value)
    )
      failures.push({ reason: "provider-reexport", node: statement });
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      typeof statement.source.value !== "string"
    )
      continue;
    if (["module", "node:module"].includes(statement.source.value)) {
      failures.push({ reason: "module-loader-import", node: statement });
      continue;
    }
    const methods = Object.hasOwn(METHODS, statement.source.value)
      ? METHODS[statement.source.value]
      : undefined;
    if (!methods) continue;
    if (!statement.specifiers.length) {
      failures.push({ reason: "provider-side-effect-import", node: statement });
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const symbol = scopes.symbolFor(specifier.local);
      if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) {
        failures.push({ reason: "incomplete-provider-binding", node: specifier });
        continue;
      }
      const named =
        isNodeOfType(specifier, "ImportSpecifier") && isNodeOfType(specifier.imported, "Identifier")
          ? specifier.imported.name
          : null;
      for (const { identifier, flag } of symbol.references) {
        if (isErasedProviderReference(identifier)) continue;
        if (flag !== "read") {
          failures.push({ reason: "provider-write", node: identifier });
          continue;
        }
        if (named) {
          if (
            statement.source.value === "react" &&
            named === "Children" &&
            isChildrenCall(identifier)
          )
            continue;
          if (methods.has(named) && isDirectCall(identifier)) continue;
          if (
            statement.source.value === "react" &&
            TAGS.has(named) &&
            isNodeOfType(identifier, "JSXIdentifier") &&
            (isNodeOfType(identifier.parent, "JSXOpeningElement") ||
              isNodeOfType(identifier.parent, "JSXClosingElement")) &&
            identifier.parent.name === identifier
          )
            continue;
          failures.push({ reason: "named-provider-value-escape", name: named, node: identifier });
          continue;
        }
        if (
          statement.source.value === "react" &&
          allowNamedBuildReadOnlyValues &&
          isReadOnlyNamedBuildReactValue(identifier, scopes)
        )
          continue;
        const member = identifier.parent;
        if (
          statement.source.value === "react" &&
          isNodeOfType(member, "MemberExpression") &&
          member.object === identifier &&
          !member.computed &&
          !member.optional &&
          isNodeOfType(member.property, "Identifier") &&
          member.property.name === "Children" &&
          isChildrenCall(member)
        )
          continue;
        if (
          statement.source.value === "react" &&
          isNodeOfType(member, "JSXMemberExpression") &&
          member.object === identifier &&
          isNodeOfType(member.property, "JSXIdentifier") &&
          TAGS.has(member.property.name) &&
          (isNodeOfType(member.parent, "JSXOpeningElement") ||
            isNodeOfType(member.parent, "JSXClosingElement")) &&
          member.parent.name === member
        )
          continue;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== identifier ||
          member.computed ||
          member.optional ||
          !isNodeOfType(member.property, "Identifier") ||
          !methods.has(member.property.name) ||
          !isDirectCall(member)
        )
          failures.push({ reason: "provider-object-escape-or-mutation", node: identifier });
      }
    }
  }
  return failures;
};

export const hasClosedStockReactObjectReferences = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  isProvenDataImport?: (node: EsTreeNode) => boolean,
  allowNamedBuildReadOnlyValues = false,
): boolean =>
  inspectStockReactObjectReferences(
    program,
    scopes,
    isProvenDataImport,
    allowNamedBuildReadOnlyValues,
  ).length === 0;
