import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getImportedNameFromModule } from "./find-import-source-for-name.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getJsxPropStaticStringValues } from "./get-jsx-prop-static-string-values.js";
import { getNextStaticJsxElementSibling } from "./get-next-static-jsx-element-sibling.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticDirectJsxElements } from "./get-static-direct-jsx-elements.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const HIDDEN_CLASS_TOKEN =
  /(?:^|:)[!]?(?:hidden|invisible|collapse|sr-only|opacity-0|pointer-events-none|translate-y-full|[-]translate-y-full)!?$/;
const ARBITRARY_CLASS_TOKEN = /(?:^|:)\[/;
const SAFE_METADATA_PROPS = new Set(["id", "aria-label", "aria-labelledby", "aria-describedby"]);

const getAttributeExpression = (attribute: EsTreeNodeOfType<"JSXAttribute">): EsTreeNode | null =>
  isNodeOfType(attribute.value, "JSXExpressionContainer")
    ? stripParenExpression(attribute.value.expression)
    : null;

const getNativeAttributes = (
  element: EsTreeNodeOfType<"JSXElement">,
  tag: string,
): Map<string, EsTreeNodeOfType<"JSXAttribute">> | null => {
  const opening = element.openingElement;
  if (!isNodeOfType(opening.name, "JSXIdentifier") || opening.name.name !== tag) return null;
  const attributes = new Map<string, EsTreeNodeOfType<"JSXAttribute">>();
  for (const attribute of opening.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attributes.has(attribute.name.name)
    ) {
      return null;
    }
    attributes.set(attribute.name.name, attribute);
  }
  return attributes;
};

const isExactStringAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined,
  expected: string,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    attribute &&
    getJsxPropStaticStringValues(attribute, scopes)?.every((value) => value === expected),
  );

const hasNoKnownHiddenClassTokens = (className: string): boolean =>
  className
    .split(/\s+/)
    .every((token) => !HIDDEN_CLASS_TOKEN.test(token) && !ARBITRARY_CLASS_TOKEN.test(token));

const hasNoKnownHiddenClasses = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
  openState: SymbolDescriptor,
): boolean => {
  const values = getJsxPropStaticStringValues(attribute, scopes);
  if (values) return values.every(hasNoKnownHiddenClassTokens);
  const expression = getAttributeExpression(attribute);
  if (!isNodeOfType(expression, "TemplateLiteral")) return false;
  if (
    !expression.quasis.every(
      (part) => part.value.cooked !== null && hasNoKnownHiddenClassTokens(part.value.cooked),
    )
  ) {
    return false;
  }
  return expression.expressions.every((part, index) => {
    const conditional = stripParenExpression(part);
    if (
      !isNodeOfType(conditional, "ConditionalExpression") ||
      !isNodeOfType(conditional.test, "Identifier") ||
      scopes.symbolFor(conditional.test) !== openState ||
      !isNodeOfType(conditional.consequent, "Literal") ||
      typeof conditional.consequent.value !== "string"
    ) {
      return false;
    }
    const precedingText = expression.quasis[index]?.value.cooked ?? "";
    const followingText = expression.quasis[index + 1]?.value.cooked ?? "";
    return (
      ((index === 0 && precedingText === "") || /\s$/.test(precedingText)) &&
      ((index === expression.expressions.length - 1 && followingText === "") ||
        /^\s/.test(followingText)) &&
      hasNoKnownHiddenClassTokens(conditional.consequent.value)
    );
  });
};

const getOpenState = (
  handler: EsTreeNodeOfType<"Identifier">,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const symbol = scopes.symbolFor(handler);
  const initializer = symbol && getDirectConstInitializer(symbol);
  if (
    !symbol ||
    findEnclosingFunction(symbol.declarationNode) !== owner ||
    !isNodeOfType(initializer, "CallExpression") ||
    !isReactApiCall(initializer, "useCallback", scopes, { resolveNamedAliases: true })
  ) {
    return null;
  }
  const callback = initializer.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length > 0
  ) {
    return null;
  }
  let call = stripParenExpression(callback.body);
  if (isNodeOfType(call, "BlockStatement")) {
    const statement = call.body[0];
    if (call.body.length !== 1 || !isNodeOfType(statement, "ExpressionStatement")) return null;
    call = stripParenExpression(statement.expression);
  }
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.arguments[0], "Literal") ||
    call.arguments[0].value !== null
  ) {
    return null;
  }
  const pair = resolveReactUseStatePair(call.callee, scopes);
  if (
    !pair ||
    scopes.symbolFor(call.callee) !== pair.setterSymbol ||
    pair.setterSymbol.kind !== "const" ||
    pair.setterSymbol.references.some((reference) => reference.flag !== "read") ||
    findEnclosingFunction(pair.declarator) !== owner ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    !isReactApiCall(pair.declarator.init, "useState", scopes, { resolveNamedAliases: true })
  ) {
    return null;
  }
  return pair.stateSymbol;
};

