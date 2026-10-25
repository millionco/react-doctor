import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { HTML_TAGS } from "../constants/html-tags.js";
import { IMPORTED_CLASS_REFUSED_MEMBER_NAMES } from "../constants/react.js";
import {
  COMBOBOX_CSS_MODULE_SOURCE_PATTERN,
  COMBOBOX_OPEN_KEY_NAMES,
  COMBOBOX_PROTECTED_ATTRIBUTE_NAMES,
  COMBOBOX_REFUSED_GLOBAL_NAMES,
  COMBOBOX_WINDOW_VALUE_NAMES,
} from "./constants.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getCallbackStatements } from "./get-callback-statements.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getLocalComboboxCallback } from "./get-local-combobox-callback.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { hasOrdinaryNativeTimerProviders } from "./has-ordinary-native-timer-providers.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isFunctionLike } from "./is-function-like.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { resolveComboboxOpenDispatcher } from "./resolve-combobox-open-dispatcher.js";
import { resolveNativeComboboxDismissal } from "./resolve-native-combobox-dismissal.js";
import { resolveStaticJsxAttribute } from "./resolve-static-jsx-attribute.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const valueAttribute = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  name: string,
): EsTreeNode | null => {
  const resolution = resolveStaticJsxAttribute(opening.attributes, name);
  if (resolution.isUnknown || !resolution.attribute?.value) return null;
  const value = resolution.attribute.value;
  return stripParenExpression(
    isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value,
  );
};

const cleanAttributes = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const seen = new Set<string>();
  return opening.attributes.every((attribute) => {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return !COMBOBOX_PROTECTED_ATTRIBUTE_NAMES.has(name);
  });
};

const symbolMatches = (
  node: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const identifier = stripParenExpression(node);
  return isNodeOfType(identifier, "Identifier") && scopes.symbolFor(identifier) === symbol;
};

const emptyReturn = (node: EsTreeNode): boolean => {
  const statement =
    isNodeOfType(node, "BlockStatement") && node.body.length === 1 ? node.body[0] : node;
  return isNodeOfType(statement, "ReturnStatement") && !statement.argument;
};

const directRootReturn = (element: EsTreeNode, owner: EsTreeNode): boolean => {
  if (!isFunctionLike(owner)) return false;
  const root = findTransparentExpressionRoot(element);
  if (isNodeOfType(owner, "ArrowFunctionExpression") && owner.body === root) return true;
  const statement = root.parent;
  if (
    !isNodeOfType(statement, "ReturnStatement") ||
    statement.argument !== root ||
    !isNodeOfType(statement.parent, "BlockStatement") ||
    statement.parent !== owner.body
  )
    return false;
  let valid = true;
  walkAst(owner.body, (node) => {
    if (node !== owner.body && isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "ThrowStatement") ||
      (isNodeOfType(node, "ReturnStatement") && node !== statement)
    )
      valid = false;
  });
  return valid;
};

const hasNativeRef = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  required: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = valueAttribute(opening, "ref");
  if (!expression)
    return (
      !required &&
      !opening.attributes.some(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") && getJsxAttributeName(attribute.name) === "ref",
      )
    );
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  const initializer = symbol?.initializer && stripParenExpression(symbol.initializer);
  if (
    symbol?.kind !== "const" ||
    !initializer ||
    hasSymbolBindingWrites(symbol) ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length !== 1 ||
    !isProvenUnmodifiedReactApiCall(initializer, "useRef", scopes) ||
    findEnclosingFunction(initializer) !== findEnclosingFunction(opening)
  )
    return false;
  const initial = initializer.arguments[0];
  if (!initial || !isNodeOfType(stripParenExpression(initial), "Literal")) return false;
  const initialValue = stripParenExpression(initial);
  if (!isNodeOfType(initialValue, "Literal") || initialValue.value !== null) return false;
  const allowed = new Set<EsTreeNode>();
  for (const reference of symbol.references) {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const member = identifier.parent;
    if (reference.identifier === expression) {
      allowed.add(reference.identifier);
      continue;
    }
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.optional ||
      member.computed ||
      getStaticPropertyName(member) !== "current" ||
      isMemberMutationTarget(member)
    )
      return false;
    const current = findTransparentExpressionRoot(member);
    const method = current.parent;
    if (
      isNodeOfType(method, "LogicalExpression") &&
      (method.left === current || method.right === current)
    ) {
      let terminal: EsTreeNode = method;
      while (isNodeOfType(terminal.parent, "LogicalExpression")) terminal = terminal.parent;
      if (!isNodeOfType(terminal.parent, "IfStatement") || terminal.parent.test !== terminal)
        return false;
      allowed.add(reference.identifier);
      continue;
    }
    if (
      !isNodeOfType(method, "MemberExpression") ||
      method.object !== current ||
      method.computed ||
      isMemberMutationTarget(method)
    )
      return false;
    const name = getStaticPropertyName(method);
    if (required ? name !== "focus" : name !== "contains" && name !== "getBoundingClientRect")
      return false;
    const callRoot = findTransparentExpressionRoot(method);
    const call = callRoot.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== callRoot ||
      call.arguments.length !== (name === "contains" ? 1 : 0)
    )
      return false;
    allowed.add(reference.identifier);
  }
  return hasOnlyAllowedSymbolReads({
    symbol,
    allowedIdentifiers: allowed,
    program: scopes.rootScope.node,
    scopes,
  });
};

