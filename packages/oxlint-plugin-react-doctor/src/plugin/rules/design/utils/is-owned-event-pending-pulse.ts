import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../../utils/component-or-hook-display-name.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { hasCapability } from "../../../utils/get-react-doctor-setting.js";
import { getStaticDirectJsxElements } from "../../../utils/get-static-direct-jsx-elements.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { resolveStaticJsxAttribute } from "../../../utils/resolve-static-jsx-attribute.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const THINKING_STATUS_PATTERN = /^thinking[\s\p{P}\p{S}]*$/iu;
const LOCAL_IMPORT_PATTERN = /^\.{1,2}\//u;
const INTRINSIC_TAG_PATTERN = /^[a-z][a-z0-9]*$/u;
const ARRAY_MAP_UNCERTAIN_MEMBER_NAMES = new Set([
  "Array",
  "prototype",
  "__proto__",
  "constructor",
  "getPrototypeOf",
  "setPrototypeOf",
]);
const ARRAY_MAP_UNCERTAIN_GLOBAL_NAMES = new Set(["Array", "eval", "Function", "Reflect"]);
const arrayMapRiskByProgram = new WeakMap<EsTreeNode, boolean>();

const hasOnlyStaticClass = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  const [attribute, ...otherAttributes] = element.openingElement.attributes;
  return (
    otherAttributes.length === 0 &&
    isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    attribute.name.name === "className" &&
    isNodeOfType(attribute.value, "Literal") &&
    typeof attribute.value.value === "string"
  );
};

const isIntrinsicName = (element: EsTreeNodeOfType<"JSXElement">, name: string): boolean =>
  isNodeOfType(element.openingElement.name, "JSXIdentifier") &&
  element.openingElement.name.name === name;

const getPositiveBranchState = (
  element: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"Identifier"> | null => {
  let branch = element;
  if (isNodeOfType(element.parent, "JSXElement")) {
    const wrapper = element.parent;
    if (
      !isIntrinsicName(wrapper, "div") ||
      !hasOnlyStaticClass(wrapper) ||
      !wrapper.children.every(
        (child) => child === element || (isNodeOfType(child, "JSXText") && !child.value.trim()),
      )
    ) {
      return null;
    }
    branch = wrapper;
  }
  const logical = branch.parent;
  const container = logical?.parent;
  return isNodeOfType(logical, "LogicalExpression") &&
    logical.operator === "&&" &&
    logical.right === branch &&
    isNodeOfType(logical.left, "Identifier") &&
    isNodeOfType(container, "JSXExpressionContainer") &&
    (isNodeOfType(container.parent, "JSXElement") || isNodeOfType(container.parent, "JSXFragment"))
    ? logical.left
    : null;
};

const getRuntimeReferences = (symbol: SymbolDescriptor) =>
  symbol.references.filter((reference) => !isTypeScriptTypePosition(reference.identifier));

const isNativeStatePair = (
  setter: EsTreeNode,
  ownerBody: EsTreeNodeOfType<"BlockStatement">,
  scopes: ScopeAnalysis,
) => {
  const pair = resolveReactUseStatePair(setter, scopes);
  if (!pair || !pair.stateSymbol || !isNodeOfType(pair.declarator.init, "CallExpression")) {
    return null;
  }
  const declaration = pair.declarator.parent;
  const initializer = pair.declarator.init;
  const imported = resolveImportedApiReference(initializer.callee, scopes);
  return isNodeOfType(declaration, "VariableDeclaration") &&
    declaration.kind === "const" &&
    declaration.parent === ownerBody &&
    isNodeOfType(initializer.callee, "Identifier") &&
    !initializer.optional &&
    imported?.source === "react" &&
    imported.importedName === "useState" &&
    !imported.isNamespace &&
    isSymbolReadOnly(pair.setterSymbol) &&
    isSymbolReadOnly(pair.stateSymbol)
    ? pair
    : null;
};

const hasArrayMapMutationRisk = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const program = findProgramRoot(node);
  if (!program) return true;
  const cached = arrayMapRiskByProgram.get(program);
  if (cached !== undefined) return cached;

  let hasRisk = false;
  walkAst(program, (child) => {
    if (hasRisk || isTypeScriptTypePosition(child)) return false;
    if (isNodeOfType(child, "MemberExpression")) {
      const name = getStaticPropertyName(child);
      hasRisk = name === null || ARRAY_MAP_UNCERTAIN_MEMBER_NAMES.has(name);
    } else if (isNodeOfType(child, "Identifier")) {
      hasRisk = ARRAY_MAP_UNCERTAIN_GLOBAL_NAMES.has(child.name) && scopes.isGlobalReference(child);
    } else if (isNodeOfType(child, "WithStatement") || isNodeOfType(child, "ImportExpression")) {
      hasRisk = true;
    }
  });
  arrayMapRiskByProgram.set(program, hasRisk);
  return hasRisk;
};

