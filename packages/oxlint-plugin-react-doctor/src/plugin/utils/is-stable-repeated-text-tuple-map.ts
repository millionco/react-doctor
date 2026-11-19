import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { collectJsxRuntimeImports } from "./non-react-jsx-dialect.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const INTRINSIC_OBJECT_NAMES = new Set([
  "Array",
  "Object",
  "Symbol",
  "Reflect",
  "Function",
  "eval",
  "require",
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
]);
const GLOBAL_OBJECT_NAMES = new Set([
  "window",
  "globalThis",
  "self",
  "global",
  "document",
  "top",
  "parent",
  "opener",
  "frames",
  "location",
]);
const CAPABILITY_PROPERTIES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "call",
  "apply",
  "bind",
  "eval",
  "Function",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "defaultView",
  "contentWindow",
  "contentDocument",
]);
const ARRAY_PROTOCOL_PROPERTIES = new Set(["map", "from", "values", "keys", "entries", "next"]);
const intrinsicSafetyByScopes = new WeakMap<ScopeAnalysis, boolean>();

const isOrdinaryIntervalCall = (reference: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(reference, "Identifier") || reference.name !== "window") return false;
  const member = reference.parent;
  const call = member?.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== reference ||
    member.computed ||
    member.optional ||
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== member ||
    call.optional
  )
    return false;
  const method = getResolvedStaticPropertyName(member, scopes);
  if (method === "clearInterval") {
    return (
      call.arguments.length === 1 &&
      (isNodeOfType(call.arguments[0], "Identifier") ||
        (isNodeOfType(call.arguments[0], "Literal") && typeof call.arguments[0].value === "number"))
    );
  }
  if (
    method !== "setInterval" ||
    call.arguments.length !== 2 ||
    !isNodeOfType(call.arguments[1], "Literal") ||
    typeof call.arguments[1].value !== "number"
  )
    return false;
  const argument = call.arguments[0];
  const binding = isNodeOfType(argument, "Identifier") ? scopes.symbolFor(argument) : null;
  const callback = binding ? getDirectConstInitializer(binding) : argument;
  return (
    isNodeOfType(callback, "ArrowFunctionExpression") ||
    isNodeOfType(callback, "FunctionExpression")
  );
};

// An unrelated data read is not a constructor/prototype capability. Unknown
// computed calls, writes and extracted callable aliases remain outside this lane.
const hasClosedArrayIntrinsics = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = intrinsicSafetyByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let safe = true;
  walkAst(program, (node) => {
    if (!safe || isKeyedDraftTypeReference(node)) return false;
    if (
      isNodeOfType(node, "ForInStatement") ||
      isNodeOfType(node, "ForOfStatement") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression")
    ) {
      safe = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
      if (INTRINSIC_OBJECT_NAMES.has(node.name)) {
        safe = false;
        return false;
      }
      if (GLOBAL_OBJECT_NAMES.has(node.name) && !isOrdinaryIntervalCall(node, scopes)) {
        safe = false;
        return false;
      }
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const property = getResolvedStaticPropertyName(node, scopes);
      if (
        (property !== null && CAPABILITY_PROPERTIES.has(property)) ||
        (isWithinAssignmentTarget(node) &&
          (node.computed || property === null || ARRAY_PROTOCOL_PROPERTIES.has(property)))
      ) {
        safe = false;
        return false;
      }
      if (node.computed) {
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        const consumer = isNodeOfType(parent, "SpreadElement") ? parent.parent : parent;
        if (
          ((isNodeOfType(consumer, "CallExpression") || isNodeOfType(consumer, "NewExpression")) &&
            (consumer.callee === root ||
              consumer.arguments.some(
                (argument) =>
                  argument === root ||
                  (isNodeOfType(argument, "SpreadElement") && argument.argument === root),
              ))) ||
          (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === root) ||
          (isNodeOfType(parent, "ReturnStatement") && parent.argument === root) ||
          (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === root) ||
          (isNodeOfType(parent, "VariableDeclarator") && parent.init === root) ||
          (isNodeOfType(parent, "AssignmentExpression") && parent.right === root)
        ) {
          safe = false;
          return false;
        }
      }
    }
    if (isNodeOfType(node, "Property")) {
      const key = node.key;
      const property =
        !node.computed && isNodeOfType(key, "Identifier")
          ? key.name
          : isNodeOfType(key, "Literal") && typeof key.value === "string"
            ? key.value
            : null;
      if (
        (property !== null && CAPABILITY_PROPERTIES.has(property)) ||
        (node.computed && isNodeOfType(node.parent, "ObjectPattern"))
      ) {
        safe = false;
        return false;
      }
    }
  });
  intrinsicSafetyByScopes.set(scopes, safe);
  return safe;
};

const isNativeSpan = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"JSXElement"> =>
  isNodeOfType(node, "JSXElement") &&
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  node.openingElement.name.name === "span" &&
  Boolean(
    node.closingElement &&
    isNodeOfType(node.closingElement.name, "JSXIdentifier") &&
    node.closingElement.name.name === "span",
  );