const nativeEnvironment = (scopes: ScopeAnalysis): boolean => {
  if (!hasOrdinaryNativeTimerProviders({ program: scopes.rootScope.node, scopes })) return false;
  if (
    ["useState", "useRef", "useCallback", "useEffect", "createElement"].some((name) =>
      hasReactDefaultProviderMutation(name, scopes),
    )
  )
    return false;
  let valid = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!valid) return false;
    if (isNodeOfType(node, "ImportDeclaration") && node.importKind !== "type") {
      const source = node.source.value;
      if (
        source !== "react" &&
        !(typeof source === "string" && COMBOBOX_CSS_MODULE_SOURCE_PATTERN.test(source))
      )
        valid = false;
    }
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      ((isNodeOfType(node, "ExportNamedDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration")) &&
        node.source) ||
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "Super") ||
      isNodeOfType(node, "MetaProperty")
    )
      valid = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, scopes, {
        stringifyNonStringLiterals: true,
      });
      if (name !== null && IMPORTED_CLASS_REFUSED_MEMBER_NAMES.has(name)) valid = false;
      if (name === null) {
        const object = stripParenExpression(node.object);
        const symbol = isNodeOfType(object, "Identifier") ? scopes.symbolFor(object) : null;
        const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
        const source = declaration?.source.value;
        if (
          !symbol ||
          typeof source !== "string" ||
          !COMBOBOX_CSS_MODULE_SOURCE_PATTERN.test(source) ||
          isMemberMutationTarget(node) ||
          hasSymbolBindingWrites(symbol)
        )
          valid = false;
      }
      if (name === "addEventListener" || name === "removeEventListener") {
        const root = findTransparentExpressionRoot(node);
        const call = root.parent;
        if (
          isMemberMutationTarget(node) ||
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== root ||
          call.optional ||
          node.optional
        )
          valid = false;
        if (
          (name === "addEventListener" || name === "removeEventListener") &&
          isNodeOfType(call, "CallExpression")
        ) {
          const event = call.arguments[0] && stripParenExpression(call.arguments[0]);
          if (
            !isNodeOfType(event, "Literal") ||
            typeof event.value !== "string" ||
            event.value.startsWith("key")
          )
            valid = false;
        }
      }
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (node.name === "React" && scopes.isGlobalReference(node)) {
      valid = false;
      return;
    }
    if (COMBOBOX_REFUSED_GLOBAL_NAMES.has(node.name)) {
      valid = false;
      return;
    }
    if (node.name !== "window" && node.name !== "document") return;
    if (!scopes.isGlobalReference(node)) {
      valid = false;
      return;
    }
    const root = findTransparentExpressionRoot(node);
    const member = root.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      member.optional ||
      isMemberMutationTarget(member)
    ) {
      valid = false;
      return;
    }
    const name = getResolvedStaticPropertyName(member, scopes);
    if (
      !name ||
      (node.name === "window"
        ? !COMBOBOX_WINDOW_VALUE_NAMES.has(name)
        : name !== "addEventListener" && name !== "removeEventListener")
    )
      valid = false;
  });
  return valid;
};

const eventMethod = (
  statement: EsTreeNode,
  event: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const call = stripParenExpression(statement.expression);
  return (
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.arguments.length === 0 &&
    isNodeOfType(call.callee, "MemberExpression") &&
    !call.callee.optional &&
    !call.callee.computed &&
    getStaticPropertyName(call.callee) === "preventDefault" &&
    symbolMatches(call.callee.object, event, scopes)
  );
};