const isImmediateLiteralArrayMapOwner = (
  nestedOwner: EsTreeNode | null | undefined,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const call = nestedOwner?.parent;
  if (
    !isNodeOfType(nestedOwner, "ArrowFunctionExpression") ||
    nestedOwner.async ||
    !isNodeOfType(nestedOwner.body, "JSXElement") ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== nestedOwner ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    !isNodeOfType(call.callee.property, "Identifier") ||
    call.callee.property.name !== "map" ||
    !isNodeOfType(call.callee.object, "Identifier") ||
    findEnclosingFunction(call) !== owner ||
    hasArrayMapMutationRisk(call, scopes)
  ) {
    return false;
  }
  const receiver = call.callee.object;
  const source = scopes.symbolFor(receiver);
  return Boolean(
    source?.kind === "const" &&
    isSymbolReadOnly(source) &&
    isNodeOfType(source.initializer, "ArrayExpression") &&
    source.initializer.elements.length > 0 &&
    source.initializer.elements.every(
      (entry) => isNodeOfType(entry, "Literal") && typeof entry.value === "string",
    ) &&
    getRuntimeReferences(source).every(({ identifier }) => identifier === receiver),
  );
};

const isReturnedIntrinsicTree = (
  element: EsTreeNodeOfType<"JSXElement">,
  ownerBody: EsTreeNodeOfType<"BlockStatement">,
  literalMapOwner?: EsTreeNode,
): boolean => {
  let current: EsTreeNode = element;
  while (true) {
    const root = findTransparentExpressionRoot(current);
    if (isNodeOfType(root, "JSXElement")) {
      const name = root.openingElement.name;
      if (!isNodeOfType(name, "JSXIdentifier") || !INTRINSIC_TAG_PATTERN.test(name.name)) {
        return false;
      }
    }
    const parent = root.parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return parent.argument === root && parent.parent === ownerBody;
    }
    if (
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      (isNodeOfType(root, "JSXElement") ||
        isNodeOfType(root, "JSXFragment") ||
        isNodeOfType(root, "JSXExpressionContainer"))
    ) {
      current = parent;
    } else if (
      (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === root) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "&&" &&
        parent.right === root) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === root || parent.alternate === root))
    ) {
      current = parent;
    } else if (parent === literalMapOwner && isNodeOfType(parent, "ArrowFunctionExpression")) {
      if (parent.body !== root || !isNodeOfType(parent.parent, "CallExpression")) return false;
      current = parent.parent;
    } else {
      return false;
    }
  }
};

const getEffectiveInteractionLiteral = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  name: string,
  scopes?: ScopeAnalysis,
): boolean | string | number | bigint | null | undefined => {
  const { attribute, expression, isPresent, isUnknown } = resolveStaticJsxAttribute(
    openingElement.attributes,
    name,
  );
  if (isUnknown) return undefined;
  if (!isPresent) return false;
  if (attribute && !attribute.value) return true;
  const value = attribute?.value ?? expression;
  if (!value) return undefined;
  let resolved = stripParenExpression(
    isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value,
  );
  if (scopes && isNodeOfType(resolved, "Identifier")) {
    const symbol = scopes.symbolFor(resolved);
    const initializer = symbol && getDirectConstInitializer(symbol);
    if (
      !symbol ||
      !initializer ||
      !isSymbolReadOnly(symbol) ||
      getNodeStartIndex(symbol.bindingIdentifier) < 0 ||
      getNodeStartIndex(symbol.bindingIdentifier) >= getNodeStartIndex(resolved)
    ) {
      return undefined;
    }
    resolved = stripParenExpression(initializer);
  }
  if (!isNodeOfType(resolved, "Literal")) return undefined;
  const literal = resolved.value;
  return literal === null ||
    typeof literal === "boolean" ||
    typeof literal === "string" ||
    typeof literal === "number" ||
    typeof literal === "bigint"
    ? literal
    : undefined;
};

const getEffectiveDisabledState = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean | null => {
  const value = getEffectiveInteractionLiteral(openingElement, "disabled", scopes);
  return value === undefined ? null : Boolean(value);
};