const isReadOnlyDialogRef = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = getAttributeExpression(attribute);
  const symbol = isNodeOfType(expression, "Identifier") ? scopes.symbolFor(expression) : null;
  const initializer = symbol && getDirectConstInitializer(symbol);
  if (
    !symbol ||
    !isNodeOfType(initializer, "CallExpression") ||
    !isReactApiCall(initializer, "useRef", scopes, { resolveNamedAliases: true })
  ) {
    return false;
  }
  return symbol.references.every(({ identifier, flag }) => {
    if (flag !== "read") return false;
    if (identifier === expression) return true;
    const current = identifier.parent;
    if (
      !isNodeOfType(current, "MemberExpression") ||
      current.object !== identifier ||
      getStaticPropertyName(current) !== "current"
    ) {
      return false;
    }
    const usage = current.parent;
    if (
      isNodeOfType(usage, "LogicalExpression") &&
      usage.operator === "&&" &&
      usage.left === current
    ) {
      return true;
    }
    return (
      isNodeOfType(usage, "MemberExpression") &&
      usage.object === current &&
      getStaticPropertyName(usage) === "contains" &&
      isNodeOfType(usage.parent, "CallExpression") &&
      usage.parent.callee === usage
    );
  });
};

const hasVisibleSourceObstruction = (owner: EsTreeNode): boolean => {
  let hasObstruction = false;
  walkAst(owner, (node) => {
    if (hasObstruction) return false;
    if (
      isNodeOfType(node, "JSXOpeningElement") &&
      isNodeOfType(node.name, "JSXIdentifier") &&
      (node.name.name === "style" || node.name.name === "link")
    ) {
      hasObstruction = true;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      if (
        property === "preventDefault" ||
        property === "stopImmediatePropagation" ||
        property === "stopPropagation" ||
        property === "returnValue" ||
        property === "cancelBubble"
      ) {
        hasObstruction = true;
      }
    }
  });
  return hasObstruction;
};

const hasSafeAttributes = (
  attributes: ReadonlyMap<string, EsTreeNodeOfType<"JSXAttribute">>,
  allowedProps: ReadonlySet<string>,
  scopes: ScopeAnalysis,
  openState: SymbolDescriptor,
): boolean => {
  for (const [name, attribute] of attributes) {
    if (SAFE_METADATA_PROPS.has(name) || allowedProps.has(name)) continue;
    if (name === "className" && hasNoKnownHiddenClasses(attribute, scopes, openState)) continue;
    return false;
  }
  return true;
};

const CLICK_PROP = new Set(["onClick"]);
const BUTTON_PROPS = new Set(["onClick", "type"]);
const DIALOG_PROPS = new Set(["role", "aria-modal", "ref"]);
const OPEN_WRAPPER_PROPS = new Set(["aria-hidden"]);
const NO_EXTRA_PROPS = new Set<string>();

const isReturnedBodyPortal = (
  wrapper: EsTreeNodeOfType<"JSXElement">,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
  openState: SymbolDescriptor,
): boolean => {
  const declaration = wrapper.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier")
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(declaration.id);
  if (!symbol || getDirectConstInitializer(symbol) !== wrapper || symbol.references.length !== 1) {
    return false;
  }
  const reference = symbol.references[0]?.identifier;
  const call = reference?.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    getImportedNameFromModule(call.callee, call.callee.name, "react-dom") !== "createPortal" ||
    scopes.symbolFor(call.callee)?.kind !== "import" ||
    call.arguments.length !== 2 ||
    call.arguments[0] !== reference
  ) {
    return false;
  }
  const target = call.arguments[1];
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    target.optional ||
    !isNodeOfType(target.property, "Identifier") ||
    target.property.name !== "body" ||
    !isNodeOfType(target.object, "Identifier") ||
    target.object.name !== "document" ||
    !scopes.isGlobalReference(target.object)
  ) {
    return false;
  }
  let position = call.parent;
  if (
    isNodeOfType(position, "LogicalExpression") &&
    position.operator === "&&" &&
    position.right === call
  ) {
    position = position.parent;
  }
  if (isNodeOfType(position, "JSXExpressionContainer")) position = position.parent;
  while (isNodeOfType(position, "JSXElement")) {
    const attributes = getNativeAttributes(position, "div");
    if (!attributes || !hasSafeAttributes(attributes, NO_EXTRA_PROPS, scopes, openState))
      return false;
    position = position.parent;
  }
  return isNodeOfType(position, "ReturnStatement") && findEnclosingFunction(position) === owner;
};

