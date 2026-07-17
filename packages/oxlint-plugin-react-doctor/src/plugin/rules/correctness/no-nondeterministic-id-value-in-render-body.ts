import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Impure id generators (bare-identifier forms). A local same-file
// binding of the same name shadows the library import, so those are
// resolved away before matching.
const IMPURE_GENERATOR_IDENTIFIER_NAMES = new Set(["uniqueId", "nanoid", "shortid"]);

// JSX attributes whose value is an *identity reference*: another element
// or an aria/SVG relationship points at this id. When the id changes
// every render the reference and its target drift apart.
const IDENTITY_SINK_ATTRIBUTE_NAMES = new Set([
  "id",
  "htmlFor",
  "clipPath",
  "mask",
  "filter",
  "fill",
  "stroke",
]);

const isImportSpecifierNode = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(
    node &&
    (isNodeOfType(node, "ImportSpecifier") ||
      isNodeOfType(node, "ImportDefaultSpecifier") ||
      isNodeOfType(node, "ImportNamespaceSpecifier")),
  );

// True when `identifier` refers to the real library generator, not a
// same-file local binding that shadows it. Unresolved names (global /
// auto-imported) and names bound to an import specifier both qualify;
// a local function / variable of the same name does not.
const isUnshadowedLibraryReference = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return true;
  return isImportSpecifierNode(binding.initializer);
};

// True when `node` is a call to an impure id generator:
// `uniqueId()` / `nanoid()` / `shortid()`, `crypto.randomUUID()`,
// `_.uniqueId()` / `lodash.uniqueId()`, or `shortid.generate()`.
// Time/random primitives (`Date.now`, `new Date`, `Math.random`) are
// deliberately excluded — those belong to `rendering-hydration-mismatch-time`.
const isImpureIdGeneratorCall = (node: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "CallExpression")) return false;
  const callee = unwrapped.callee;

  if (isNodeOfType(callee, "Identifier")) {
    if (!IMPURE_GENERATOR_IDENTIFIER_NAMES.has(callee.name)) return false;
    return isUnshadowedLibraryReference(callee);
  }

  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  const propertyName = callee.property.name;

  if (propertyName === "randomUUID") {
    return (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "crypto" &&
      isUnshadowedLibraryReference(callee.object)
    );
  }
  // `_.uniqueId()` / `lodash.uniqueId()` — but only when the object is a
  // library namespace (unresolved global or import binding). A local
  // binding (`const fieldIds = useFieldIds(); fieldIds.uniqueId("email")`)
  // is a same-file factory whose determinism the name does not decide.
  if (propertyName === "uniqueId") {
    return isNodeOfType(callee.object, "Identifier") && isUnshadowedLibraryReference(callee.object);
  }
  // `shortid.generate()`
  if (propertyName === "generate") {
    return (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "shortid" &&
      isUnshadowedLibraryReference(callee.object)
    );
  }
  return false;
};

// True when `node` is — or wraps, through the fallback/prefix spellings
// (`providedId || uniqueId()`, `cond ? a : nanoid()`, `` `clip-${nanoid()}` ``,
// `"clip-" + nanoid()`) — an impure id generator call.
const containsImpureIdGeneratorCall = (node: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(node);
  if (isImpureIdGeneratorCall(unwrapped)) return true;
  if (isNodeOfType(unwrapped, "LogicalExpression")) {
    return (
      containsImpureIdGeneratorCall(unwrapped.left) ||
      containsImpureIdGeneratorCall(unwrapped.right)
    );
  }
  if (isNodeOfType(unwrapped, "ConditionalExpression")) {
    return (
      containsImpureIdGeneratorCall(unwrapped.consequent) ||
      containsImpureIdGeneratorCall(unwrapped.alternate)
    );
  }
  if (isNodeOfType(unwrapped, "TemplateLiteral")) {
    return (unwrapped.expressions ?? []).some((expression) =>
      containsImpureIdGeneratorCall(expression),
    );
  }
  if (isNodeOfType(unwrapped, "BinaryExpression") && unwrapped.operator === "+") {
    return (
      containsImpureIdGeneratorCall(unwrapped.left) ||
      containsImpureIdGeneratorCall(unwrapped.right)
    );
  }
  return false;
};