const hasBlockingFieldsetAncestor = (
  element: EsTreeNodeOfType<"JSXElement">,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let ancestor = element.parent;
  while (ancestor && ancestor !== owner) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isIntrinsicName(ancestor, "fieldset") &&
      getEffectiveDisabledState(ancestor.openingElement, scopes) !== false
    ) {
      if (
        !ancestor.children.every(
          (child) =>
            isNodeOfType(child, "JSXText") ||
            (isNodeOfType(child, "JSXElement") &&
              isNodeOfType(child.openingElement.name, "JSXIdentifier") &&
              INTRINSIC_TAG_PATTERN.test(child.openingElement.name.name)),
        )
      ) {
        return true;
      }
      const firstLegend = getStaticDirectJsxElements(ancestor).find((child) =>
        isIntrinsicName(child, "legend"),
      );
      if (!firstLegend || !isAstDescendant(element, firstLegend)) return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const hasBlockingInertAncestor = (
  element: EsTreeNodeOfType<"JSXElement">,
  owner: EsTreeNode,
): boolean => {
  let current: EsTreeNode | null | undefined = element;
  while (current && current !== owner) {
    if (isNodeOfType(current, "JSXElement")) {
      if (getEffectiveInteractionLiteral(current.openingElement, "inert") === true) return true;
      if (isIntrinsicName(current, "dialog")) return false;
    }
    current = current.parent;
  }
  return false;
};

const isNativeInteractionValue = (
  value: EsTreeNode,
  owner: EsTreeNode,
  ownerBody: EsTreeNodeOfType<"BlockStatement">,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  const container = value.parent;
  const attribute = container?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== value ||
    !isEventHandlerAttribute(attribute) ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    !isNodeOfType(attribute.parent, "JSXOpeningElement") ||
    !isNodeOfType(attribute.parent.name, "JSXIdentifier") ||
    !isNodeOfType(attribute.parent.parent, "JSXElement")
  ) {
    return false;
  }
  const element = attribute.parent.parent;
  if (
    !(
      (attribute.name.name === "onClick" && attribute.parent.name.name === "button") ||
      (attribute.name.name === "onKeyDown" && attribute.parent.name.name === "input")
    )
  ) {
    return false;
  }
  const inputType = isIntrinsicName(element, "input")
    ? getEffectiveInteractionLiteral(attribute.parent, "type")
    : null;
  if (
    getAuthoritativeJsxAttribute(attribute.parent.attributes, attribute.name.name) !== attribute ||
    !isNodeReachableWithinFunction(attribute, context) ||
    getEffectiveDisabledState(attribute.parent, scopes) === true ||
    (typeof inputType === "string" && inputType.toLowerCase() === "hidden") ||
    hasBlockingFieldsetAncestor(element, owner, scopes) ||
    (hasCapability(context.settings, "react:19.2") && hasBlockingInertAncestor(element, owner))
  ) {
    return false;
  }
  const eventOwner = findEnclosingFunction(attribute);
  if (eventOwner === owner) return isReturnedIntrinsicTree(element, ownerBody);
  return Boolean(
    eventOwner &&
    isImmediateLiteralArrayMapOwner(eventOwner, owner, scopes) &&
    isReturnedIntrinsicTree(element, ownerBody, eventOwner),
  );
};

const isClosedNativeInteraction = (
  handler: EsTreeNodeOfType<"ArrowFunctionExpression">,
  owner: EsTreeNode,
  ownerBody: EsTreeNodeOfType<"BlockStatement">,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  const declarator = handler.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== handler ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    declarator.parent.parent !== ownerBody
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(declarator.id);
  if (!symbol || !isSymbolReadOnly(symbol)) return false;
  const references = getRuntimeReferences(symbol);
  return (
    references.length > 0 &&
    references.every(({ identifier, flag }) => {
      if (flag !== "read") return false;
      if (isNativeInteractionValue(identifier, owner, ownerBody, context)) return true;
      const call = identifier.parent;
      if (!isNodeOfType(call, "CallExpression") || call.callee !== identifier || call.optional) {
        return false;
      }
      const callback = findEnclosingFunction(call);
      return (
        isNodeOfType(callback, "ArrowFunctionExpression") &&
        !callback.async &&
        isNativeInteractionValue(callback, owner, ownerBody, context)
      );
    })
  );
};

const getLiteralSetterCall = (statement: EsTreeNode | undefined) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const call = statement.expression;
  return isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    isNodeOfType(call.callee, "Identifier") &&
    call.arguments.length === 1 &&
    isNodeOfType(call.arguments[0], "Literal")
    ? { callee: call.callee, value: call.arguments[0].value }
    : null;
};