const hasCloseButton = (
  dialog: EsTreeNodeOfType<"JSXElement">,
  handler: SymbolDescriptor,
  scopes: ScopeAnalysis,
  openState: SymbolDescriptor,
): boolean => {
  const pending = getStaticDirectJsxElements(dialog);
  for (const child of pending) {
    const buttonAttributes = getNativeAttributes(child, "button");
    if (buttonAttributes) {
      const click = buttonAttributes.get("onClick");
      const type = buttonAttributes.get("type");
      const expression = click && getAttributeExpression(click);
      if (
        isNodeOfType(expression, "Identifier") &&
        scopes.symbolFor(expression) === handler &&
        (!type || isExactStringAttribute(type, "button", scopes)) &&
        hasSafeAttributes(buttonAttributes, BUTTON_PROPS, scopes, openState) &&
        child.children.every((content) => isNodeOfType(content, "JSXText")) &&
        child.children.some((content) => isNodeOfType(content, "JSXText") && content.value.trim())
      ) {
        return true;
      }
    }
    const wrapperAttributes = getNativeAttributes(child, "div");
    if (
      wrapperAttributes &&
      hasSafeAttributes(wrapperAttributes, NO_EXTRA_PROPS, scopes, openState)
    ) {
      for (const descendant of getStaticDirectJsxElements(child)) pending.push(descendant);
    }
  }
  return false;
};

export const hasNativeDialogDismissAlternative = (
  backdropOpening: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const backdrop = backdropOpening.parent;
  if (!isNodeOfType(backdrop, "JSXElement") || !backdropOpening.selfClosing) return false;
  const backdropAttributes = getNativeAttributes(backdrop, "div");
  const click = backdropAttributes?.get("onClick");
  if (!click || !backdropAttributes) return false;
  const wrapper = backdrop.parent;
  const dialog = getNextStaticJsxElementSibling(backdrop);
  if (!isNodeOfType(wrapper, "JSXElement") || !dialog) return false;
  const dialogAttributes = getNativeAttributes(dialog, "div");
  if (
    !dialogAttributes ||
    !isExactStringAttribute(dialogAttributes.get("role"), "dialog", scopes) ||
    !isExactStringAttribute(dialogAttributes.get("aria-modal"), "true", scopes)
  ) {
    return false;
  }
  const dialogRef = dialogAttributes.get("ref");
  if (dialogRef && !isReadOnlyDialogRef(dialogRef, scopes)) return false;
  const wrapperAttributes = getNativeAttributes(wrapper, "div");
  const ariaHidden = wrapperAttributes?.get("aria-hidden");
  const hidden = ariaHidden && getAttributeExpression(ariaHidden);
  if (
    !wrapperAttributes ||
    !isNodeOfType(hidden, "UnaryExpression") ||
    hidden.operator !== "!" ||
    !isNodeOfType(hidden.argument, "Identifier")
  ) {
    return false;
  }
  const handler = getAttributeExpression(click);
  if (!isNodeOfType(handler, "Identifier")) return false;
  const owner = findEnclosingFunction(wrapper);
  const handlerSymbol = scopes.symbolFor(handler);
  const openState = owner && getOpenState(handler, owner, scopes);
  return Boolean(
    owner &&
    handlerSymbol &&
    openState &&
    scopes.symbolFor(hidden.argument) === openState &&
    hasSafeAttributes(backdropAttributes, CLICK_PROP, scopes, openState) &&
    hasSafeAttributes(wrapperAttributes, OPEN_WRAPPER_PROPS, scopes, openState) &&
    hasSafeAttributes(dialogAttributes, DIALOG_PROPS, scopes, openState) &&
    isReturnedBodyPortal(wrapper, owner, scopes, openState) &&
    hasCloseButton(dialog, handlerSymbol, scopes, openState) &&
    !hasVisibleSourceObstruction(owner),
  );
};
