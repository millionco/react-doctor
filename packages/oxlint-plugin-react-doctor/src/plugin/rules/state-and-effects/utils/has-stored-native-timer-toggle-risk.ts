import {
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
  TIMER_TOGGLE_GLOBAL_NAMESPACE_NAMES,
  TIMER_TOGGLE_REFUSED_GLOBAL_NAMES,
  TIMER_TOGGLE_REFUSED_MEMBER_NAMES,
  TIMER_TOGGLE_REFUSED_MODULE_NAMES,
} from "../../../constants/dom.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getRootIdentifier } from "../../../utils/get-root-identifier.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { hasJsxSpreadAttribute } from "../../../utils/has-jsx-spread-attribute.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isJsxAttributePotentiallyTruthy } from "../../../utils/is-jsx-attribute-potentially-truthy.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { getRuntimeStaticDependencySource } from "../../../utils/get-runtime-static-dependency-source.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isGlobalBrowserFunctionCall } from "../../../utils/is-global-browser-function-call.js";
import { isLiteralVoidExpression } from "../../../utils/is-literal-void-expression.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { readConstantBoolean } from "../../../utils/read-constant-boolean.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { RuleContext } from "../../../utils/rule-context.js";

interface TimerToggleProof {
  readonly scopes: ScopeAnalysis;
  readonly program: EsTreeNode;
  readonly component: EsTreeNode;
  readonly cell: SymbolDescriptor;
  readonly producer: EsTreeNode;
  readonly guard: EsTreeNode;
  readonly readinessSymbol: SymbolDescriptor | null;
}

const currentCell = (node: EsTreeNode, scopes: ScopeAnalysis): SymbolDescriptor | null => {
  const member = stripParenExpression(node);
  if (!isNodeOfType(member, "MemberExpression") || getStaticPropertyName(member) !== "current") {
    return null;
  }
  const receiver = stripParenExpression(member.object);
  return isNodeOfType(receiver, "Identifier") ? scopes.symbolFor(receiver) : null;
};

const importedJsxOwner = (
  element: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(element, "JSXElement")) return false;
  let name = element.openingElement.name;
  while (isNodeOfType(name, "JSXMemberExpression")) name = name.object;
  if (!isNodeOfType(name, "JSXIdentifier")) return false;
  if (/^[a-z]/.test(name.name)) return true;
  const symbol = scopes.symbolFor(name);
  return Boolean(symbol && getValueImportSource(symbol));
};

const hasEffectiveAttribute = (attribute: EsTreeNode, opening: EsTreeNode): boolean => {
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    hasJsxSpreadAttribute(opening.attributes)
  )
    return false;
  const name = attribute.name.name;
  return (
    opening.attributes.filter(
      (entry) =>
        isNodeOfType(entry, "JSXAttribute") &&
        isNodeOfType(entry.name, "JSXIdentifier") &&
        entry.name.name === name,
    ).length === 1 && getAuthoritativeJsxAttribute(opening.attributes, name) === attribute
  );
};

const hasUsableJsxOwner = (element: EsTreeNode, proof: TimerToggleProof): boolean => {
  if (!isNodeOfType(element, "JSXElement") || !importedJsxOwner(element, proof.scopes))
    return false;
  const opening = element.openingElement;
  return (
    !hasJsxSpreadAttribute(opening.attributes) &&
    !isJsxAttributePotentiallyTruthy(
      getAuthoritativeJsxAttribute(opening.attributes, "disabled"),
    ) &&
    !opening.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        (attribute.name.name === "inert" || attribute.name.name === "dangerouslySetInnerHTML"),
    )
  );
};

const hasReadinessReference = (node: EsTreeNode, proof: TimerToggleProof): boolean =>
  Boolean(
    proof.readinessSymbol?.references.some((reference) =>
      isAstDescendant(reference.identifier, node),
    ),
  );

