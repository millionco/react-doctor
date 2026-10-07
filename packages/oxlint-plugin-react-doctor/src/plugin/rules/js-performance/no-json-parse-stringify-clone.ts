import { defineRule } from "../../utils/define-rule.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInProjectDirectory } from "../../utils/is-in-project-directory.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { NEXTJS_PAGE_DATA_EXPORT_NAMES } from "../../utils/nextjs-page-data-export-names.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "`JSON.parse(JSON.stringify(x))` deep-clones by re-serializing: it is slow on large objects and silently drops `undefined`, functions, `Date`/`Map`/`Set`, and cyclic references. Use `structuredClone(x)`.";

// `JSON.<method>(...)` with a non-computed `JSON` member callee. Computed
// access (`JSON["parse"]`) is a v1 non-goal: it is vanishingly rare and
// keeping the matcher to plain member access avoids over-reaching.
const isJsonMethodCall = (
  node: EsTreeNode,
  method: string,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "JSON" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === method
  );
};

// A `JSON.parse(JSON.stringify(x))` round-trip inside a `snapshot*`,
// `serialize*`, or `*ToJson`-named helper is serialization — the lossy
// JSON coercion (drop functions/undefined, Date → ISO string) is the
// point, so the `structuredClone` advice (preserve Date/Map/Set/cycles)
// would change behavior. `clone`-named helpers are intentionally NOT
// exempt: those are the deep clones the rule exists to redirect.
const SNAPSHOT_FUNCTION_NAME_PATTERN = /snapshot|serializ|tojson|jsonsafe/i;

// `const normalizedDate = JSON.parse(JSON.stringify(date))` uses the
// round-trip to coerce values into their JSON form on purpose;
// `structuredClone` would preserve the original types and change behavior.
const NORMALIZATION_BINDING_NAME_PATTERN = /normali[sz]/i;

const isAssignedToNormalizationBinding = (node: EsTreeNode): boolean => {
  const holder = node.parent;
  return Boolean(
    holder &&
    isNodeOfType(holder, "VariableDeclarator") &&
    isNodeOfType(holder.id, "Identifier") &&
    NORMALIZATION_BINDING_NAME_PATTERN.test(holder.id.name),
  );
};

// `catch (err) { … JSON.parse(JSON.stringify(err)) … }` strips a thrown
// value to JSON-safe plain data (postMessage / logging): `structuredClone`
// throws on non-cloneable fields and preserves what the code intends to
// drop.
const isCatchParameterRoundTrip = (stringifyCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const argument = stringifyCall.arguments?.[0];
  if (!argument || !isNodeOfType(argument, "Identifier")) return false;
  let current: EsTreeNode | null | undefined = stringifyCall.parent;
  while (current) {
    if (
      isFunctionLike(current) &&
      (current.params ?? []).some(
        (parameter) => isNodeOfType(parameter, "Identifier") && parameter.name === argument.name,
      )
    ) {
      return false;
    }
    if (
      isNodeOfType(current, "CatchClause") &&
      isNodeOfType(current.param, "Identifier") &&
      current.param.name === argument.name
    ) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
};

const getName = (candidate: EsTreeNode | null | undefined): string | null => {
  if (!candidate) return null;
  if (isNodeOfType(candidate, "Identifier")) return candidate.name;
  return null;
};

const isInsideSnapshotHelper = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      const directName = isNodeOfType(current, "ArrowFunctionExpression")
        ? null
        : getName(current.id);
      const parent = current.parent;
      let boundName: string | null = directName;
      if (!boundName && parent && isNodeOfType(parent, "VariableDeclarator")) {
        boundName = getName(parent.id);
      }
      if (
        !boundName &&
        parent &&
        (isNodeOfType(parent, "Property") || isNodeOfType(parent, "MethodDefinition")) &&
        isNodeOfType(parent.key, "Identifier")
      ) {
        boundName = parent.key.name;
      }
      // The NEAREST named function-like ancestor decides: a lowercase
      // `snapshot*` helper name marks serialization-for-persistence, while
      // an uppercase-first name is a React component — a plain deep clone
      // in a component handler is exactly what the rule redirects, no
      // matter which `Snapshot*`-named ancestor encloses it. Anonymous
      // wrappers (inline callbacks) are transparent.
      if (boundName) {
        return SNAPSHOT_FUNCTION_NAME_PATTERN.test(boundName) && !isReactComponentName(boundName);
      }
    }
    current = current.parent ?? null;
  }
  return false;
};

