import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticTemplateLiteralValue } from "./get-static-template-literal-value.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { hasUnsupportedProtocolAccess } from "./is-react-prop-regexp-text-leaf.js";
import { STATELESS_HTML_LEAF_TAGS } from "./jsx-stateless-leaf.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface TextPlaceholderInput {
  iteratorCall: EsTreeNodeOfType<"CallExpression">;
  jsxElement: EsTreeNodeOfType<"JSXElement">;
  keyAttribute: EsTreeNodeOfType<"JSXAttribute">;
  scopes: ScopeAnalysis;
}

const EMPTY_PRIMITIVE_BINDINGS: ReadonlySet<SymbolDescriptor> = new Set();

const getStaticString = (node: EsTreeNode): string | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return expression.value;
  }
  return isNodeOfType(expression, "TemplateLiteral")
    ? getStaticTemplateLiteralValue(expression)
    : null;
};

const isPrimitiveLiteral = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") &&
    (node.value === null ||
      ["string", "boolean", "number", "bigint"].includes(typeof node.value))) ||
  (isNodeOfType(node, "TemplateLiteral") && getStaticTemplateLiteralValue(node) !== null);

const isRuntimeGuardedString = (
  node: EsTreeNodeOfType<"ConditionalExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const test = stripParenExpression(node.test);
  if (!isNodeOfType(test, "BinaryExpression") || test.operator !== "===") return false;
  const checked = stripParenExpression(test.left);
  if (
    !isNodeOfType(checked, "UnaryExpression") ||
    checked.operator !== "typeof" ||
    getStaticString(test.right) !== "string"
  ) {
    return false;
  }
  const identifier = stripParenExpression(checked.argument);
  const returned = stripParenExpression(node.consequent);
  if (!isNodeOfType(identifier, "Identifier") || !isNodeOfType(returned, "Identifier")) {
    return false;
  }
  const binding = scopes.symbolFor(identifier);
  return binding !== null && scopes.symbolFor(returned) === binding;
};

const isPrimitiveValue = (
  initialValue: EsTreeNode,
  scopes: ScopeAnalysis,
  primitiveBindings = EMPTY_PRIMITIVE_BINDINGS,
): boolean => {
  const pending = [initialValue];
  const examined = new WeakSet<EsTreeNode>();
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) return false;
    const value = stripParenExpression(next);
    if (examined.has(value)) continue;
    examined.add(value);
    if (isPrimitiveLiteral(value)) continue;
    if (isNodeOfType(value, "LogicalExpression") && value.operator === "??") {
      pending.push(value.left, value.right);
      continue;
    }
    if (isNodeOfType(value, "ConditionalExpression") && isRuntimeGuardedString(value, scopes)) {
      pending.push(value.alternate);
      continue;
    }
    if (!isNodeOfType(value, "Identifier")) return false;
    const binding = scopes.symbolFor(value);
    if (binding && primitiveBindings.has(binding)) continue;
    const initializer = binding ? getDirectConstInitializer(binding) : null;
    if (!initializer || getNodeStartIndex(initializer) >= getNodeStartIndex(value)) return false;
    pending.push(initializer);
  }
  return true;
};

const isPrimitiveChild = (
  child: EsTreeNode,
  scopes: ScopeAnalysis,
  bindings = EMPTY_PRIMITIVE_BINDINGS,
): boolean =>
  isNodeOfType(child, "JSXText") ||
  (isNodeOfType(child, "JSXExpressionContainer") &&
    (isNodeOfType(child.expression, "JSXEmptyExpression") ||
      isPrimitiveValue(child.expression, scopes, bindings)));

