import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isProvenReactHookCall } from "../../utils/is-proven-effect-hook-call.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

// JSX attributes whose value is an *identity reference*: another element
// or an aria/SVG relationship points at this id. When the id changes
// every render the reference and its target drift apart.
const IDENTITY_SINK_ATTRIBUTE_NAMES = new Set([
  "id",
  "htmlFor",
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
]);

const ID_GENERATOR_IMPORT_SOURCES = new Set([
  "lodash",
  "lodash/uniqueId",
  "lodash.uniqueid",
  "nanoid",
  "shortid",
]);
const USE_MEMO_HOOK_NAMES = new Set(["useMemo"]);

// True when `identifier` resolves to a supported generator import, or to
// the global `crypto` binding.
const isKnownIdGeneratorLibraryReference = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const importBinding = getImportBindingForName(identifier, identifier.name);
  const declaration = context.scopes.symbolFor(identifier)?.declarationNode;
  if (
    importBinding &&
    declaration &&
    (isNodeOfType(declaration, "ImportSpecifier") ||
      isNodeOfType(declaration, "ImportDefaultSpecifier") ||
      isNodeOfType(declaration, "ImportNamespaceSpecifier"))
  ) {
    return ID_GENERATOR_IMPORT_SOURCES.has(importBinding.source);
  }
  return identifier.name === "crypto" && context.scopes.isGlobalReference(identifier);
};

const isImportedIdGeneratorFunction = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const importBinding = getImportBindingForName(identifier, identifier.name);
  if (!importBinding || importBinding.isNamespace) return false;
  const declaration = context.scopes.symbolFor(identifier)?.declarationNode;
  if (
    !declaration ||
    (!isNodeOfType(declaration, "ImportSpecifier") &&
      !isNodeOfType(declaration, "ImportDefaultSpecifier"))
  ) {
    return false;
  }
  if (importBinding.source === "nanoid") {
    return importBinding.exportedName === "nanoid" || importBinding.exportedName === "default";
  }
  if (
    importBinding.source === "lodash" ||
    importBinding.source === "lodash/uniqueId" ||
    importBinding.source === "lodash.uniqueid"
  ) {
    return importBinding.exportedName === "uniqueId" || importBinding.exportedName === "default";
  }
  return importBinding.source === "shortid" && importBinding.exportedName === "default";
};

// True when `node` is a call to an impure id generator:
// `uniqueId()` / `nanoid()` / `shortid()`, `crypto.randomUUID()`,
// `_.uniqueId()` / `lodash.uniqueId()`, or `shortid.generate()`.
// Time/random primitives (`Date.now`, `new Date`, `Math.random`) are
// deliberately excluded — those belong to `rendering-hydration-mismatch-time`.
const isImpureIdGeneratorCall = (node: EsTreeNode, context: RuleContext): boolean => {
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "CallExpression")) return false;
  const callee = unwrapped.callee;

  if (isNodeOfType(callee, "Identifier")) {
    return isImportedIdGeneratorFunction(callee, context);
  }

  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(callee);
  if (!propertyName) return false;

  if (propertyName === "randomUUID") {
    return (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "crypto" &&
      isKnownIdGeneratorLibraryReference(callee.object, context)
    );
  }
  // `_.uniqueId()` / `lodash.uniqueId()` — but only when the object is a
  // supported library import. A local
  // binding (`const fieldIds = useFieldIds(); fieldIds.uniqueId("email")`)
  // is a same-file factory whose determinism the name does not decide.
  if (propertyName === "uniqueId") {
    return (
      isNodeOfType(callee.object, "Identifier") &&
      isKnownIdGeneratorLibraryReference(callee.object, context)
    );
  }
  if (propertyName === "nanoid") {
    if (!isNodeOfType(callee.object, "Identifier")) return false;
    const importBinding = getImportBindingForName(callee.object, callee.object.name);
    const declaration = context.scopes.symbolFor(callee.object)?.declarationNode;
    return Boolean(
      importBinding?.isNamespace &&
      importBinding.source === "nanoid" &&
      declaration &&
      isNodeOfType(declaration, "ImportNamespaceSpecifier"),
    );
  }
  // `shortid.generate()`
  if (propertyName === "generate") {
    return (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "shortid" &&
      isKnownIdGeneratorLibraryReference(callee.object, context)
    );
  }
  return false;
};