// The single returned expression of an arrow/function callback, or null
// when the body doesn't reduce to one returned expression.
const soleReturnedExpression = (callback: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(callback)) return null;
  const body = callback.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) return body;
  const statements = body.body ?? [];
  const returnStatement = statements.find((statement) =>
    isNodeOfType(statement, "ReturnStatement"),
  );
  if (returnStatement && isNodeOfType(returnStatement, "ReturnStatement")) {
    return (returnStatement.argument as EsTreeNode | null) ?? null;
  }
  return null;
};

// `useMemo(() => <impure>, [])`. React may discard and recompute a
// memoized value, so this is NOT a stable id — flag it too.
const isUseMemoOneShotImpureGenerator = (node: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "CallExpression")) return false;
  if (getCalleeName(unwrapped) !== "useMemo") return false;
  const callback = unwrapped.arguments?.[0];
  const dependencies = unwrapped.arguments?.[1];
  if (!callback || !isFunctionLike(callback)) return false;
  if (!dependencies || !isNodeOfType(dependencies, "ArrayExpression")) return false;
  if ((dependencies.elements ?? []).length !== 0) return false;
  const returned = soleReturnedExpression(callback);
  return Boolean(returned && containsImpureIdGeneratorCall(returned));
};

const jsxAttributeName = (attribute: EsTreeNode): string | null => {
  if (!isNodeOfType(attribute, "JSXAttribute")) return null;
  if (isNodeOfType(attribute.name, "JSXIdentifier")) return attribute.name.name;
  return null;
};

// Filters out identifier positions that are not variable references:
// a non-computed member property (`todo.id`) and a non-shorthand,
// non-computed object key (`{ id: value }`) reuse the name without
// reading the binding.
const isVariableReferencePosition = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const parent = identifier.parent;
  if (!parent) return true;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.property === identifier &&
    !parent.computed
  ) {
    return false;
  }
  if (
    isNodeOfType(parent, "Property") &&
    parent.key === identifier &&
    !parent.computed &&
    !parent.shorthand
  ) {
    return false;
  }
  return true;
};

// True when the subtree reads the exact render-body binding — same name
// alone is not enough: a map-callback param `({ id }) => …` shadows the
// outer `const id = nanoid()`, so each candidate identifier is resolved
// back to its declaration before it counts.
const subtreeReferencesBinding = (
  subtree: EsTreeNode,
  bindingIdentifier: EsTreeNodeOfType<"Identifier">,
): boolean => {
  let found = false;
  walkAst(subtree, (child) => {
    if (found) return false;
    if (!isNodeOfType(child, "Identifier") || child.name !== bindingIdentifier.name) return;
    if (!isVariableReferencePosition(child)) return;
    const resolvedBinding = findVariableInitializer(child, child.name);
    if (!resolvedBinding || resolvedBinding.bindingIdentifier !== bindingIdentifier) return;
    found = true;
    return false;
  });
  return found;
};

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
): boolean => {
  let flows = false;
  walkAst(functionNode, (child) => {
    if (flows) return false;
    const attributeName = jsxAttributeName(child);
    if (!attributeName) return;
    const isSink =
      IDENTITY_SINK_ATTRIBUTE_NAMES.has(attributeName) || attributeName.startsWith("aria-");
    if (!isSink) return;
    if (isInsideMarkupSerializationCall(child, functionNode)) return;
    const value = isNodeOfType(child, "JSXAttribute") ? (child.value as EsTreeNode | null) : null;
    if (value && subtreeReferencesBinding(value, bindingIdentifier)) {
      flows = true;
      return false;
    }
  });
  return flows;
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
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
      const enclosingFunction = findEnclosingFunction(node);
      if (!enclosingFunction || !componentOrHookDisplayNameForFunction(enclosingFunction)) return;

      const initializer = stripParenExpression(node.init);
      if (isUseMemoOneShotImpureGenerator(initializer)) {
        context.report({ node: node.init, message: USE_MEMO_MESSAGE });
        return;
      }
      if (!containsImpureIdGeneratorCall(initializer)) return;
      if (!bindingFlowsIntoIdentityReferenceSink(enclosingFunction, node.id)) return;
      context.report({ node: node.init, message: GENERATOR_MESSAGE });
    },
  }),
});