const hasReadinessOwnerBranch = (proof: TimerToggleProof): boolean => {
  let correlated = false;
  walkAst(proof.component, (node) => {
    if (isFunctionLike(node) && node !== proof.component) return false;
    if (isNodeOfType(node, "IfStatement") && hasReadinessReference(node.test, proof)) {
      correlated = true;
      return false;
    }
  });
  return correlated;
};

const hasSupportedComponentReturn = (
  statement: EsTreeNodeOfType<"ReturnStatement">,
  proof: TimerToggleProof,
): boolean => {
  const component = proof.component;
  if (
    !isFunctionLike(component) ||
    !isNodeOfType(component.body, "BlockStatement") ||
    statement.parent !== component.body
  )
    return false;
  const position = component.body.body.findIndex((entry) => entry === statement);
  if (position < 0) return false;
  return component.body.body.slice(0, position).every((entry) => {
    let exits = false;
    walkAst(entry, (node) => {
      if (isFunctionLike(node)) return false;
      if (isNodeOfType(node, "ReturnStatement") || isNodeOfType(node, "ThrowStatement")) {
        exits = true;
        return false;
      }
    });
    return !exits;
  });
};

const returnedJsxValue = (node: EsTreeNode, proof: TimerToggleProof): boolean => {
  let current = findTransparentExpressionRoot(node);
  let hasObjectCarrier = false;
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(current, "JSXElement") && !hasUsableJsxOwner(current, proof)) return false;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return parent.argument === current && hasSupportedComponentReturn(parent, proof);
    }
    if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === current) {
      return parent === proof.component;
    }
    if (
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      parent.children.some((child) => child === current)
    ) {
      current = parent;
    } else if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) {
      const owner = parent.parent;
      if (isNodeOfType(owner, "JSXAttribute")) {
        const opening = owner.parent;
        if (
          !isNodeOfType(opening, "JSXOpeningElement") ||
          !isNodeOfType(opening.parent, "JSXElement") ||
          !hasEffectiveAttribute(owner, opening)
        )
          return false;
        const isChildren =
          isNodeOfType(owner.name, "JSXIdentifier") && owner.name.name === "children";
        if (
          isChildren &&
          opening.parent.children.some(
            (child) => !isNodeOfType(child, "JSXText") || child.value.trim().length > 0,
          )
        )
          return false;
        if (
          isNodeOfType(opening.name, "JSXIdentifier") &&
          /^[a-z]/.test(opening.name.name) &&
          (!isChildren || hasObjectCarrier)
        )
          return false;
        current = opening.parent;
        hasObjectCarrier = false;
      } else if (isNodeOfType(owner, "JSXElement") || isNodeOfType(owner, "JSXFragment")) {
        if (hasObjectCarrier) return false;
        current = owner;
      } else return false;
    } else if (
      isNodeOfType(parent, "Property") &&
      parent.value === current &&
      parent.kind === "init" &&
      !parent.method &&
      isNodeOfType(parent.parent, "ObjectExpression")
    ) {
      current = parent.parent;
      hasObjectCarrier = true;
    } else if (
      isNodeOfType(parent, "ArrayExpression") &&
      parent.elements.some((element) => element === current)
    ) {
      current = parent;
    } else if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      if (hasReadinessReference(parent.test, proof)) return false;
      const condition = readConstantBoolean(parent.test, proof.scopes);
      if (condition !== null && (condition ? parent.alternate : parent.consequent) === current) {
        return false;
      }
      current = parent;
    } else if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === current &&
      readConstantBoolean(parent.left, proof.scopes) !== false
    ) {
      if (hasReadinessReference(parent.left, proof)) return false;
      current = parent;
    } else return false;
    current = findTransparentExpressionRoot(current);
  }
  return false;
};

