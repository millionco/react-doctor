import { SECOND_ARGUMENT_INDEX } from "../rules/state-and-effects/utils/effect/constants.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getImportedName } from "./get-imported-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const supportedPrograms = new WeakMap<EsTreeNode, boolean>();
const readonlyBindings = new WeakMap<SymbolDescriptor, boolean>();
const producerReferences = new WeakMap<SymbolDescriptor, boolean>();
const producerSources = new WeakMap<ScopeAnalysis, Map<string, boolean>>();
const awaitedInputs = new WeakMap<SymbolDescriptor, boolean>();

const isReadonlyBinding = (symbol: SymbolDescriptor): boolean => {
  const cached = readonlyBindings.get(symbol);
  if (cached !== undefined) return cached;
  const readonly = symbol.references.every(
    (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
  );
  readonlyBindings.set(symbol, readonly);
  return readonly;
};

const isDirectCallReference = (expression: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(expression);
  const parent = root.parent;
  return isNodeOfType(parent, "CallExpression") && parent.callee === root && !parent.optional;
};

const isNativeFocusCall = (expression: EsTreeNode, context: RuleContext): boolean => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length) return false;
  const callee = stripParenExpression(call.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "hasFocus" &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "document" &&
    context.scopes.isGlobalReference(callee.object)
  );
};

const hasClosedReactImports = (program: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  return program.body.every((statement) => {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.source.value !== "react" ||
      statement.importKind === "type"
    )
      return true;
    return statement.specifiers.every((specifier) => {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
        return true;
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol || !isReadonlyBinding(symbol)) return false;
      const namespace =
        !isNodeOfType(specifier, "ImportSpecifier") || getImportedName(specifier) === "default";
      return symbol.references.every((reference) => {
        if (isTypeScriptTypePosition(reference.identifier)) return true;
        if (!namespace) return isDirectCallReference(reference.identifier);
        const root = findTransparentExpressionRoot(reference.identifier);
        const member = root.parent;
        return (
          isNodeOfType(member, "MemberExpression") &&
          member.object === root &&
          !member.optional &&
          !member.computed &&
          !isMemberMutationTarget(member) &&
          isDirectCallReference(member)
        );
      });
    });
  });
};

const isReadonlyComputedCarrierDataUse = (
  expression: EsTreeNode,
  context: RuleContext,
  visited = new Set<EsTreeNode>(),
): boolean => {
  const root = findTransparentExpressionRoot(expression);
  if (visited.has(root)) return false;
  const nextVisited = new Set(visited).add(root);
  const parent = root.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "UnaryExpression")) {
    return parent.argument === root && ["void", "typeof", "!"].includes(parent.operator);
  }
  if (isNodeOfType(parent, "IfStatement") && parent.test === root) return true;
  if (isNodeOfType(parent, "ConditionalExpression")) {
    return parent.test === root || isReadonlyComputedCarrierDataUse(parent, context, nextVisited);
  }
  if (isNodeOfType(parent, "LogicalExpression")) {
    return isReadonlyComputedCarrierDataUse(parent, context, nextVisited);
  }
  if (isNodeOfType(parent, "JSXExpressionContainer")) {
    return (
      parent.expression === root &&
      (isNodeOfType(parent.parent, "JSXElement") || isNodeOfType(parent.parent, "JSXFragment"))
    );
  }
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== root ||
    !isNodeOfType(parent.id, "Identifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(parent.id);
  if (!symbol || getDirectConstInitializer(symbol) !== root || !isReadonlyBinding(symbol))
    return false;
  return symbol.references.every(
    (reference) =>
      parent.range[1] <= reference.identifier.range[0] &&
      isReadonlyComputedCarrierDataUse(reference.identifier, context, nextVisited),
  );
};

const isSupportedProgram = (expression: EsTreeNode, context: RuleContext): boolean => {
  const program = findProgramRoot(expression);
  if (!program) return false;
  const cached = supportedPrograms.get(program);
  if (cached !== undefined) return cached;
  let supported = hasClosedReactImports(program, context);
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      ("declare" in node && node.declare === true) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSDeclareFunction")
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const key = getResolvedStaticPropertyName(node, context.scopes);
      if (
        key === "constructor" ||
        key === "prototype" ||
        key === "__proto__" ||
        (node.computed &&
          key === null &&
          (isNodeOfType(node, "Property") ||
            isDirectCallReference(node) ||
            isMemberMutationTarget(node) ||
            isNodeOfType(findTransparentExpressionRoot(node).parent, "MemberExpression") ||
            (isNodeOfType(node, "MemberExpression") &&
              isFunctionLike(stripParenExpression(node.object)))))
      ) {
        supported = false;
        return false;
      }
      if (isNodeOfType(node, "MemberExpression") && node.computed && key === null) {
        const receiver = stripParenExpression(node.object);
        const receiverSymbol = isNodeOfType(receiver, "Identifier")
          ? resolveConstIdentifierAlias(receiver, context.scopes)
          : null;
        const receiverInitializer = receiverSymbol
          ? getDirectConstInitializer(receiverSymbol)
          : null;
        if (
          (receiverInitializer && isFunctionLike(stripParenExpression(receiverInitializer))) ||
          receiverSymbol?.kind === "function" ||
          receiverSymbol?.kind === "class" ||
          !isReadonlyComputedCarrierDataUse(node, context)
        ) {
          supported = false;
          return false;
        }
      }
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const reference = context.scopes.referenceFor(node);
    if (!reference) return;
    const symbol = reference.resolvedSymbol;
    if (symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol)) {
      supported = false;
      return false;
    }
    if (!context.scopes.isGlobalReference(node)) return;
    if (["eval", "Function", "Reflect", "Document", "require", "constructor"].includes(node.name)) {
      supported = false;
      return false;
    }
    const root = findTransparentExpressionRoot(node);
    const member = root.parent;
    if (node.name === "document") {
      const call = isNodeOfType(member, "MemberExpression")
        ? findTransparentExpressionRoot(member).parent
        : null;
      supported =
        isNodeOfType(member, "MemberExpression") &&
        member.object === root &&
        isNodeOfType(call, "CallExpression") &&
        isNativeFocusCall(call, context);
    } else if (["window", "globalThis", "self", "global"].includes(node.name)) {
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== root ||
        member.optional ||
        member.computed ||
        isMemberMutationTarget(member)
      ) {
        supported = false;
        return false;
      }
      const key = getResolvedStaticPropertyName(member, context.scopes);
      supported =
        key === "PublicKeyCredential" ||
        ((key === "addEventListener" || key === "removeEventListener") &&
          isDirectCallReference(member));
    }
  });
  supportedPrograms.set(program, supported);
  return supported;
};

