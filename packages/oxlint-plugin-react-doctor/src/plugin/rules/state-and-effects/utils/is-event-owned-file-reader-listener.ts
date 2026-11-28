import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getDirectFunctionBindingIdentifier } from "../../../utils/get-direct-function-binding-identifier.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getFunctionExportNames } from "../../../utils/get-function-export-names.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isReactComponentName } from "../../../utils/is-react-component-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";

const readMethods: ReadonlySet<string> = new Set([
  "readAsArrayBuffer",
  "readAsBinaryString",
  "readAsDataURL",
  "readAsText",
]);

const completionEvents: ReadonlySet<string> = new Set(["load", "loadend", "error", "abort"]);

const isNativeElementEvent = (expression: EsTreeNode, context: RuleContext): boolean => {
  const root = findTransparentExpressionRoot(expression);
  const container = root.parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  if (
    !(
      isNodeOfType(container, "JSXExpressionContainer") &&
      container.expression === root &&
      isEventHandlerAttribute(attribute) &&
      isNodeOfType(opening, "JSXOpeningElement") &&
      isNodeOfType(opening.name, "JSXIdentifier") &&
      /^[a-z][a-zA-Z0-9]*$/.test(opening.name.name) &&
      opening.attributes.every(
        (candidate) =>
          isNodeOfType(candidate, "JSXAttribute") &&
          isNodeOfType(candidate.name, "JSXIdentifier") &&
          candidate.name.name !== "is",
      ) &&
      isNodeOfType(opening.parent, "JSXElement")
    )
  ) {
    return false;
  }
  const element = findTransparentExpressionRoot(opening.parent);
  const component = findEnclosingFunction(element);
  if (!component || !isFunctionLike(component)) return false;
  const binding = getDirectFunctionBindingIdentifier(component);
  if (
    !binding ||
    !isReactComponentName(binding.name) ||
    (isNodeOfType(component, "FunctionExpression") && component.id !== null) ||
    (component.body !== element &&
      (!isNodeOfType(element.parent, "ReturnStatement") || element.parent.argument !== element))
  ) {
    return false;
  }
  const symbols = new Set(getFunctionBindingSymbols(component, context.scopes));
  const localBinding = context.scopes.symbolFor(binding);
  if (localBinding) symbols.add(localBinding);
  return [...symbols].every((symbol) =>
    symbol.references.every(({ identifier, flag }) => {
      if (flag !== "read") return false;
      const root = findTransparentExpressionRoot(identifier);
      const use = root.parent;
      if (isNodeOfType(use, "JSXOpeningElement") || isNodeOfType(use, "JSXClosingElement")) {
        return use.name === root;
      }
      return (
        isNodeOfType(use, "CallExpression") &&
        use.arguments[0] === root &&
        isReactApiCall(use, "createElement", context.scopes)
      );
    }),
  );
};

const startsOnlyFromNativeEvents = (
  owner: EsTreeNode,
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
  proofs: Map<EsTreeNode, boolean>,
): boolean => {
  if (isNativeElementEvent(owner, context)) return true;
  const cached = proofs.get(owner);
  if (cached !== undefined) return cached;
  proofs.set(owner, false);
  const binding = getDirectFunctionBindingIdentifier(owner);
  if (!binding || getFunctionExportNames(program, owner).length > 0) return false;
  const symbols = new Set(getFunctionBindingSymbols(owner, context.scopes));
  const innerBinding = context.scopes.symbolFor(binding);
  if (innerBinding) symbols.add(innerBinding);
  const references = [...symbols].flatMap((symbol) => symbol.references);
  const proven =
    references.length > 0 &&
    [...symbols].every((symbol) => hasCompleteSymbolReferences(symbol, program, context.scopes)) &&
    references.every(({ identifier, flag }) => {
      if (flag !== "read") return false;
      if (isNativeElementEvent(identifier, context)) return true;
      const root = findTransparentExpressionRoot(identifier);
      const call = root.parent;
      if (!isNodeOfType(call, "CallExpression") || call.callee !== root) return false;
      const caller = findEnclosingFunction(call);
      return caller !== null && startsOnlyFromNativeEvents(caller, program, context, proofs);
    });
  proofs.set(owner, proven);
  return proven;
};

