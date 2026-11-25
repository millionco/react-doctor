import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { OwnedReactContext } from "./resolve-owned-react-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export const getOwnedContextFunction = (
  context: OwnedReactContext,
  propertyName: string,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  const { memo, value } = context;
  if (!isNodeOfType(memo, "ArrowFunctionExpression") || memo.async || memo.params.length)
    return null;
  const body = memo.body;
  const returned = isNodeOfType(body, "BlockStatement") ? body.body.at(-1) : null;
  const expression = isNodeOfType(body, "BlockStatement")
    ? isNodeOfType(returned, "ReturnStatement")
      ? returned.argument
      : null
    : body;
  if (!expression) return null;
  let hasAlternativeReturn = false;
  walkAst(body, (node) => {
    if (isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && node !== returned) {
      hasAlternativeReturn = true;
      return false;
    }
  });
  if (hasAlternativeReturn) return null;
  const record = stripParenExpression(expression);
  if (!isNodeOfType(record, "ObjectExpression")) return null;
  let property: EsTreeNode | null = null;
  const keys = new Set<string>();
  for (const entry of record.properties) {
    if (!isNodeOfType(entry, "Property") || entry.kind !== "init" || entry.computed) return null;
    const key = getStaticPropertyKeyName(entry);
    if (!key || key === "__proto__" || keys.has(key)) return null;
    keys.add(key);
    if (key === propertyName) property = entry.value;
  }
  if (!property || !isNodeOfType(property, "Identifier")) return null;

  const scopes = value.module.scopes;
  const symbol = scopes.symbolFor(property);
  const fn = symbol?.initializer;
  if (
    symbol?.kind !== "const" ||
    !isNodeOfType(fn, "ArrowFunctionExpression") ||
    fn.async ||
    !isNodeOfType(body, "BlockStatement") ||
    symbol.declarationNode.parent?.parent !== body ||
    !hasCompleteSymbolReferences(symbol, value.module.programNode, scopes) ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return null;
  return fn;
};