const eventReference = (node: EsTreeNode, proof: TimerToggleProof): boolean => {
  const root = findTransparentExpressionRoot(node);
  const container = root.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== root ||
    !isEventHandlerAttribute(container.parent) ||
    !isNodeOfType(container.parent.name, "JSXIdentifier") ||
    container.parent.name.name !== "onClick"
  )
    return false;
  const opening = container.parent.parent;
  return (
    isNodeOfType(opening, "JSXOpeningElement") &&
    hasEffectiveAttribute(container.parent, opening) &&
    hasUsableJsxOwner(opening.parent!, proof) &&
    returnedJsxValue(opening.parent!, proof)
  );
};

const hasRepeatedEventUse = (handler: EsTreeNode, proof: TimerToggleProof): boolean => {
  if (eventReference(handler, proof)) return true;
  const identifier = getFunctionBindingIdentifier(handler);
  const symbol = identifier && proof.scopes.symbolFor(identifier);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !hasCompleteSymbolReferences(symbol, proof.program, proof.scopes)
  ) {
    return false;
  }
  let uses = false;
  for (const reference of symbol.references) {
    if (isNonReferenceIdentifier(reference.identifier)) continue;
    if (reference.flag !== "read" || !eventReference(reference.identifier, proof)) return false;
    uses = true;
  }
  return uses;
};

const nativeClear = (call: EsTreeNode, cell: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const invocation = stripParenExpression(call);
  if (!isNodeOfType(invocation, "CallExpression") || invocation.optional) return false;
  const [argument, ...extra] = invocation.arguments;
  return Boolean(
    argument &&
    extra.length === 0 &&
    currentCell(argument, scopes) === cell &&
    (isGlobalBrowserFunctionCall(invocation, "clearInterval", scopes) ||
      isGlobalBrowserFunctionCall(invocation, "clearTimeout", scopes)),
  );
};

const isBooleanRead = (node: EsTreeNode): boolean => {
  let root = findTransparentExpressionRoot(node);
  while (
    isNodeOfType(root.parent, "LogicalExpression") &&
    (root.parent.operator === "||" || root.parent.operator === "&&")
  ) {
    root = findTransparentExpressionRoot(root.parent);
  }
  const consumer = root.parent;
  return Boolean(
    (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "!") ||
    (isNodeOfType(consumer, "IfStatement") && consumer.test === root) ||
    (isNodeOfType(consumer, "ConditionalExpression") && consumer.test === root),
  );
};

const hasClosedSelectedCell = (proof: TimerToggleProof): boolean =>
  hasCompleteSymbolReferences(proof.cell, proof.program, proof.scopes) &&
  proof.cell.references.every((reference) => {
    if (isNonReferenceIdentifier(reference.identifier)) return true;
    if (reference.flag !== "read") return false;
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const member = identifier.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      getStaticPropertyName(member) !== "current"
    )
      return false;
    const root = findTransparentExpressionRoot(member);
    const consumer = root.parent;
    if (isNodeOfType(consumer, "AssignmentExpression") && consumer.left === root) {
      return consumer === proof.producer;
    }
    if (isMemberMutationTarget(member)) return false;
    return (
      isBooleanRead(member) ||
      (isNodeOfType(consumer, "CallExpression") && nativeClear(consumer, proof.cell, proof.scopes))
    );
  });

const passiveLiteral = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return !("regex" in expression && expression.regex);
  if (isNodeOfType(expression, "Identifier")) {
    return expression.name === "undefined" && scopes.isGlobalReference(expression);
  }
  if (!isNodeOfType(expression, "ObjectExpression")) return false;
  const names = new Set<string>();
  return expression.properties.every((property) => {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
      return false;
    const name = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (name === null || TIMER_TOGGLE_REFUSED_MEMBER_NAMES.has(name) || names.has(name))
      return false;
    names.add(name);
    return passiveLiteral(property.value, scopes);
  });
};