const findEnclosingNextjsPageDataFunction = (node: EsTreeNode): EsTreeNode | null => {
  let outermostFunction: EsTreeNode | null = null;
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) outermostFunction = cursor;
    if (isNodeOfType(cursor, "Program")) {
      if (!outermostFunction) return null;
      for (const exportName of NEXTJS_PAGE_DATA_EXPORT_NAMES) {
        const exportedValue = findExportedValue(cursor, exportName);
        if (exportedValue && isAstDescendant(outermostFunction, exportedValue)) {
          return outermostFunction;
        }
      }
      return null;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const findConditionalReturnExpressionRoot = (node: EsTreeNode): EsTreeNode => {
  let expressionRoot = findTransparentExpressionRoot(node);
  while (
    expressionRoot.parent &&
    isNodeOfType(expressionRoot.parent, "ConditionalExpression") &&
    (expressionRoot.parent.consequent === expressionRoot ||
      expressionRoot.parent.alternate === expressionRoot)
  ) {
    expressionRoot = findTransparentExpressionRoot(expressionRoot.parent);
  }
  return expressionRoot;
};

const isReturnedPageDataResultBinding = (
  returnExpression: EsTreeNode,
  pageDataFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  const declarator = returnExpression.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== returnExpression ||
    !isNodeOfType(declarator.id, "Identifier") ||
    findEnclosingFunction(declarator) !== pageDataFunction
  ) {
    return false;
  }
  const bindingSymbol = context.scopes.symbolFor(declarator.id);
  if (!bindingSymbol || bindingSymbol.references.length !== 1) return false;
  const referenceRoot = findTransparentExpressionRoot(bindingSymbol.references[0].identifier);
  const returnStatement = referenceRoot.parent;
  return (
    isNodeOfType(returnStatement, "ReturnStatement") &&
    returnStatement.argument === referenceRoot &&
    findEnclosingFunction(returnStatement) === pageDataFunction
  );
};

const isSameShorthandPropertyValue = (
  node: EsTreeNode,
  property: EsTreeNodeOfType<"Property">,
): boolean => property.shorthand && (node === property.key || node === property.value);

const isValueForwardedThroughLiteralStructure = (
  node: EsTreeNode,
  structure: EsTreeNode,
): boolean => {
  const strippedNode = stripParenExpression(node);
  const strippedStructure = stripParenExpression(structure);
  if (strippedNode === strippedStructure) return true;
  if (isNodeOfType(strippedStructure, "ConditionalExpression")) {
    return (
      isValueForwardedThroughLiteralStructure(strippedNode, strippedStructure.consequent) ||
      isValueForwardedThroughLiteralStructure(strippedNode, strippedStructure.alternate)
    );
  }
  if (isNodeOfType(strippedStructure, "ArrayExpression")) {
    return strippedStructure.elements.some(
      (element) =>
        element &&
        !isNodeOfType(element, "SpreadElement") &&
        isValueForwardedThroughLiteralStructure(strippedNode, element),
    );
  }
  if (!isNodeOfType(strippedStructure, "ObjectExpression")) return false;
  return strippedStructure.properties.some((property) => {
    if (isNodeOfType(property, "SpreadElement")) {
      return isValueForwardedThroughLiteralStructure(strippedNode, property.argument);
    }
    if (!isNodeOfType(property, "Property")) return false;
    if (isValueForwardedThroughLiteralStructure(strippedNode, property.value)) return true;
    return isSameShorthandPropertyValue(strippedNode, property);
  });
};

const isValueForwardedToPropertyValue = (
  node: EsTreeNode,
  property: EsTreeNodeOfType<"Property">,
): boolean => {
  const directValue = findConditionalReturnExpressionRoot(node);
  if (isValueForwardedThroughLiteralStructure(directValue, property.value)) return true;
  return isSameShorthandPropertyValue(directValue, property);
};