const isNativeTextLeaf = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
  scopes: ScopeAnalysis,
  bindings: ReadonlySet<SymbolDescriptor>,
  allowedKey?: EsTreeNode,
): boolean => {
  const opening = jsxElement.openingElement;
  if (
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !STATELESS_HTML_LEAF_TAGS.has(opening.name.name)
  ) {
    return false;
  }
  return (
    opening.attributes.every((attribute) => {
      if (!isNodeOfType(attribute, "JSXAttribute")) return false;
      const name = getJsxAttributeName(attribute.name);
      if (name === "key") return attribute === allowedKey;
      const value = attribute.value;
      if (!isNodeOfType(value, "JSXExpressionContainer")) {
        return Boolean(
          value &&
          (name === "className" || name === "title" || name?.startsWith("data-")) &&
          isPrimitiveLiteral(value),
        );
      }
      if (name === "style") {
        const style = stripParenExpression(value.expression);
        return (
          isNodeOfType(style, "ObjectExpression") &&
          style.properties.every(
            (property) =>
              isNodeOfType(property, "Property") &&
              property.kind === "init" &&
              !property.computed &&
              !property.method &&
              getStaticPropertyKeyName(property) !== "__proto__" &&
              isPrimitiveValue(property.value, scopes, bindings),
          )
        );
      }
      return (
        (name === "className" || name === "title" || name?.startsWith("data-") === true) &&
        isPrimitiveValue(value.expression, scopes, bindings)
      );
    }) && jsxElement.children.every((child) => isPrimitiveChild(child, scopes, bindings))
  );
};

const isTextPlaceholderLeaf = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
  scopes: ScopeAnalysis,
  keyAttribute: EsTreeNode,
): boolean => {
  if (isNativeTextLeaf(jsxElement, scopes, EMPTY_PRIMITIVE_BINDINGS, keyAttribute)) return true;
  const opening = jsxElement.openingElement;
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
  const symbol = scopes.symbolFor(opening.name);
  if (
    !symbol ||
    symbol.references.some(
      ({ identifier, flag }) =>
        flag !== "read" ||
        (!isNodeOfType(identifier.parent, "JSXOpeningElement") &&
          !isNodeOfType(identifier.parent, "JSXClosingElement")) ||
        identifier.parent.name !== identifier,
    )
  ) {
    return false;
  }
  const declaration =
    symbol.kind === "function" ? symbol.declarationNode : getDirectConstInitializer(symbol);
  if (!declaration) return false;
  const wrapper = stripParenExpression(declaration);
  if (
    !isFunctionLike(wrapper) ||
    wrapper.async ||
    wrapper.generator ||
    wrapper.params.length !== 1
  ) {
    return false;
  }
  const pattern = wrapper.params[0];
  const returned = getSingleReturnExpression(wrapper);
  if (!isNodeOfType(pattern, "ObjectPattern") || !returned) return false;
  const rendered = stripParenExpression(returned);
  if (!isNodeOfType(rendered, "JSXElement")) return false;

  const supplied = new Set(["children"]);
  if (!jsxElement.children.every((child) => isPrimitiveChild(child, scopes))) return false;
  for (const attribute of opening.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    if (name === "key") continue;
    if (!name || name === "ref" || name === "is" || supplied.has(name)) return false;
    const value = attribute.value;
    if (
      value &&
      !isPrimitiveValue(
        isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value,
        scopes,
      )
    ) {
      return false;
    }
    supplied.add(name);
  }

  const bindings = new Set<SymbolDescriptor>();
  for (const property of pattern.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.value, "Identifier")
    ) {
      return false;
    }
    const name = getStaticPropertyKeyName(property);
    const binding = scopes.symbolFor(property.value);
    if (!name || !supplied.has(name) || !binding) return false;
    bindings.add(binding);
  }
  return isNativeTextLeaf(rendered, scopes, bindings);
};

const getMethodCall = (
  expression: EsTreeNode,
  name: string,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  return isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    !callee.computed &&
    getStaticPropertyName(callee) === name
    ? call
    : null;
};

interface NativeMathCall {
  call: EsTreeNodeOfType<"CallExpression">;
  receiver: EsTreeNodeOfType<"Identifier">;
}