const refPublication = (identifier: EsTreeNode, proof: TimerToggleProof): boolean => {
  const root = findTransparentExpressionRoot(identifier);
  const container = root.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== root ||
    !isNodeOfType(container.parent, "JSXAttribute") ||
    !isNodeOfType(container.parent.name, "JSXIdentifier") ||
    container.parent.name.name !== "ref"
  )
    return false;
  const opening = container.parent.parent;
  return (
    isNodeOfType(opening, "JSXOpeningElement") &&
    hasEffectiveAttribute(container.parent, opening) &&
    importedJsxOwner(opening.parent, proof.scopes) &&
    isNodeOfType(opening.name, "JSXIdentifier") &&
    !/^[a-z]/.test(opening.name.name) &&
    returnedJsxValue(opening.parent!, proof)
  );
};

const contextPublication = (identifier: EsTreeNode, proof: TimerToggleProof): boolean => {
  const root = findTransparentExpressionRoot(identifier);
  const property = root.parent;
  const object =
    isNodeOfType(property, "Property") && property.value === root ? property.parent : null;
  const container = isNodeOfType(object, "ObjectExpression") ? object.parent : null;
  const attribute = isNodeOfType(container, "JSXExpressionContainer") ? container.parent : null;
  const opening = isNodeOfType(attribute, "JSXAttribute") ? attribute.parent : null;
  return Boolean(
    isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    attribute.name.name === "value" &&
    isNodeOfType(opening, "JSXOpeningElement") &&
    isNodeOfType(opening.name, "JSXMemberExpression") &&
    opening.name.property.name === "Provider" &&
    hasEffectiveAttribute(attribute, opening) &&
    importedJsxOwner(opening.parent, proof.scopes) &&
    returnedJsxValue(opening.parent!, proof),
  );
};

const readinessCanBeTruthy = (node: EsTreeNode, proof: TimerToggleProof): boolean => {
  const expression = stripParenExpression(node);
  const scalar = readConstantBoolean(expression, proof.scopes);
  if (scalar !== null) return scalar;
  if (isNodeOfType(expression, "Identifier")) {
    const parameter = proof.scopes.symbolFor(expression);
    return Boolean(
      parameter &&
      parameter.kind === "parameter" &&
      parameter.scope.node === proof.component &&
      hasCompleteSymbolReferences(parameter, proof.program, proof.scopes) &&
      parameter.references.every(
        (reference) =>
          reference.flag === "read" && isAstDescendant(reference.identifier, proof.guard),
      ),
    );
  }
  const properties: string[] = [];
  let current: EsTreeNode = expression;
  while (isNodeOfType(current, "MemberExpression")) {
    const name = getStaticPropertyName(current);
    if (name === null || TIMER_TOGGLE_REFUSED_MEMBER_NAMES.has(name)) return false;
    properties.unshift(name);
    current = stripParenExpression(current.object);
  }
  if (!isNodeOfType(current, "Identifier") || properties.shift() !== "current") return false;
  const symbol = proof.scopes.symbolFor(current);
  const initializer = symbol?.initializer && stripParenExpression(symbol.initializer);
  if (
    !symbol ||
    symbol === proof.cell ||
    symbol.kind !== "const" ||
    findEnclosingFunction(symbol.declarationNode) !== proof.component ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    !isProvenUnmodifiedReactApiCall(initializer, "useRef", proof.scopes) ||
    !hasCompleteSymbolReferences(symbol, proof.program, proof.scopes)
  )
    return false;
  const [initialValue, ...extra] = initializer.arguments;
  if (extra.length > 0 || (initialValue && !passiveLiteral(initialValue, proof.scopes)))
    return false;
  let isExternal = false;
  for (const reference of symbol.references) {
    if (isNonReferenceIdentifier(reference.identifier)) continue;
    if (reference.flag !== "read") return false;
    if (refPublication(reference.identifier, proof)) {
      isExternal = true;
      continue;
    }
    if (contextPublication(reference.identifier, proof)) continue;
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      getStaticPropertyName(member) !== "current"
    )
      return false;
    let value: EsTreeNode = member;
    while (isNodeOfType(findTransparentExpressionRoot(value).parent, "MemberExpression")) {
      const next: EsTreeNode | null | undefined = findTransparentExpressionRoot(value).parent;
      if (
        !isNodeOfType(next, "MemberExpression") ||
        stripParenExpression(next.object) !== stripParenExpression(value)
      )
        break;
      const name = getStaticPropertyName(next);
      if (name === null || TIMER_TOGGLE_REFUSED_MEMBER_NAMES.has(name)) return false;
      value = next;
    }
    if (isMemberMutationTarget(value)) return false;
    const terminal = findTransparentExpressionRoot(value);
    const consumer = terminal.parent;
    if (
      !isBooleanRead(value) &&
      !(
        isNodeOfType(consumer, "CallExpression") &&
        consumer.callee === terminal &&
        value !== member
      )
    )
      return false;
  }
  if (isExternal) return true;
  let value: EsTreeNode | null | undefined = initialValue;
  for (const property of properties) {
    if (!value) return false;
    value = getStaticObjectPropertyValue(value, property) ?? undefined;
  }
  return Boolean(
    value &&
    (isNodeOfType(stripParenExpression(value), "ObjectExpression") ||
      readConstantBoolean(value, proof.scopes) === true),
  );
};

