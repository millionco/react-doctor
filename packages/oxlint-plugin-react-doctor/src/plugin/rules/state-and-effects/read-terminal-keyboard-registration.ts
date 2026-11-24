import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface KeyboardRegistration {
  readonly source: string;
  readonly exportedName: string;
  readonly callbacks: ReadonlyArray<EsTreeNode>;
}

export const readTerminalKeyboardRegistration = (
  effect: EsTreeNode,
  setup: EsTreeNodeOfType<"CallExpression">,
  helper: EsTreeNode,
  scopes: RuleContext["scopes"],
): KeyboardRegistration | null => {
  if (
    !isFunctionLike(effect) ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    effect.body.body.length !== 2 ||
    !isNodeOfType(effect.body.body[0], "ExpressionStatement") ||
    effect.body.body[0].expression !== setup ||
    !isNodeOfType(effect.body.body[1], "ReturnStatement") ||
    !isNodeOfType(effect.body.body[1].argument, "Identifier") ||
    setup.optional ||
    setup.arguments.length !== 0 ||
    !isFunctionLike(helper) ||
    helper.async ||
    helper.generator ||
    helper.params.length !== 0 ||
    !isNodeOfType(helper.body, "BlockStatement")
  ) {
    return null;
  }

  const registration = helper.body.body.at(-1);
  if (
    !isNodeOfType(registration, "ExpressionStatement") ||
    !isNodeOfType(registration.expression, "CallExpression") ||
    registration.expression.optional ||
    registration.expression.arguments.length !== 1 ||
    !isNodeOfType(registration.expression.arguments[0], "ObjectExpression") ||
    !isNodeOfType(registration.expression.callee, "Identifier")
  ) {
    return null;
  }

  const symbol = scopes.symbolFor(registration.expression.callee);
  const imported = symbol && getImportDeclarationForSymbol(symbol);
  const specifier = symbol?.declarationNode;
  if (
    !imported ||
    imported.importKind === "type" ||
    imported.attributes?.length ||
    typeof imported.source.value !== "string" ||
    !imported.source.value.startsWith("./") ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type"
  ) {
    return null;
  }
  const exportedName = getImportedName(specifier);
  if (!exportedName) return null;

  const keys = new Set<string>();
  const callbacks: EsTreeNode[] = [];
  for (const statement of helper.body.body.slice(0, -1)) {
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return null;
    for (const { id, init } of statement.declarations) {
      if (!isNodeOfType(id, "Identifier") || !isFunctionLike(init)) return null;
      callbacks.push(init);
    }
  }
  for (const property of registration.expression.arguments[0].properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed) {
      return null;
    }
    const key = getStaticPropertyKeyName(property);
    if (!key || key === "__proto__" || keys.has(key)) return null;
    keys.add(key);
    const value = property.value;
    if (isFunctionLike(value)) {
      callbacks.push(value);
      continue;
    }
    if (!isNodeOfType(value, "Identifier")) return null;
    const referenced = scopes.symbolFor(value);
    if (!referenced || !isSymbolReadOnly(referenced) || referenced.kind !== "parameter") {
      return null;
    }
  }
  return callbacks.length > 0 ? { source: imported.source.value, exportedName, callbacks } : null;
};