const getNativeMathCall = (
  call: EsTreeNode,
  name: string,
  argumentCount: number,
  scopes: ScopeAnalysis,
): NativeMathCall | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== argumentCount ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    getStaticPropertyName(call.callee) !== name
  ) {
    return null;
  }
  const receiver = stripParenExpression(call.callee.object);
  return isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Math" &&
    scopes.isGlobalReference(receiver)
    ? { call, receiver }
    : null;
};

const isClosedTemplateTableRead = (
  selection: EsTreeNodeOfType<"MemberExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!selection.computed || selection.optional || !isNodeOfType(selection.object, "Identifier")) {
    return false;
  }
  const tableIdentifier = selection.object;
  const table = scopes.symbolFor(tableIdentifier);
  const initializer = table ? getDirectConstInitializer(table) : null;
  const array = initializer ? stripParenExpression(initializer) : null;
  if (
    !table ||
    !isNodeOfType(array, "ArrayExpression") ||
    !array.elements.length ||
    !array.elements.every((element) => element !== null && getStaticString(element) !== null) ||
    isNodeOfType(table.declarationNode.parent?.parent, "ExportNamedDeclaration")
  ) {
    return false;
  }
  const index = getNativeMathCall(stripParenExpression(selection.property), "floor", 1, scopes);
  if (!index) return false;
  const product = stripParenExpression(index.call.arguments[0]);
  if (!isNodeOfType(product, "BinaryExpression") || product.operator !== "*") return false;
  const random = getNativeMathCall(stripParenExpression(product.left), "random", 0, scopes);
  const length = stripParenExpression(product.right);
  if (
    !random ||
    !isNodeOfType(length, "MemberExpression") ||
    length.optional ||
    length.computed ||
    getStaticPropertyName(length) !== "length" ||
    !isNodeOfType(length.object, "Identifier") ||
    scopes.symbolFor(length.object) !== table ||
    !table.references.every(
      ({ identifier, flag }) =>
        flag === "read" && (identifier === selection.object || identifier === length.object),
    )
  ) {
    return false;
  }
  let hasUnprovenTableOrMathAccess = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasUnprovenTableOrMathAccess) return false;
    if (
      isNodeOfType(node, "ExportSpecifier") &&
      isNodeOfType(node.local, "Identifier") &&
      node.local.name === tableIdentifier.name
    ) {
      hasUnprovenTableOrMathAccess = true;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "Math" &&
      scopes.isGlobalReference(node) &&
      node !== index.receiver &&
      node !== random.receiver
    ) {
      hasUnprovenTableOrMathAccess = true;
    }
  });
  return !hasUnprovenTableOrMathAccess;
};

const getTerminalSlice = (
  iteratorCall: EsTreeNodeOfType<"CallExpression">,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const iterator = findTransparentExpressionRoot(iteratorCall);
  const member = iterator.parent;
  if (!isNodeOfType(member, "MemberExpression") || member.object !== iterator) return null;
  const expression = findTransparentExpressionRoot(member);
  const parent = expression.parent;
  if (!isNodeOfType(parent, "CallExpression") || parent.callee !== expression) return null;
  const slice = getMethodCall(parent, "slice");
  if (!slice || slice.arguments.length !== 2) return null;
  const start = stripParenExpression(slice.arguments[0]);
  const end = stripParenExpression(slice.arguments[1]);
  return isNodeOfType(start, "Literal") &&
    start.value === 0 &&
    isNodeOfType(end, "UnaryExpression") &&
    end.operator === "-" &&
    isNodeOfType(end.argument, "Literal") &&
    end.argument.value === 1
    ? slice
    : null;
};