const hasOrdinaryNativeProviders = (proof: TimerToggleProof): boolean => {
  let supported = true;
  walkAst(proof.program, (node) => {
    if (!supported) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment")
    ) {
      supported = false;
      return false;
    }
    const dependency = getRuntimeStaticDependencySource(node);
    if (dependency && TIMER_TOGGLE_REFUSED_MODULE_NAMES.has(dependency)) supported = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, proof.scopes);
      if (name !== null && TIMER_TOGGLE_REFUSED_MEMBER_NAMES.has(name)) supported = false;
      if (
        name !== null &&
        (TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(name) || TIMER_CLEANUP_CALLEE_NAMES.has(name))
      ) {
        const root = findTransparentExpressionRoot(node);
        const call = root.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== root ||
          call.optional ||
          !isGlobalBrowserFunctionCall(call, name, proof.scopes)
        )
          supported = false;
      }
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    const symbol = proof.scopes.symbolFor(node);
    if (!proof.scopes.isGlobalReference(node) && !(symbol && isErasedTypeScriptBinding(symbol)))
      return;
    if (TIMER_TOGGLE_REFUSED_GLOBAL_NAMES.has(node.name)) {
      supported = false;
      return;
    }
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (
      node.name === "setInterval" ||
      node.name === "setTimeout" ||
      node.name === "clearInterval" ||
      node.name === "clearTimeout"
    ) {
      if (!isNodeOfType(parent, "CallExpression") || parent.callee !== root || parent.optional) {
        supported = false;
      }
    } else if (TIMER_TOGGLE_GLOBAL_NAMESPACE_NAMES.has(node.name)) {
      if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root) {
        supported = false;
        return;
      }
      const name = getStaticPropertyName(parent);
      if (
        name === null ||
        TIMER_TOGGLE_GLOBAL_NAMESPACE_NAMES.has(name) ||
        TIMER_TOGGLE_REFUSED_GLOBAL_NAMES.has(name)
      ) {
        supported = false;
        return;
      }
      if (
        name === "setInterval" ||
        name === "setTimeout" ||
        name === "clearInterval" ||
        name === "clearTimeout"
      ) {
        const member = findTransparentExpressionRoot(parent);
        if (
          !isNodeOfType(member.parent, "CallExpression") ||
          member.parent.callee !== member ||
          member.parent.optional ||
          isMemberMutationTarget(parent)
        )
          supported = false;
      }
    }
  });
  return supported;
};