const hasSupportedProducerReferences = (
  producer: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const cached = producerReferences.get(producer);
  if (cached !== undefined) return cached;
  const supported = producer.references.every((reference) => {
    if (isDirectCallReference(reference.identifier)) return true;
    const root = findTransparentExpressionRoot(reference.identifier);
    const dependencyArray = root.parent;
    const wrapper = dependencyArray?.parent;
    return (
      isNodeOfType(dependencyArray, "ArrayExpression") &&
      dependencyArray.elements.some((element) => element === root) &&
      isNodeOfType(wrapper, "CallExpression") &&
      wrapper.arguments[SECOND_ARGUMENT_INDEX] === dependencyArray &&
      isProvenUnmodifiedReactApiCall(wrapper, "useCallback", context.scopes)
    );
  });
  producerReferences.set(producer, supported);
  return supported;
};

const hasSupportedAwaitedInputBinding = (
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const initializer = getDirectConstInitializer(symbol);
  const callback = findEnclosingFunction(symbol.declarationNode);
  if (!initializer || !isReadonlyBinding(symbol) || !isFunctionLike(callback)) return false;
  const awaited = stripParenExpression(initializer);
  if (!isNodeOfType(awaited, "AwaitExpression")) return false;
  const call = stripParenExpression(awaited.argument);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const producer = context.scopes.symbolFor(callee);
  if (
    !producer ||
    !isReadonlyBinding(producer) ||
    !hasSupportedProducerReferences(producer, context)
  )
    return false;
  const declaration = producer.declarationNode;
  if (producer.kind === "import") {
    if (
      !isNodeOfType(declaration, "ImportSpecifier") ||
      declaration.importKind === "type" ||
      getImportedName(declaration) === "default" ||
      !isNodeOfType(declaration.parent, "ImportDeclaration") ||
      declaration.parent.importKind === "type"
    )
      return false;
    const source = declaration.parent.source.value;
    const program = findProgramRoot(symbol.declarationNode);
    if (!program || !isNodeOfType(program, "Program")) return false;
    let sources = producerSources.get(context.scopes);
    if (!sources) {
      sources = new Map();
      producerSources.set(context.scopes, sources);
    }
    const cached = sources.get(source);
    if (cached !== undefined) return cached;
    const supported = program.body.every((statement) => {
      if (
        !isNodeOfType(statement, "ImportDeclaration") ||
        statement.importKind === "type" ||
        statement.source.value !== source
      )
        return true;
      return statement.specifiers.every((specifier) => {
        if (isNodeOfType(specifier, "ImportSpecifier") && getImportedName(specifier) !== "default")
          return true;
        const namespace = context.scopes.symbolFor(specifier.local);
        return Boolean(
          namespace &&
          namespace.references.every((reference) => isTypeScriptTypePosition(reference.identifier)),
        );
      });
    });
    sources.set(source, supported);
    return supported;
  }
  const owner = findEnclosingFunction(callback);
  if (
    producer.kind !== "parameter" ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !componentOrHookDisplayNameForFunction(owner) ||
    findEnclosingFunction(producer.bindingIdentifier) !== owner
  )
    return false;
  let ancestor = producer.bindingIdentifier.parent;
  while (ancestor && ancestor !== owner) {
    if (isNodeOfType(ancestor, "AssignmentPattern") || isNodeOfType(ancestor, "RestElement"))
      return false;
    ancestor = ancestor.parent;
  }
  return true;
};

const isReadonlyAwaitedInput = (expression: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(expression);
  const callback = findEnclosingFunction(expression);
  if (
    !symbol ||
    symbol.declarationNode.range[1] > expression.range[0] ||
    !isFunctionLike(callback) ||
    !callback.async ||
    callback.generator ||
    findEnclosingFunction(symbol.declarationNode) !== callback
  )
    return false;
  const cached = awaitedInputs.get(symbol);
  if (cached !== undefined) return cached;
  const supported = hasSupportedAwaitedInputBinding(symbol, context);
  awaitedInputs.set(symbol, supported);
  return supported;
};

export const isFiniteEffectCallbackBooleanInput = (
  expression: EsTreeNode,
  context: RuleContext,
): boolean => {
  let predicate = stripParenExpression(expression);
  if (isNodeOfType(predicate, "UnaryExpression") && predicate.operator === "!") {
    predicate = stripParenExpression(predicate.argument);
  }
  return (
    (isNativeFocusCall(predicate, context) || isReadonlyAwaitedInput(predicate, context)) &&
    isSupportedProgram(predicate, context)
  );
};