const keyCondition = (
  expression: EsTreeNode,
  key: SymbolDescriptor,
  expected: ReadonlySet<string>,
  found: Set<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "LogicalExpression") && value.operator === "||") {
    return (
      keyCondition(value.left, key, expected, found, scopes) &&
      keyCondition(value.right, key, expected, found, scopes)
    );
  }
  if (
    !isNodeOfType(value, "BinaryExpression") ||
    value.operator !== "===" ||
    !symbolMatches(value.left, key, scopes)
  )
    return false;
  const literal = stripParenExpression(value.right);
  if (
    !isNodeOfType(literal, "Literal") ||
    typeof literal.value !== "string" ||
    !expected.has(literal.value)
  )
    return false;
  found.add(literal.value);
  return true;
};

export const hasDelegatedNativeComboboxCommands = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const scopes = context.scopes;
  const sourceText = context.sourceCode?.getText?.();
  if (
    typeof sourceText !== "string" ||
    hasJsxRuntimePragma({
      program: scopes.rootScope.node,
      filename: context.filename ?? "component.tsx",
      sourceText,
    })
  )
    return false;
  const element = opening.parent;
  const parent = isNodeOfType(element, "JSXElement") ? element.parent : null;
  if (
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !HTML_TAGS.has(opening.name.name) ||
    !isNodeOfType(element, "JSXElement") ||
    !isNodeOfType(parent, "JSXElement") ||
    !isNodeOfType(parent.openingElement.name, "JSXIdentifier") ||
    !HTML_TAGS.has(parent.openingElement.name.name) ||
    !cleanAttributes(opening) ||
    !cleanAttributes(parent.openingElement) ||
    opening.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        getJsxAttributeName(attribute.name) === "onKeyDown",
    )
  )
    return false;
  const owner = findEnclosingFunction(element);
  if (!owner || findEnclosingFunction(parent) !== owner || !directRootReturn(parent, owner))
    return false;
  const role = valueAttribute(opening, "role");
  const popup = valueAttribute(opening, "aria-haspopup");
  if (
    !isNodeOfType(role, "Literal") ||
    role.value !== "combobox" ||
    !isNodeOfType(popup, "Literal") ||
    popup.value !== "dialog" ||
    !hasNativeRef(opening, true, scopes) ||
    !hasNativeRef(parent.openingElement, false, scopes)
  )
    return false;
  const phase = valueAttribute(opening, "aria-expanded");
  const tabIndex = valueAttribute(opening, "tabIndex");
  const clickExpression = valueAttribute(opening, "onClick");
  const handlerExpression = valueAttribute(parent.openingElement, "onKeyDown");
  if (
    !phase ||
    !isNodeOfType(tabIndex, "ConditionalExpression") ||
    !clickExpression ||
    !handlerExpression
  )
    return false;
  const tabCondition = stripParenExpression(tabIndex.test);
  if (!isNodeOfType(tabCondition, "Identifier")) return false;
  const disabled = scopes.symbolFor(tabCondition);
  const inactive = stripParenExpression(tabIndex.consequent);
  const active = stripParenExpression(tabIndex.alternate);
  if (
    !disabled ||
    disabled.kind !== "parameter" ||
    hasSymbolBindingWrites(disabled) ||
    !isNodeOfType(inactive, "UnaryExpression") ||
    inactive.operator !== "-" ||
    !isNodeOfType(inactive.argument, "Literal") ||
    inactive.argument.value !== 1 ||
    !isNodeOfType(active, "Literal") ||
    active.value !== 0 ||
    findEnclosingFunction(disabled.bindingIdentifier) !== owner
  )
    return false;
  const ariaDisabled = resolveStaticJsxAttribute(opening.attributes, "aria-disabled");
  if (ariaDisabled.isPresent) {
    const expression = valueAttribute(opening, "aria-disabled");
    if (
      !isNodeOfType(expression, "LogicalExpression") ||
      expression.operator !== "||" ||
      !symbolMatches(expression.left, disabled, scopes)
    )
      return false;
    const fallback = stripParenExpression(expression.right);
    if (
      !isNodeOfType(fallback, "Identifier") ||
      fallback.name !== "undefined" ||
      !scopes.isGlobalReference(fallback)
    )
      return false;
  }
  const click = stripParenExpression(clickExpression);
  if (
    (!isNodeOfType(click, "ArrowFunctionExpression") &&
      !isNodeOfType(click, "FunctionExpression")) ||
    click.async ||
    click.generator ||
    click.params.length !== 0
  )
    return false;
  const clickStatements = getCallbackStatements(click);
  let body = stripParenExpression(click.body);
  if (isNodeOfType(body, "BlockStatement")) {
    if (clickStatements.length !== 1) return false;
    const statement = clickStatements[0];
    if (!isNodeOfType(statement, "ReturnStatement") || !statement.argument) return false;
    body = stripParenExpression(statement.argument);
  }
  if (!isNodeOfType(body, "LogicalExpression") || body.operator !== "&&") return false;
  const prefix = stripParenExpression(body.left);
  const dispatch = stripParenExpression(body.right);
  if (
    !isNodeOfType(prefix, "LogicalExpression") ||
    prefix.operator !== "&&" ||
    !isNodeOfType(dispatch, "CallExpression") ||
    dispatch.optional ||
    dispatch.arguments.length !== 1
  )
    return false;
  const disabledTest = stripParenExpression(prefix.left);
  const closingTest = stripParenExpression(prefix.right);
  const toggled = dispatch.arguments[0] && stripParenExpression(dispatch.arguments[0]);
  if (
    !isNodeOfType(disabledTest, "UnaryExpression") ||
    disabledTest.operator !== "!" ||
    !symbolMatches(disabledTest.argument, disabled, scopes) ||
    !isNodeOfType(closingTest, "UnaryExpression") ||
    closingTest.operator !== "!" ||
    !isNodeOfType(toggled, "UnaryExpression") ||
    toggled.operator !== "!"
  )
    return false;
  const dispatcher = resolveComboboxOpenDispatcher(dispatch.callee, phase, owner, scopes);
  if (!dispatcher || !symbolMatches(toggled.argument, dispatcher.phase, scopes)) return false;
  const handler = getLocalComboboxCallback(handlerExpression, scopes);
  if (
    !handler ||
    handler.wrapper ||
    handler.node.params.length !== 1 ||
    handler.statements.length !== 4
  )
    return false;
  const eventParameter = handler.node.params[0];
  const event = isNodeOfType(eventParameter, "Identifier")
    ? scopes.symbolFor(eventParameter)
    : null;
  const [disabledGuard, keyDeclaration, closedBranch, openBranch] = handler.statements;
  if (
    !event ||
    !disabledGuard ||
    !keyDeclaration ||
    !closedBranch ||
    !openBranch ||
    !isNodeOfType(disabledGuard, "IfStatement") ||
    disabledGuard.alternate ||
    !symbolMatches(disabledGuard.test, disabled, scopes) ||
    !emptyReturn(disabledGuard.consequent) ||
    !isNodeOfType(keyDeclaration, "VariableDeclaration") ||
    keyDeclaration.kind !== "const" ||
    keyDeclaration.declarations.length !== 1
  )
    return false;
  const keyDeclarator = keyDeclaration.declarations[0];
  if (
    !keyDeclarator ||
    !keyDeclarator.init ||
    !symbolMatches(keyDeclarator.init, event, scopes) ||
    !isNodeOfType(keyDeclarator.id, "ObjectPattern") ||
    keyDeclarator.id.properties.length !== 1
  )
    return false;
  const property = keyDeclarator.id.properties[0];
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.kind !== "init" ||
    !isNodeOfType(property.key, "Identifier") ||
    property.key.name !== "key" ||
    !isNodeOfType(property.value, "Identifier")
  )
    return false;
  const key = scopes.symbolFor(property.value);
  if (
    !key ||
    hasSymbolBindingWrites(key) ||
    !isNodeOfType(closedBranch, "IfStatement") ||
    closedBranch.alternate
  )
    return false;
  const phaseTest = stripParenExpression(closedBranch.test);
  if (
    !isNodeOfType(phaseTest, "UnaryExpression") ||
    phaseTest.operator !== "!" ||
    !symbolMatches(phaseTest.argument, dispatcher.phase, scopes) ||
    !isNodeOfType(closedBranch.consequent, "BlockStatement")
  )
    return false;
  const closedStatements = closedBranch.consequent.body;
  if (
    closedStatements.length !== 2 ||
    !isNodeOfType(closedStatements[0], "IfStatement") ||
    closedStatements[0].alternate ||
    !emptyReturn(closedStatements[1])
  )
    return false;
  const openingBranch = closedStatements[0];
  const keys = new Set<string>();
  if (
    !keyCondition(openingBranch.test, key, COMBOBOX_OPEN_KEY_NAMES, keys, scopes) ||
    !keys.has("Enter") ||
    !isNodeOfType(openingBranch.consequent, "BlockStatement") ||
    openingBranch.consequent.body.length !== 2 ||
    !eventMethod(openingBranch.consequent.body[0], event, scopes)
  )
    return false;
  const openStatement = openingBranch.consequent.body[1];
  const openCall = isNodeOfType(openStatement, "ExpressionStatement")
    ? stripParenExpression(openStatement.expression)
    : null;
  if (
    !isNodeOfType(openCall, "CallExpression") ||
    openCall.optional ||
    openCall.arguments.length !== 1 ||
    !symbolMatches(openCall.callee, dispatcher.callback.symbol, scopes) ||
    !isNodeOfType(openCall.arguments[0], "Literal") ||
    openCall.arguments[0].value !== true
  )
    return false;
  if (
    !isNodeOfType(openBranch, "IfStatement") ||
    !keyCondition(openBranch.test, key, new Set(["Escape"]), new Set(), scopes) ||
    !isNodeOfType(openBranch.consequent, "BlockStatement")
  )
    return false;
  const escapeStatements = openBranch.consequent.body;
  if (
    (escapeStatements.length !== 2 && escapeStatements.length !== 3) ||
    !escapeStatements[0] ||
    !eventMethod(escapeStatements[0], event, scopes)
  )
    return false;
  const dismissStatement = escapeStatements[1];
  const dismissCall = isNodeOfType(dismissStatement, "ExpressionStatement")
    ? stripParenExpression(dismissStatement.expression)
    : null;
  if (
    !isNodeOfType(dismissCall, "CallExpression") ||
    dismissCall.optional ||
    dismissCall.arguments.length !== 0
  )
    return false;
  const dismissal = resolveNativeComboboxDismissal(dismissCall.callee, dispatcher, owner, scopes);
  if (!dismissal || !symbolMatches(closingTest.argument, dismissal.closingState, scopes))
    return false;
  const focusStatement = escapeStatements[2];
  if (focusStatement) {
    const focus = isNodeOfType(focusStatement, "ExpressionStatement")
      ? stripParenExpression(focusStatement.expression)
      : null;
    const focusCall = isNodeOfType(focus, "ChainExpression") ? focus.expression : focus;
    const selectedRef = valueAttribute(opening, "ref");
    const focusMember = isNodeOfType(focusCall, "CallExpression") ? focusCall.callee : null;
    const focusReceiver = isNodeOfType(focusMember, "MemberExpression") ? focusMember.object : null;
    const selectedRefSymbol =
      selectedRef && isNodeOfType(selectedRef, "Identifier") ? scopes.symbolFor(selectedRef) : null;
    if (
      !selectedRefSymbol ||
      !isNodeOfType(focusCall, "CallExpression") ||
      focusCall.arguments.length !== 0 ||
      !isNodeOfType(focusMember, "MemberExpression") ||
      getStaticPropertyName(focusMember) !== "focus" ||
      !isNodeOfType(focusReceiver, "MemberExpression") ||
      getStaticPropertyName(focusReceiver) !== "current" ||
      !symbolMatches(focusReceiver.object, selectedRefSymbol, scopes)
    )
      return false;
  }
  if (openBranch.alternate) {
    const commit = openBranch.alternate;
    if (
      !isNodeOfType(commit, "IfStatement") ||
      commit.alternate ||
      !keyCondition(commit.test, key, new Set(["Enter"]), new Set(), scopes) ||
      !isNodeOfType(commit.consequent, "BlockStatement") ||
      commit.consequent.body.length !== 2 ||
      !eventMethod(commit.consequent.body[0], event, scopes)
    )
      return false;
    const action = commit.consequent.body[1];
    const invocation = isNodeOfType(action, "ExpressionStatement")
      ? stripParenExpression(action.expression)
      : null;
    if (
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.optional ||
      invocation.arguments.length !== 0 ||
      !getLocalComboboxCallback(invocation.callee, scopes)
    )
      return false;
  }
  const allowedEvent = new Set<EsTreeNode>([keyDeclarator.init]);
  const allowedKey = new Set<EsTreeNode>();
  walkAst(handler.node.body, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      scopes.symbolFor(node) === event &&
      isNodeOfType(node.parent, "MemberExpression") &&
      node.parent.object === node &&
      getStaticPropertyName(node.parent) === "preventDefault"
    )
      allowedEvent.add(node);
    if (
      isNodeOfType(node, "Identifier") &&
      scopes.symbolFor(node) === key &&
      isNodeOfType(node.parent, "BinaryExpression") &&
      node.parent.left === node
    )
      allowedKey.add(node);
  });
  return (
    hasOnlyAllowedSymbolReads({
      symbol: event,
      allowedIdentifiers: allowedEvent,
      program: scopes.rootScope.node,
      scopes,
    }) &&
    hasOnlyAllowedSymbolReads({
      symbol: key,
      allowedIdentifiers: allowedKey,
      program: scopes.rootScope.node,
      scopes,
    }) &&
    nativeEnvironment(scopes)
  );
};