// True when `node` is — or wraps, through the fallback/prefix spellings
// (`providedId || uniqueId()`, `cond ? a : nanoid()`, `` `clip-${nanoid()}` ``,
// `"clip-" + nanoid()`) — an impure id generator call.
const containsImpureIdGeneratorCall = (node: EsTreeNode, context: RuleContext): boolean => {
  const unwrapped = stripParenExpression(node);
  if (isImpureIdGeneratorCall(unwrapped, context)) return true;
  if (isNodeOfType(unwrapped, "LogicalExpression")) {
    return (
      containsImpureIdGeneratorCall(unwrapped.left, context) ||
      containsImpureIdGeneratorCall(unwrapped.right, context)
    );
  }
  if (isNodeOfType(unwrapped, "ConditionalExpression")) {
    return (
      containsImpureIdGeneratorCall(unwrapped.consequent, context) ||
      containsImpureIdGeneratorCall(unwrapped.alternate, context)
    );
  }
  if (isNodeOfType(unwrapped, "TemplateLiteral")) {
    return (unwrapped.expressions ?? []).some((expression) =>
      containsImpureIdGeneratorCall(expression, context),
    );
  }
  if (isNodeOfType(unwrapped, "BinaryExpression") && unwrapped.operator === "+") {
    return (
      containsImpureIdGeneratorCall(unwrapped.left, context) ||
      containsImpureIdGeneratorCall(unwrapped.right, context)
    );
  }
  return false;
};

// The single returned expression of an arrow/function callback, or null
// when the body doesn't reduce to one returned expression.
const returnedExpressions = (callback: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(callback)) return [];
  const body = callback.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) return [body];
  const expressions: EsTreeNode[] = [];
  walkAst(body, (child) => {
    if (child !== body && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      expressions.push(child.argument);
      return false;
    }
    return undefined;
  });
  return expressions;
};

// `useMemo(() => <impure>, [])`. React may discard and recompute a
// memoized value, so this is NOT a stable id — flag it too.
const isUseMemoOneShotImpureGenerator = (node: EsTreeNode, context: RuleContext): boolean => {
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "CallExpression")) return false;
  if (!isProvenReactHookCall(unwrapped, USE_MEMO_HOOK_NAMES, context.scopes)) return false;
  const callback = unwrapped.arguments?.[0];
  const dependencies = unwrapped.arguments?.[1];
  if (!callback || !isFunctionLike(callback)) return false;
  if (!dependencies || !isNodeOfType(dependencies, "ArrayExpression")) return false;
  if ((dependencies.elements ?? []).length !== 0) return false;
  return returnedExpressions(callback).some((returned) =>
    containsImpureIdGeneratorCall(returned, context),
  );
};

const jsxAttributeName = (attribute: EsTreeNode): string | null => {
  if (!isNodeOfType(attribute, "JSXAttribute")) return null;
  if (isNodeOfType(attribute.name, "JSXIdentifier")) return attribute.name.name;
  return null;
};

const isIdentityReferenceAttribute = (attribute: EsTreeNode): boolean => {
  const attributeName = jsxAttributeName(attribute);
  return attributeName !== null && IDENTITY_SINK_ATTRIBUTE_NAMES.has(attributeName);
};