export const isClosedLiteralTextPlaceholder = ({
  iteratorCall,
  jsxElement,
  keyAttribute,
  scopes,
}: TextPlaceholderInput): boolean => {
  const callee = stripParenExpression(iteratorCall.callee);
  if (
    !getMethodCall(iteratorCall, "flatMap") ||
    !isNodeOfType(callee, "MemberExpression") ||
    iteratorCall.arguments.length !== 1
  ) {
    return false;
  }
  const callback = stripParenExpression(iteratorCall.arguments[0]);
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 2
  ) {
    return false;
  }
  const [textParameter, indexParameter] = callback.params;
  const returned = getSingleReturnExpression(callback);
  if (
    !isNodeOfType(textParameter, "Identifier") ||
    !isNodeOfType(indexParameter, "Identifier") ||
    !returned
  ) {
    return false;
  }
  const pair = stripParenExpression(returned);
  if (!isNodeOfType(pair, "ArrayExpression") || pair.elements.length !== 2) return false;
  const [prefix, placeholder] = pair.elements;
  const key = keyAttribute.value;
  if (
    !prefix ||
    !placeholder ||
    stripParenExpression(placeholder) !== jsxElement ||
    !isNodeOfType(key, "JSXExpressionContainer")
  ) {
    return false;
  }
  const text = stripParenExpression(prefix);
  const index = stripParenExpression(key.expression);
  const textBinding = scopes.symbolFor(textParameter);
  const indexBinding = scopes.symbolFor(indexParameter);
  if (
    !isNodeOfType(text, "Identifier") ||
    !textBinding ||
    scopes.symbolFor(text) !== textBinding ||
    textBinding.references.some(({ identifier, flag }) => identifier !== text || flag !== "read") ||
    !isNodeOfType(index, "Identifier") ||
    !indexBinding ||
    scopes.symbolFor(index) !== indexBinding ||
    indexBinding.references.some(
      ({ identifier, flag }) => identifier !== index || flag !== "read",
    ) ||
    jsxElement.openingElement.attributes.filter(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") && getJsxAttributeName(attribute.name) === "key",
    ).length !== 1
  ) {
    return false;
  }

  const slice = getTerminalSlice(iteratorCall);
  const split = getMethodCall(callee.object, "split");
  const owner = findEnclosingFunction(iteratorCall);
  const program = scopes.rootScope.node;
  if (
    !slice ||
    !split ||
    split.arguments.length !== 1 ||
    !isNodeOfType(program, "Program") ||
    program.sourceType !== "module" ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator
  ) {
    return false;
  }
  const splitMember = stripParenExpression(split.callee);
  if (!isNodeOfType(splitMember, "MemberExpression")) return false;
  if (getStaticString(split.arguments[0]) === null) return false;

  const sourceAliases = new WeakSet<EsTreeNode>();
  let source = stripParenExpression(splitMember.object);
  while (isNodeOfType(source, "Identifier")) {
    const symbol = scopes.symbolFor(source);
    const initializer = symbol ? getDirectConstInitializer(symbol) : null;
    if (!initializer || getNodeStartIndex(initializer) >= getNodeStartIndex(source)) return false;
    sourceAliases.add(initializer);
    source = stripParenExpression(initializer);
  }
  const literal = getStaticString(source);
  const selection = isNodeOfType(source, "MemberExpression") ? source : undefined;
  if (selection ? !isClosedTemplateTableRead(selection, scopes) : literal === null) {
    return false;
  }
  const result = findTransparentExpressionRoot(slice);
  if (isNodeOfType(owner.body, "BlockStatement")) {
    const last = owner.body.body.at(-1);
    if (!isNodeOfType(last, "ReturnStatement") || last.argument !== result) return false;
    if (
      !owner.body.body
        .slice(0, -1)
        .every(
          (statement) =>
            isNodeOfType(statement, "VariableDeclaration") &&
            statement.kind === "const" &&
            statement.declarations.every(
              ({ id, init }) =>
                isNodeOfType(id, "Identifier") &&
                init !== null &&
                (sourceAliases.has(init) || isPrimitiveValue(init, scopes)),
            ),
        )
    )
      return false;
  } else if (owner.body !== result) {
    return false;
  }
  return (
    !hasUnsupportedProtocolAccess(scopes, { allowedTableLookup: selection }) &&
    isTextPlaceholderLeaf(jsxElement, scopes, keyAttribute)
  );
};