export const hasStoredNativeTimerToggleRisk = (
  clearCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const handler = findEnclosingFunction(clearCall);
  const component = handler && findEnclosingFunction(handler);
  const program = findProgramRoot(clearCall);
  if (
    !isFunctionLike(handler) ||
    handler.async ||
    handler.generator ||
    handler.params.length > 0 ||
    !isNodeOfType(handler.body, "BlockStatement") ||
    !component ||
    !program
  )
    return false;
  const activeStatement = (statement: EsTreeNode): boolean =>
    !isNodeOfType(statement, "EmptyStatement") &&
    !(
      isNodeOfType(statement, "ExpressionStatement") &&
      isLiteralVoidExpression(statement.expression)
    );
  const [guard, scheduling, ...tail] = handler.body.body.filter(activeStatement);
  if (
    tail.length > 0 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    !isNodeOfType(scheduling, "ExpressionStatement")
  )
    return false;
  const [clearing, terminal, ...branchTail] = guard.consequent.body.filter(activeStatement);
  if (
    branchTail.length > 0 ||
    !isNodeOfType(clearing, "ExpressionStatement") ||
    stripParenExpression(clearing.expression) !== clearCall ||
    !isNodeOfType(terminal, "ReturnStatement") ||
    terminal.argument
  )
    return false;
  const producer = stripParenExpression(scheduling.expression);
  if (!isNodeOfType(producer, "AssignmentExpression") || producer.operator !== "=") return false;
  const cell = currentCell(producer.left, context.scopes);
  const initializer = cell?.initializer && stripParenExpression(cell.initializer);
  if (
    !cell ||
    cell.kind !== "const" ||
    findEnclosingFunction(cell.declarationNode) !== component ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    !isProvenUnmodifiedReactApiCall(initializer, "useRef", context.scopes)
  ) {
    return false;
  }
  const [rawInitialValue, ...extraInitial] = initializer.arguments;
  const initialValue = rawInitialValue && stripParenExpression(rawInitialValue);
  if (
    extraInitial.length > 0 ||
    (initialValue &&
      !(isNodeOfType(initialValue, "Literal") && initialValue.value === null) &&
      !(
        isNodeOfType(initialValue, "Identifier") &&
        initialValue.name === "undefined" &&
        context.scopes.isGlobalReference(initialValue)
      ) &&
      !isLiteralVoidExpression(initialValue))
  )
    return false;
  const schedule = stripParenExpression(producer.right);
  if (
    !isNodeOfType(schedule, "CallExpression") ||
    schedule.optional ||
    !(
      isGlobalBrowserFunctionCall(schedule, "setInterval", context.scopes) ||
      isGlobalBrowserFunctionCall(schedule, "setTimeout", context.scopes)
    ) ||
    !nativeClear(clearCall, cell, context.scopes)
  )
    return false;
  const [callback, delay, ...extra] = schedule.arguments;
  const duration = delay && stripParenExpression(delay);
  if (
    !callback ||
    !isFunctionLike(stripParenExpression(callback)) ||
    !duration ||
    !isNodeOfType(duration, "Literal") ||
    typeof duration.value !== "number" ||
    !Number.isFinite(duration.value) ||
    duration.value < 0 ||
    extra.length > 0
  )
    return false;
  let test = stripParenExpression(guard.test);
  let readiness: EsTreeNode | null = null;
  if (isNodeOfType(test, "LogicalExpression") && test.operator === "||") {
    const right = stripParenExpression(test.right);
    if (!isNodeOfType(right, "UnaryExpression") || right.operator !== "!") return false;
    readiness = right.argument;
    test = stripParenExpression(test.left);
  }
  const readinessIdentifier = readiness && getRootIdentifier(readiness);
  const readinessSymbol = readinessIdentifier
    ? context.scopes.symbolFor(readinessIdentifier)
    : null;
  const proof: TimerToggleProof = {
    scopes: context.scopes,
    program,
    component,
    cell,
    producer,
    guard,
    readinessSymbol,
  };
  return (
    currentCell(test, context.scopes) === cell &&
    !hasReadinessOwnerBranch(proof) &&
    hasRepeatedEventUse(handler, proof) &&
    hasClosedSelectedCell(proof) &&
    hasOrdinaryNativeProviders(proof) &&
    (readiness === null || readinessCanBeTruthy(readiness, proof))
  );
};