const isInsideReturnedNextjsProps = (
  node: EsTreeNode,
  pageDataFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== pageDataFunction) {
    if (
      isNodeOfType(cursor, "Property") &&
      getStaticPropertyKeyName(cursor, { allowComputedString: true }) === "props" &&
      isValueForwardedToPropertyValue(node, cursor)
    ) {
      const propertyContainer = cursor.parent;
      if (!propertyContainer) return false;
      const returnExpression = findConditionalReturnExpressionRoot(propertyContainer);
      const returnStatement = returnExpression.parent;
      if (
        isNodeOfType(returnStatement, "ReturnStatement") &&
        findEnclosingFunction(returnStatement) === pageDataFunction
      ) {
        return true;
      }
      if (
        isNodeOfType(pageDataFunction, "ArrowFunctionExpression") &&
        !isNodeOfType(pageDataFunction.body, "BlockStatement") &&
        stripParenExpression(pageDataFunction.body) === stripParenExpression(returnExpression)
      ) {
        return true;
      }
      if (isReturnedPageDataResultBinding(returnExpression, pageDataFunction, context)) return true;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const isExpressionReturnedByFunction = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  const returnExpression = findConditionalReturnExpressionRoot(node);
  if (
    isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return stripParenExpression(functionNode.body) === stripParenExpression(returnExpression);
  }
  const returnStatement = returnExpression.parent;
  return (
    isNodeOfType(returnStatement, "ReturnStatement") &&
    returnStatement.argument === returnExpression &&
    findEnclosingFunction(returnStatement) === functionNode
  );
};

const isValueForwardedToBindingInitializer = (
  node: EsTreeNode,
  bindingInitializer: EsTreeNode,
): boolean => {
  const directValue = findConditionalReturnExpressionRoot(node);
  if (isValueForwardedThroughLiteralStructure(directValue, bindingInitializer)) return true;
  const initializer = stripParenExpression(bindingInitializer);
  if (!isNodeOfType(initializer, "CallExpression")) return false;
  const callee = stripParenExpression(initializer.callee);
  return isFunctionLike(callee) && isExpressionReturnedByFunction(node, callee);
};

const findPageDataResultBinding = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) {
      if (
        cursor.init &&
        isNodeOfType(cursor.id, "Identifier") &&
        isValueForwardedToBindingInitializer(node, cursor.init)
      ) {
        return cursor.id;
      }
      return null;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isUsedToSerializeNextjsPageProps = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isInProjectDirectory(context, "pages") || isInProjectDirectory(context, "pages/api")) {
    return false;
  }
  const pageDataFunction = findEnclosingNextjsPageDataFunction(node);
  if (!pageDataFunction) return false;
  if (isInsideReturnedNextjsProps(node, pageDataFunction, context)) return true;
  const bindingIdentifier = findPageDataResultBinding(node);
  const bindingSymbol = bindingIdentifier ? context.scopes.symbolFor(bindingIdentifier) : null;
  if (!bindingSymbol) return false;
  const aliasSymbols = collectConstAliasSymbols(bindingSymbol, context.scopes);
  const aliasSymbolIds = new Set(aliasSymbols.map((aliasSymbol) => aliasSymbol.id));
  let hasPagePropsReference = false;
  for (const aliasSymbol of aliasSymbols) {
    for (const reference of aliasSymbol.references) {
      if (findEnclosingFunction(reference.identifier) !== pageDataFunction) return false;
      if (isInsideReturnedNextjsProps(reference.identifier, pageDataFunction, context)) {
        hasPagePropsReference = true;
        continue;
      }
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const declarator = referenceRoot.parent;
      if (
        isNodeOfType(declarator, "VariableDeclarator") &&
        declarator.init === referenceRoot &&
        isNodeOfType(declarator.id, "Identifier")
      ) {
        const aliasSymbolForReference = context.scopes.symbolFor(declarator.id);
        if (aliasSymbolForReference && aliasSymbolIds.has(aliasSymbolForReference.id)) continue;
      }
      return false;
    }
  }
  return hasPagePropsReference;
};

export const noJsonParseStringifyClone = defineRule({
  id: "no-json-parse-stringify-clone",
  title: "JSON parse/stringify deep clone",
  severity: "warn",
  // Hermes (the default React Native / Expo JS engine) has no global
  // `structuredClone`, so the recommended rewrite would crash at runtime.
  disabledWhen: ["react-native"],
  recommendation:
    "Replace `JSON.parse(JSON.stringify(value))` with `structuredClone(value)`. It is faster and preserves Dates, Maps, Sets, and cyclic references.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isJsonMethodCall(node, "parse")) return;
      const firstArgument = node.arguments?.[0];
      if (!firstArgument || !isJsonMethodCall(firstArgument, "stringify")) return;
      // A function or array replacer (`JSON.stringify(x, (k, v) => …)`,
      // `JSON.stringify(x, ["a", "b"])`) transforms/filters the output, which
      // `structuredClone` cannot reproduce — so this is not a plain clone.
      const replacer = firstArgument.arguments?.[1];
      if (isFunctionLike(replacer) || isNodeOfType(replacer, "ArrayExpression")) return;
      // Symmetric to the replacer: an inline function reviver
      // (`JSON.parse(…, (k, v) => …)`) transforms the parsed values, which
      // `structuredClone` cannot reproduce either.
      const reviver = node.arguments?.[1];
      if (isFunctionLike(reviver)) return;
      if (isInsideSnapshotHelper(node)) return;
      if (isAssignedToNormalizationBinding(node)) return;
      if (isCatchParameterRoundTrip(firstArgument)) return;
      if (isUsedToSerializeNextjsPageProps(node, context)) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