const hasReadonlyCssModuleClass = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  program: EsTreeNode,
): boolean => {
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    expression.computed ||
    expression.optional ||
    !isNodeOfType(expression.property, "Identifier") ||
    !isNodeOfType(expression.object, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(expression.object);
  const declaration = symbol?.declarationNode.parent;
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.importKind === "type" ||
    (declaration.attributes?.length ?? 0) > 0 ||
    typeof declaration.source.value !== "string" ||
    /\s/.test(declaration.source.value) ||
    declaration.source.value.includes("\0") ||
    !/^\.{1,2}\/[^?#]+\.module\.(?:css|less|scss|sass)$/.test(declaration.source.value) ||
    !hasCompleteSymbolReferences(symbol, program, scopes)
  )
    return false;
  return symbol.references.every((reference) => {
    const member = reference.identifier.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== reference.identifier ||
      member.optional ||
      isWithinAssignmentTarget(member)
    )
      return false;
    const root = findTransparentExpressionRoot(member);
    const parent = root.parent;
    return !(
      (isNodeOfType(parent, "CallExpression") && parent.callee === root) ||
      (isNodeOfType(parent, "NewExpression") && parent.callee === root) ||
      (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === root)
    );
  });
};

/** A fixed private string strip is copied twice and rendered as native text.
 * Neither tuple values nor ordering can change; the copy never escapes the list.
 * This relies on ordinary native Array/CSS-module behavior and refuses visible
 * same-file intrinsic exposure instead of banning unrelated data indexing.
 */
export const isStableRepeatedTextTupleMap = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  getSourceText: () => string | undefined,
): boolean => {
  const callee = call.callee;
  if (
    call.optional ||
    call.arguments.length !== 1 ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "map" ||
    !isNodeOfType(callee.object, "ArrayExpression") ||
    callee.object.elements.length !== 2
  )
    return false;
  const [first, second] = callee.object.elements;
  if (
    !isNodeOfType(first, "SpreadElement") ||
    !isNodeOfType(second, "SpreadElement") ||
    !isNodeOfType(first.argument, "Identifier") ||
    !isNodeOfType(second.argument, "Identifier")
  )
    return false;
  const tuple = scopes.symbolFor(first.argument);
  const program = findProgramRoot(call);
  const initializer = tuple && getDirectConstInitializer(tuple);
  if (
    !tuple ||
    !program ||
    program.sourceType !== "module" ||
    tuple.scope !== scopes.rootScope ||
    tuple.declarationNode.parent?.parent !== program ||
    !initializer ||
    scopes.symbolFor(second.argument) !== tuple ||
    tuple.references.length !== 2 ||
    tuple.references.some(
      (reference) =>
        reference.flag !== "read" ||
        (reference.identifier !== first.argument && reference.identifier !== second.argument),
    )
  )
    return false;
  const values = stripParenExpression(initializer);
  if (
    !isNodeOfType(values, "ArrayExpression") ||
    values.elements.length === 0 ||
    !values.elements.every(
      (value) => isNodeOfType(value, "Literal") && typeof value.value === "string",
    )
  )
    return false;
  const callback = call.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 2 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    !isNodeOfType(callback.params[1], "Identifier")
  )
    return false;
  const body = stripParenExpression(callback.body);
  if (!isNativeSpan(body)) return false;
  const item = scopes.symbolFor(callback.params[0]);
  const index = scopes.symbolFor(callback.params[1]);
  if (!item || !index) return false;
  let key: EsTreeNode | null = null;
  let text: EsTreeNode | null = null;
  let classExpression: EsTreeNode | null = null;
  const attributes = new Set<string>();
  for (const attribute of body.openingElement.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attributes.has(attribute.name.name)
    )
      return false;
    attributes.add(attribute.name.name);
    if (attribute.name.name === "key") {
      if (
        !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
        !isNodeOfType(attribute.value.expression, "Identifier") ||
        scopes.symbolFor(attribute.value.expression) !== index
      )
        return false;
      key = attribute.value.expression;
    } else if (attribute.name.name === "className") {
      if (isNodeOfType(attribute.value, "Literal") && typeof attribute.value.value === "string")
        continue;
      if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
      const expression = attribute.value.expression;
      if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") continue;
      classExpression = expression;
    } else return false;
  }
  for (const child of body.children) {
    if (isNodeOfType(child, "JSXText") && child.value.trim() === "") continue;
    if (
      text ||
      !isNodeOfType(child, "JSXExpressionContainer") ||
      !isNodeOfType(child.expression, "Identifier") ||
      scopes.symbolFor(child.expression) !== item
    )
      return false;
    text = child.expression;
  }
  if (
    !key ||
    !text ||
    item.references.length !== 1 ||
    item.references[0]?.identifier !== text ||
    item.references[0].flag !== "read" ||
    index.references.length !== 1 ||
    index.references[0]?.identifier !== key ||
    index.references[0].flag !== "read"
  )
    return false;
  const children = call.parent;
  const parent = children?.parent;
  if (
    !isNodeOfType(children, "JSXExpressionContainer") ||
    children.expression !== call ||
    !isNativeSpan(parent) ||
    !parent.children.every(
      (child) =>
        child === children || (isNodeOfType(child, "JSXText") && child.value.trim() === ""),
    )
  )
    return false;
  if (
    ![tuple, item, index].every((symbol) => hasCompleteSymbolReferences(symbol, program, scopes)) ||
    (classExpression && !hasReadonlyCssModuleClass(classExpression, scopes, program))
  )
    return false;
  const sourceText = getSourceText();
  if (sourceText === undefined || /@jsx(?:ImportSource|Runtime|Frag)?\b/.test(sourceText))
    return false;
  const jsxRuntime = collectJsxRuntimeImports(program);
  return (
    !jsxRuntime.hasNonReactRuntime &&
    !jsxRuntime.hasNonReactMarker &&
    hasClosedArrayIntrinsics(program, scopes)
  );
};