// Filters out identifier positions that are not variable references:
// a non-computed member property (`todo.id`) and a non-shorthand,
// non-computed object key (`{ id: value }`) reuse the name without
// reading the binding.
// True when the subtree reads the exact render-body binding — same name
// alone is not enough: a map-callback param `({ id }) => …` shadows the
// outer `const id = nanoid()`, so each candidate identifier is resolved
// back to its declaration before it counts.
// JSX handed to `renderToStaticMarkup`/`renderToString` inside a handler
// is serialized atomically per call and never mounted — the id and its
// `url(#...)` reference are always emitted from the same value, so
// per-render drift cannot split them.
const isInsideMarkupSerializationCall = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== boundary) {
    if (
      isNodeOfType(ancestor, "CallExpression") &&
      /^renderTo(?:StaticMarkup|String)$/.test(getCalleeName(ancestor) ?? "")
    ) {
      return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// True when the binding is threaded into an identity-reference JSX
// attribute (`id` / `htmlFor` / `aria-*` / an SVG `clip-path` /
// `url(#...)` paint) anywhere inside the component/hook body.
const bindingFlowsIntoIdentityReferenceSink = (
  functionNode: EsTreeNode,
  bindingIdentifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const initialSymbol = context.scopes.symbolFor(bindingIdentifier);
  if (!initialSymbol) return false;
  const pendingSymbols = [initialSymbol];
  const visitedSymbolIds = new Set<number>();
  while (pendingSymbols.length > 0) {
    const symbol = pendingSymbols.shift();
    if (!symbol || visitedSymbolIds.has(symbol.id)) continue;
    visitedSymbolIds.add(symbol.id);
    for (const reference of symbol.references) {
      let ancestor: EsTreeNode | null | undefined = reference.identifier.parent;
      while (ancestor && ancestor !== functionNode && !isNodeOfType(ancestor, "JSXAttribute")) {
        ancestor = ancestor.parent ?? null;
      }
      if (ancestor && isNodeOfType(ancestor, "JSXAttribute")) {
        if (
          isIdentityReferenceAttribute(ancestor) &&
          !isInsideMarkupSerializationCall(ancestor, functionNode)
        ) {
          return true;
        }
      }
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const declarator = referenceRoot.parent;
      if (
        declarator &&
        isNodeOfType(declarator, "VariableDeclarator") &&
        declarator.init === referenceRoot &&
        isNodeOfType(declarator.id, "Identifier")
      ) {
        const aliasSymbol = context.scopes.symbolFor(declarator.id);
        if (aliasSymbol) pendingSymbols.push(aliasSymbol);
      }
    }
  }
  return false;
};

const GENERATOR_MESSAGE =
  "This id generator runs on every render, so the id changes each render and its htmlFor/aria/SVG reference stops matching (and mismatches during SSR). Use useId for reference ids, or a useRef/useState initializer to mint it once.";

const USE_MEMO_MESSAGE =
  "useMemo does not guarantee a stable value (React may recompute it), so this id can change mid-session and break its reference. Mint it once with useRef or a useState initializer instead.";

export const noNondeterministicIdValueInRenderBody = defineRule({
  id: "no-nondeterministic-id-value-in-render-body",
  title: "Nondeterministic id generated in render body",
  severity: "warn",
  category: "Correctness",
  tags: ["react-jsx-only"],
  recommendation:
    "An id generator (uniqueId/nanoid/crypto.randomUUID/shortid) bound in the render body re-runs every render, so the id is unstable and breaks htmlFor/aria/SVG references and SSR hydration. Use useId for reference ids, or a useRef/useState initializer to mint it once.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isImpureIdGeneratorCall(node, context)) return;
      const enclosingFunction = findEnclosingFunction(node);
      if (!enclosingFunction || !componentOrHookDisplayNameForFunction(enclosingFunction)) return;
      let ancestor: EsTreeNode | null | undefined = node.parent;
      while (
        ancestor &&
        ancestor !== enclosingFunction &&
        !isNodeOfType(ancestor, "JSXAttribute")
      ) {
        ancestor = ancestor.parent ?? null;
      }
      if (
        !ancestor ||
        !isNodeOfType(ancestor, "JSXAttribute") ||
        !isIdentityReferenceAttribute(ancestor) ||
        isInsideMarkupSerializationCall(ancestor, enclosingFunction)
      ) {
        return;
      }
      context.report({ node, message: GENERATOR_MESSAGE });
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
      const enclosingFunction = findEnclosingFunction(node);
      if (!enclosingFunction || !componentOrHookDisplayNameForFunction(enclosingFunction)) return;

      const initializer = stripParenExpression(node.init);
      if (isUseMemoOneShotImpureGenerator(initializer, context)) {
        context.report({ node: node.init, message: USE_MEMO_MESSAGE });
        return;
      }
      if (!containsImpureIdGeneratorCall(initializer, context)) return;
      if (!bindingFlowsIntoIdentityReferenceSink(enclosingFunction, node.id, context)) return;
      context.report({ node: node.init, message: GENERATOR_MESSAGE });
    },
  }),
});