const hasUnchangedReaderProvider = (
  program: EsTreeNode,
  constructor: EsTreeNode,
  context: RuleContext,
): boolean => {
  let unchanged = true;
  walkAst(program, (node) => {
    if (!unchanged) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      if (property === "FileReader" || property === "EventTarget" || property === "defaultView")
        unchanged = false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      !context.scopes.isGlobalReference(node) ||
      node === constructor
    ) {
      return;
    }
    if (node.name === "FileReader" || node.name === "EventTarget" || node.name === "eval") {
      unchanged = false;
    }
    if (node.name === "window" || node.name === "globalThis" || node.name === "self") {
      const root = findTransparentExpressionRoot(node);
      const access = root.parent;
      if (
        !isNodeOfType(access, "MemberExpression") ||
        access.object !== root ||
        !getStaticPropertyName(access)
      ) {
        unchanged = false;
      }
    }
  });
  return unchanged;
};

export const isEventOwnedFileReaderListener = (
  registration: EsTreeNodeOfType<"CallExpression">,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(registration.callee);
  const [event, handler, ...options] = registration.arguments;
  if (
    registration.optional ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getStaticPropertyName(callee) !== "addEventListener" ||
    !isNodeOfType(event, "Literal") ||
    typeof event.value !== "string" ||
    !completionEvents.has(event.value) ||
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.params.length > 0 ||
    options.length > 0
  ) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  const reader = isNodeOfType(receiver, "Identifier") ? context.scopes.symbolFor(receiver) : null;
  const initializer = reader ? getDirectConstInitializer(reader) : null;
  if (!reader || !initializer) return false;
  const instantiation = stripParenExpression(initializer);
  if (
    !isNodeOfType(instantiation, "NewExpression") ||
    instantiation.arguments.length > 0 ||
    findEnclosingFunction(instantiation) !== owner ||
    !isNodeOfType(instantiation.callee, "Identifier") ||
    instantiation.callee.name !== "FileReader" ||
    !context.scopes.isGlobalReference(instantiation.callee)
  ) {
    return false;
  }

  if (!isFunctionLike(owner) || owner.async || owner.generator) return false;
  const declaration = reader.declarationNode.parent;
  const registrationStatement = findTransparentExpressionRoot(registration).parent;
  const block = registrationStatement?.parent;
  if (
    !isNodeOfType(registrationStatement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement")
  ) {
    return false;
  }
  if (
    block !== owner.body ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.declarations.length !== 1 ||
    declaration.parent !== block
  ) {
    return false;
  }
  const index = block.body.findIndex((statement) => statement === registrationStatement);
  if (block.body[index - 1] !== declaration) return false;
  const readStatement = block.body[index + 1];
  if (!isNodeOfType(readStatement, "ExpressionStatement")) return false;
  const read = stripParenExpression(readStatement.expression);
  const method = isNodeOfType(read, "CallExpression") ? stripParenExpression(read.callee) : null;
  const readReceiver = isNodeOfType(method, "MemberExpression")
    ? stripParenExpression(method.object)
    : null;
  if (
    !isNodeOfType(read, "CallExpression") ||
    read.optional ||
    !isNodeOfType(method, "MemberExpression") ||
    method.optional ||
    !readMethods.has(getStaticPropertyName(method) ?? "") ||
    read.arguments.length !== 1 ||
    isNodeOfType(read.arguments[0], "SpreadElement") ||
    !readReceiver ||
    context.scopes.symbolFor(readReceiver) !== reader
  ) {
    return false;
  }

  const program = findProgramRoot(owner);
  if (
    !isNodeOfType(program, "Program") ||
    !hasCompleteSymbolReferences(reader, program, context.scopes)
  ) {
    return false;
  }
  const hasPrivateReceiver = reader.references.every(({ identifier, flag }) => {
    if (flag !== "read") return false;
    if (identifier === receiver || identifier === readReceiver) return true;
    const root = findTransparentExpressionRoot(identifier);
    const access = root.parent;
    return (
      isNodeOfType(access, "MemberExpression") &&
      access.object === root &&
      (getStaticPropertyName(access) === "result" || getStaticPropertyName(access) === "error") &&
      findEnclosingFunction(access) === handler &&
      !isWithinAssignmentTarget(access)
    );
  });
  const source = context.sourceCode?.getText?.();
  return Boolean(
    hasPrivateReceiver &&
    source &&
    !/@jsx(?:ImportSource)?\s/.test(source) &&
    hasUnchangedReaderProvider(program, instantiation.callee, context) &&
    startsOnlyFromNativeEvents(owner, program, context, new Map()),
  );
};