const isBusyExit = (
  statement: EsTreeNode | undefined,
  state: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(statement, "IfStatement") ||
    statement.alternate ||
    !isNodeOfType(statement.consequent, "ReturnStatement") ||
    statement.consequent.argument
  ) {
    return false;
  }
  const test = statement.test;
  const checks =
    isNodeOfType(test, "LogicalExpression") && test.operator === "||"
      ? [test.left, test.right]
      : [test];
  return checks.some(
    (check) => isNodeOfType(check, "Identifier") && scopes.symbolFor(check) === state,
  );
};

const hasDirectAwaitedLocalCall = (
  statement: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = isNodeOfType(statement, "ExpressionStatement")
    ? statement.expression
    : isNodeOfType(statement, "VariableDeclaration") &&
        statement.kind === "const" &&
        statement.declarations.length === 1 &&
        isNodeOfType(statement.declarations[0]?.id, "Identifier")
      ? statement.declarations[0].init
      : null;
  if (!isNodeOfType(expression, "AwaitExpression")) return false;
  const call = expression.argument;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(call.callee);
  const imported = resolveImportedApiReference(call.callee, scopes);
  return Boolean(
    symbol?.kind === "import" &&
    isSymbolReadOnly(symbol) &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    imported &&
    !imported.isNamespace &&
    LOCAL_IMPORT_PATTERN.test(imported.source),
  );
};

export const isOwnedEventPendingPulse = (
  element: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  const [text, ...otherChildren] = element.children;
  if (
    (!isIntrinsicName(element, "div") && !isIntrinsicName(element, "span")) ||
    !hasOnlyStaticClass(element) ||
    otherChildren.length > 0 ||
    !isNodeOfType(text, "JSXText") ||
    !THINKING_STATUS_PATTERN.test(text.value.trim())
  ) {
    return false;
  }
  const gate = getPositiveBranchState(element);
  const owner = findEnclosingFunction(element);
  if (
    !gate ||
    (!isNodeOfType(owner, "FunctionDeclaration") &&
      !isNodeOfType(owner, "FunctionExpression") &&
      !isNodeOfType(owner, "ArrowFunctionExpression")) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    !componentOrHookDisplayNameForFunction(owner) ||
    !isReturnedIntrinsicTree(element, owner.body)
  ) {
    return false;
  }
  const state = scopes.symbolFor(gate);
  const declarator = state?.declarationNode;
  if (
    !state ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== 2 ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    declarator.init.arguments.length !== 1 ||
    !isNodeOfType(declarator.init.arguments[0], "Literal") ||
    declarator.init.arguments[0].value !== false ||
    !isNodeOfType(declarator.id.elements[1], "Identifier")
  ) {
    return false;
  }
  const pair = isNativeStatePair(declarator.id.elements[1], owner.body, scopes);
  if (!pair || pair.stateSymbol !== state) return false;
  const references = getRuntimeReferences(pair.setterSymbol);
  if (references.length !== 2 || references.some(({ flag }) => flag !== "read")) return false;

  const startReference = references.find(({ identifier }) => {
    const call = getLiteralSetterCall(identifier.parent?.parent ?? undefined);
    return Boolean(call && call.callee === identifier && call.value === true);
  });
  if (!startReference) return false;
  const startStatement = startReference.identifier.parent?.parent;
  const handler = findEnclosingFunction(startReference.identifier);
  if (
    !isNodeOfType(startStatement, "ExpressionStatement") ||
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    !handler.async ||
    !isNodeOfType(handler.body, "BlockStatement") ||
    !isClosedNativeInteraction(handler, owner, owner.body, context) ||
    !isBusyExit(handler.body.body[0], state, scopes)
  ) {
    return false;
  }
  const startIndex = handler.body.body.findIndex((statement) => statement === startStatement);
  if (startIndex < 1) return false;
  const next = handler.body.body[startIndex + 1];
  const nearbySetter = getLiteralSetterCall(next);
  const secondPair = nearbySetter && isNativeStatePair(nearbySetter.callee, owner.body, scopes);
  const work =
    secondPair && secondPair.setterSymbol !== pair.setterSymbol
      ? handler.body.body[startIndex + 2]
      : next;
  if (
    !isNodeOfType(work, "TryStatement") ||
    work !== handler.body.body.at(-1) ||
    !hasDirectAwaitedLocalCall(work.block.body[0], scopes) ||
    !work.finalizer ||
    work.finalizer.body.length !== 1
  ) {
    return false;
  }
  const release = getLiteralSetterCall(work.finalizer.body[0]);
  return Boolean(
    release?.value === false && references.some(({ identifier }) => identifier === release.callee),
  );
};
