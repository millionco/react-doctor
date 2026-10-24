import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { ALL_EVENT_HANDLERS_LOWER } from "../../../constants/event-handlers.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { flattenLogicalAndChain } from "../../../utils/flatten-logical-and-chain.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasLexicalReceiverReference } from "../../../utils/has-lexical-receiver-reference.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isBooleanResultExpression } from "../../../utils/is-boolean-result-expression.js";
import { isComponentFunction } from "../../../utils/is-component-function.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isProvenGlobalObjectReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isUnmodifiedLocalReactStateCall } from "../../../utils/is-unmodified-local-react-state-call.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasCurrentContextRecordEnvironment } from "./has-current-context-record-environment.js";
import { hasOnlyEventHandlerInvocations } from "./has-only-event-handler-invocations.js";
import { hasRefNotificationReactCall } from "./has-ref-notification-react-call.js";
import {
  GENERATION_MASK_INITIAL_VALUE,
  GENERATION_MASK_INCREMENT_VALUE,
  GENERATION_MASK_INACTIVE_TAG_VALUE,
} from "./constants.js";

interface GenerationMaskProof {
  readonly context: RuleContext;
  readonly scopes: ScopeAnalysis;
  readonly program: EsTreeNode;
  readonly component: EsTreeNode;
  readonly setter: SymbolDescriptor;
  readonly tag: SymbolDescriptor;
  readonly generation: SymbolDescriptor;
  readonly masks: ReadonlySet<EsTreeNode>;
}

interface GenerationMarker {
  readonly dependency: SymbolDescriptor;
  readonly previous: SymbolDescriptor;
  readonly statement: EsTreeNode;
  readonly assignment: EsTreeNode;
}

const isBindingKey = (node: EsTreeNode, symbol: SymbolDescriptor): boolean => {
  const property = symbol.bindingIdentifier.parent;
  return (
    isNodeOfType(property, "Property") &&
    property.value === symbol.bindingIdentifier &&
    isNodeOfType(property.parent, "ObjectPattern") &&
    property.key === node
  );
};

const runtimeReferences = (symbol: SymbolDescriptor) =>
  symbol.references.filter(
    (reference) =>
      reference.identifier !== symbol.bindingIdentifier &&
      !isNonReferenceIdentifier(reference.identifier) &&
      !isBindingKey(reference.identifier, symbol),
  );

const isReadonly = (
  symbol: SymbolDescriptor,
  proof: Pick<GenerationMaskProof, "program" | "scopes">,
): boolean =>
  !isErasedTypeScriptBinding(symbol) &&
  hasCompleteSymbolReferences(symbol, proof.program, proof.scopes) &&
  [...getEquivalentSymbols(symbol.bindingIdentifier, proof.scopes)].every(
    (equivalent) => equivalent.bindingIdentifier === symbol.bindingIdentifier,
  ) &&
  runtimeReferences(symbol).every(
    (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
  );

const isBinding = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  proof: Pick<GenerationMaskProof, "scopes">,
): boolean => Boolean(isNodeOfType(node, "Identifier") && proof.scopes.symbolFor(node) === symbol);

const isLiteral = (node: EsTreeNode | null | undefined, value: boolean | number): boolean =>
  isNodeOfType(node, "Literal") && node.value === value;

const currentMember = (node: EsTreeNode): EsTreeNode | null => {
  const parent = node.parent;
  return isNodeOfType(parent, "MemberExpression") &&
    parent.object === node &&
    !parent.computed &&
    !parent.optional &&
    getStaticPropertyName(parent) === "current"
    ? parent
    : null;
};

const refSymbol = (
  member: EsTreeNode,
  proof: Pick<GenerationMaskProof, "context" | "scopes" | "program" | "component">,
): SymbolDescriptor | null => {
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    getStaticPropertyName(member) !== "current" ||
    !isNodeOfType(member.object, "Identifier")
  )
    return null;
  const symbol = proof.scopes.symbolFor(member.object);
  const declaration = symbol?.declarationNode;
  return symbol?.kind === "const" &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.id === symbol.bindingIdentifier &&
    findEnclosingFunction(declaration) === proof.component &&
    isNodeOfType(declaration.init, "CallExpression") &&
    declaration.init.arguments.length === 1 &&
    hasRefNotificationReactCall(declaration.init, "useRef", proof.context) &&
    isReadonly(symbol, proof)
    ? symbol
    : null;
};

const refInitializer = (symbol: SymbolDescriptor): EsTreeNode | null => {
  const declaration = symbol.declarationNode;
  return isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.init, "CallExpression")
    ? (declaration.init.arguments[0] ?? null)
    : null;
};

const isInactiveTag = (symbol: SymbolDescriptor): boolean => {
  const initial = refInitializer(symbol);
  return (
    isNodeOfType(initial, "UnaryExpression") &&
    initial.operator === "-" &&
    isLiteral(initial.argument, -GENERATION_MASK_INACTIVE_TAG_VALUE)
  );
};

const isCompatibleType = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  if (
    isNodeOfType(node, "TSStringKeyword") ||
    isNodeOfType(node, "TSBooleanKeyword") ||
    isNodeOfType(node, "TSUndefinedKeyword") ||
    isNodeOfType(node, "TSFunctionType")
  )
    return true;
  if (isNodeOfType(node, "TSLiteralType"))
    return isNodeOfType(node.literal, "Literal") && typeof node.literal.value === "string";
  return isNodeOfType(node, "TSUnionType") && node.types.every(isCompatibleType);
};

const ownParameterType = (
  symbol: SymbolDescriptor,
  proof: Pick<GenerationMaskProof, "component" | "program">,
): EsTreeNode | null => {
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.value !== symbol.bindingIdentifier ||
    !isNodeOfType(property.key, "Identifier") ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    !isFunctionLike(proof.component) ||
    proof.component.params[0] !== pattern ||
    proof.component.typeParameters ||
    pattern.properties.some(
      (entry) =>
        !isNodeOfType(entry, "Property") ||
        entry.computed ||
        !isNodeOfType(entry.key, "Identifier") ||
        !isNodeOfType(entry.value, "Identifier"),
    )
  )
    return null;
  const direct = getSymbolTypeAnnotation(symbol);
  if (direct) return direct;
  const annotation = pattern.typeAnnotation?.typeAnnotation;
  if (
    !isNodeOfType(annotation, "TSTypeReference") ||
    annotation.typeArguments ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    !isNodeOfType(proof.program, "Program")
  )
    return null;
  const typeName = annotation.typeName.name;
  const matching: EsTreeNode[] = [];
  walkAst(proof.program, (node) => {
    if (
      (isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "TSTypeAliasDeclaration") ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression") ||
        isNodeOfType(node, "FunctionDeclaration") ||
        isNodeOfType(node, "FunctionExpression") ||
        isNodeOfType(node, "TSDeclareFunction") ||
        isNodeOfType(node, "TSModuleDeclaration") ||
        isNodeOfType(node, "TSEnumDeclaration") ||
        isNodeOfType(node, "TSImportEqualsDeclaration")) &&
      isNodeOfType(node.id, "Identifier") &&
      node.id.name === typeName
    )
      matching.push(node);
    if (
      (isNodeOfType(node, "ImportSpecifier") ||
        isNodeOfType(node, "ImportDefaultSpecifier") ||
        isNodeOfType(node, "ImportNamespaceSpecifier")) &&
      node.local.name === typeName
    )
      matching.push(node);
    if (
      (isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression")) &&
      node.typeParameters?.params.some((parameter) => parameter.name.name === typeName)
    )
      matching.push(node);
  });
  const [declaration, ...others] = matching;
  if (
    others.length ||
    !isNodeOfType(declaration, "TSInterfaceDeclaration") ||
    declaration.declare ||
    declaration.typeParameters ||
    declaration.extends.length ||
    declaration.parent !== proof.program
  )
    return null;
  const propertyName = property.key.name;
  const members = declaration.body.body.filter(
    (entry) =>
      isNodeOfType(entry, "TSPropertySignature") &&
      !entry.computed &&
      isNodeOfType(entry.key, "Identifier") &&
      entry.key.name === propertyName,
  );
  const [member, ...duplicates] = members;
  return !duplicates.length && isNodeOfType(member, "TSPropertySignature")
    ? (member.typeAnnotation?.typeAnnotation ?? null)
    : null;
};

const hasCompatibleDependency = (
  symbol: SymbolDescriptor,
  proof: Pick<GenerationMaskProof, "component" | "program" | "scopes">,
): boolean => {
  if (!isReadonly(symbol, proof)) return false;
  const declaration = symbol.declarationNode;
  if (
    symbol.kind === "const" &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.id === symbol.bindingIdentifier &&
    findEnclosingFunction(declaration) === proof.component &&
    declaration.init &&
    isBooleanResultExpression(declaration.init)
  )
    return true;
  return isCompatibleType(ownParameterType(symbol, proof));
};

const expressionStatement = (node: EsTreeNode | null | undefined): EsTreeNode | null =>
  isNodeOfType(node, "ExpressionStatement") ? node.expression : null;

const topStatement = (node: EsTreeNode, body: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current?.parent && current.parent !== body) current = current.parent;
  return current?.parent === body ? current : null;
};

const hasPassiveCondition = (expression: EsTreeNode): boolean => {
  let passive = true;
  walkAst(expression, (node) => {
    if (
      isFunctionLike(node) ||
      isNodeOfType(node, "CallExpression") ||
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      isNodeOfType(node, "AwaitExpression") ||
      isNodeOfType(node, "YieldExpression") ||
      isNodeOfType(node, "SequenceExpression")
    )
      passive = false;
    return passive ? undefined : false;
  });
  return passive;
};

const hasNoTransfer = (node: EsTreeNode): boolean => {
  let closed = true;
  walkAst(node, (child) => {
    if (
      isFunctionLike(child) ||
      isNodeOfType(child, "ReturnStatement") ||
      isNodeOfType(child, "ThrowStatement") ||
      isNodeOfType(child, "BreakStatement") ||
      isNodeOfType(child, "ContinueStatement") ||
      isNodeOfType(child, "AwaitExpression") ||
      isNodeOfType(child, "YieldExpression")
    )
      closed = false;
    return closed ? undefined : false;
  });
  return closed;
};

const hasClosedRefReads = (
  symbol: SymbolDescriptor,
  allowedWrites: ReadonlySet<EsTreeNode>,
  proof: GenerationMaskProof,
): boolean =>
  isReadonly(symbol, proof) &&
  runtimeReferences(symbol).every((reference) => {
    const member = currentMember(reference.identifier);
    if (!member) return false;
    return !isWithinAssignmentTarget(member) || allowedWrites.has(member);
  });

const markerFor = (
  statement: EsTreeNode,
  dependencies: ReadonlySet<SymbolDescriptor>,
  accumulator: SymbolDescriptor,
  proof: GenerationMaskProof,
): GenerationMarker | null => {
  if (
    !isNodeOfType(statement, "IfStatement") ||
    statement.alternate ||
    !isNodeOfType(statement.test, "BinaryExpression") ||
    statement.test.operator !== "!==" ||
    !isNodeOfType(statement.test.right, "Identifier") ||
    !isNodeOfType(statement.consequent, "BlockStatement")
  )
    return null;
  const dependency = proof.scopes.symbolFor(statement.test.right);
  const previous = refSymbol(statement.test.left, proof);
  if (
    !dependency ||
    !dependencies.has(dependency) ||
    !previous ||
    !isBinding(refInitializer(previous), dependency, proof) ||
    !hasNoTransfer(statement.consequent)
  )
    return null;
  const first = expressionStatement(statement.consequent.body[0]);
  const last = expressionStatement(statement.consequent.body.at(-1));
  if (
    !isNodeOfType(first, "AssignmentExpression") ||
    first.operator !== "=" ||
    !isBinding(first.left, accumulator, proof) ||
    !isLiteral(first.right, true) ||
    !isNodeOfType(last, "AssignmentExpression") ||
    last.operator !== "=" ||
    !isNodeOfType(last.left, "MemberExpression") ||
    refSymbol(last.left, proof) !== previous ||
    !isBinding(last.right, dependency, proof)
  )
    return null;
  return { dependency, previous, statement, assignment: last.left };
};

const hasInvalidation = (
  dependencies: ReadonlySet<SymbolDescriptor>,
  proof: GenerationMaskProof,
): boolean => {
  if (!isFunctionLike(proof.component) || !isNodeOfType(proof.component.body, "BlockStatement"))
    return false;
  const componentBody = proof.component.body;
  const writes = runtimeReferences(proof.generation)
    .map((reference) => currentMember(reference.identifier))
    .filter((member) => member && isWithinAssignmentTarget(member));
  const [incrementMember, ...otherWrites] = writes;
  const increment = incrementMember?.parent;
  if (
    otherWrites.length ||
    !isNodeOfType(increment, "AssignmentExpression") ||
    increment.operator !== "+=" ||
    increment.left !== incrementMember ||
    !isLiteral(increment.right, GENERATION_MASK_INCREMENT_VALUE)
  )
    return false;
  const incrementStatement = increment.parent;
  const branch = incrementStatement?.parent;
  const guard = branch?.parent;
  const block = guard?.parent;
  if (
    !isNodeOfType(incrementStatement, "ExpressionStatement") ||
    !isNodeOfType(branch, "BlockStatement") ||
    branch.body[0] !== incrementStatement ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== branch ||
    guard.alternate ||
    !isNodeOfType(guard.test, "Identifier") ||
    !isNodeOfType(block, "BlockStatement") ||
    block.parent !== componentBody ||
    block.body.at(-1) !== guard
  )
    return false;
  const accumulator = proof.scopes.symbolFor(guard.test);
  const declaration = accumulator?.declarationNode;
  if (
    !accumulator ||
    accumulator.kind !== "let" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isLiteral(declaration.init, false) ||
    declaration.id !== accumulator.bindingIdentifier ||
    declaration.parent?.parent !== block ||
    !hasCompleteSymbolReferences(accumulator, proof.program, proof.scopes)
  )
    return false;
  const markers = block.body
    .filter((statement) => statement !== guard && !isNodeOfType(statement, "VariableDeclaration"))
    .map((statement) => markerFor(statement, dependencies, accumulator, proof));
  if (markers.some((marker) => marker === null) || markers.length !== dependencies.size)
    return false;
  const validMarkers = markers.filter((marker): marker is GenerationMarker => marker !== null);
  if (
    new Set(validMarkers.map((marker) => marker.dependency)).size !== dependencies.size ||
    new Set(validMarkers.map((marker) => marker.previous)).size !== dependencies.size
  )
    return false;
  for (const reference of runtimeReferences(accumulator)) {
    if (reference.identifier === guard.test) continue;
    const assignment = reference.identifier.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.left !== reference.identifier ||
      assignment.operator !== "=" ||
      !isLiteral(assignment.right, true) ||
      !validMarkers.some((marker) => topStatement(assignment, block) === marker.statement)
    )
      return false;
  }
  for (const marker of validMarkers) {
    if (
      !hasClosedRefReads(marker.previous, new Set([marker.assignment]), proof) ||
      !runtimeReferences(marker.previous).every(
        (reference) => topStatement(reference.identifier, block) === marker.statement,
      )
    )
      return false;
  }
  const blockIndex = componentBody.body.findIndex((statement) => statement === block);
  return (
    blockIndex >= 0 &&
    [...proof.masks].every((mask) => {
      const statement = topStatement(mask, componentBody);
      return (
        statement !== null &&
        componentBody.body.findIndex((entry) => entry === statement) > blockIndex &&
        findEnclosingFunction(mask) === proof.component
      );
    })
  );
};

const nativeJsxValuePath = (node: EsTreeNode, owner: EsTreeNode): boolean => {
  let current: EsTreeNode = findTransparentExpressionRoot(node);
  while (current.parent) {
    if (isNodeOfType(current, "JSXElement")) {
      const opening = current.openingElement;
      if (
        !isNodeOfType(opening.name, "JSXIdentifier") ||
        !/^[a-z]+$/.test(opening.name.name) ||
        opening.attributes.some(
          (attribute) =>
            isNodeOfType(attribute, "JSXSpreadAttribute") ||
            (isNodeOfType(attribute, "JSXAttribute") &&
              isNodeOfType(attribute.name, "JSXIdentifier") &&
              ["ref", "is", "dangerouslySetInnerHTML"].includes(attribute.name.name)),
        )
      )
        return false;
    }
    const parent: EsTreeNode = current.parent;
    if (isNodeOfType(parent, "ReturnStatement"))
      return parent.argument === current && findEnclosingFunction(parent) === owner;
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === current
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "JSXExpressionContainer") &&
      parent.expression === current &&
      (isNodeOfType(parent.parent, "JSXElement") || isNodeOfType(parent.parent, "JSXFragment"))
    ) {
      current = parent.parent;
      continue;
    }
    if (
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      parent.children.some((child) => child === current)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return false;
};

const hasClosedRenderOwner = (owner: EsTreeNode | null, proof: GenerationMaskProof): boolean => {
  if (owner === proof.component) return true;
  if (
    !isNodeOfType(owner, "ArrowFunctionExpression") ||
    owner.async ||
    owner.params.length ||
    findEnclosingFunction(owner) !== proof.component ||
    hasLexicalReceiverReference(owner, proof.scopes)
  )
    return false;
  const identifier = getFunctionBindingIdentifier(owner);
  const symbol = identifier && proof.scopes.symbolFor(identifier);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isReadonly(symbol, proof) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.init !== owner
  )
    return false;
  const references = runtimeReferences(symbol);
  return (
    references.length > 0 &&
    references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      const call = root.parent;
      return (
        isNodeOfType(call, "CallExpression") &&
        call.callee === root &&
        !call.optional &&
        call.arguments.length === 0 &&
        findEnclosingFunction(call) === proof.component &&
        nativeJsxValuePath(call, proof.component)
      );
    })
  );
};

const isNativeEventUse = (
  owner: EsTreeNode | null,
  identifier: EsTreeNode,
  proof: GenerationMaskProof,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = identifier.parent;
  while (ancestor && !isNodeOfType(ancestor, "JSXAttribute") && !isFunctionLike(ancestor))
    ancestor = ancestor.parent;
  const opening = ancestor?.parent;
  if (
    !isNodeOfType(ancestor, "JSXAttribute") ||
    !isNodeOfType(ancestor.name, "JSXIdentifier") ||
    !ALL_EVENT_HANDLERS_LOWER.has(ancestor.name.name.toLowerCase()) ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.parent, "JSXElement") ||
    !owner ||
    !hasClosedRenderOwner(owner, proof)
  )
    return false;
  return nativeJsxValuePath(opening.parent, owner);
};

const hasPassiveEpochPrelude = (statement: EsTreeNode, proof: GenerationMaskProof): boolean => {
  let passive = true;
  walkAst(statement, (node) => {
    if (!passive || isFunctionLike(node)) return false;
    if (
      (isNodeOfType(node, "Identifier") &&
        !isNonReferenceIdentifier(node) &&
        proof.scopes.isGlobalReference(node) &&
        !(
          node.name === "AbortController" &&
          isNodeOfType(node.parent, "NewExpression") &&
          node.parent.callee === node
        )) ||
      (isNodeOfType(node, "VariableDeclarator") && !isNodeOfType(node.id, "Identifier")) ||
      (isNodeOfType(node, "UnaryExpression") && node.operator !== "!") ||
      (isNodeOfType(node, "BinaryExpression") &&
        node.operator !== "===" &&
        node.operator !== "!==") ||
      (isNodeOfType(node, "AssignmentExpression") && node.operator !== "=") ||
      isNodeOfType(node, "JSXElement") ||
      isNodeOfType(node, "JSXFragment") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "SpreadElement") ||
      isNodeOfType(node, "ObjectPattern") ||
      isNodeOfType(node, "ArrayPattern") ||
      isNodeOfType(node, "AssignmentPattern") ||
      isNodeOfType(node, "ObjectExpression") ||
      isNodeOfType(node, "ArrayExpression") ||
      isNodeOfType(node, "TemplateLiteral") ||
      isNodeOfType(node, "SequenceExpression") ||
      isNodeOfType(node, "ForInStatement") ||
      isNodeOfType(node, "ForOfStatement") ||
      isNodeOfType(node, "ForStatement") ||
      isNodeOfType(node, "WhileStatement") ||
      isNodeOfType(node, "DoWhileStatement") ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression")
    ) {
      passive = false;
      return false;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const symbol = refSymbol(node, proof);
      if (
        !symbol ||
        !runtimeReferences(symbol).every((reference) => {
          const member = currentMember(reference.identifier);
          if (!member) return false;
          if (!isWithinAssignmentTarget(member)) return true;
          const mutation = member.parent;
          return (
            (isNodeOfType(mutation, "AssignmentExpression") &&
              mutation.operator === "=" &&
              mutation.left === member) ||
            (isNodeOfType(mutation, "UpdateExpression") &&
              mutation.operator === "++" &&
              mutation.argument === member)
          );
        })
      )
        passive = false;
    }
    if (isNodeOfType(node, "UpdateExpression")) {
      const symbol = refSymbol(node.argument, proof);
      if (
        node.operator !== "++" ||
        !symbol ||
        !isLiteral(refInitializer(symbol), GENERATION_MASK_INITIAL_VALUE) ||
        !runtimeReferences(symbol).every((reference) => {
          const member = currentMember(reference.identifier);
          if (!member) return false;
          if (!isWithinAssignmentTarget(member)) return true;
          const update = member.parent;
          return (
            isNodeOfType(update, "UpdateExpression") &&
            update.operator === "++" &&
            update.argument === member
          );
        })
      )
        passive = false;
    }
  });
  return passive;
};

const capturedEpoch = (
  value: EsTreeNode,
  activation: EsTreeNode,
  proof: GenerationMaskProof,
): boolean => {
  if (
    !isNodeOfType(value, "Identifier") ||
    !isNodeOfType(activation, "ArrowFunctionExpression") ||
    activation.async ||
    !isNodeOfType(activation.body, "BlockStatement")
  )
    return false;
  const symbol = proof.scopes.symbolFor(value);
  const declaration = symbol?.declarationNode;
  const declarationStatement = declaration?.parent;
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isReadonly(symbol, proof) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier ||
    !isNodeOfType(declaration.init, "MemberExpression") ||
    refSymbol(declaration.init, proof) !== proof.generation ||
    !isNodeOfType(declarationStatement, "VariableDeclaration") ||
    declarationStatement.declarations.length !== 1 ||
    declarationStatement.parent !== activation.body
  )
    return false;
  const index = activation.body.body.findIndex((statement) => statement === declarationStatement);
  if (index < 0) return false;
  let foreignBeforeCapture = false;
  let hasAbortConstruction = false;
  for (const statement of activation.body.body.slice(0, index)) {
    if (!hasPassiveEpochPrelude(statement, proof)) foreignBeforeCapture = true;
    walkAst(statement, (node) => {
      if (isFunctionLike(node)) return false;
      if (
        isNodeOfType(node, "CallExpression") ||
        isNodeOfType(node, "TaggedTemplateExpression") ||
        isNodeOfType(node, "AwaitExpression") ||
        isNodeOfType(node, "YieldExpression")
      )
        foreignBeforeCapture = true;
      if (isNodeOfType(node, "NewExpression")) {
        if (
          !isNodeOfType(node.callee, "Identifier") ||
          node.callee.name !== "AbortController" ||
          !proof.scopes.isGlobalReference(node.callee) ||
          node.arguments.length
        )
          foreignBeforeCapture = true;
        else hasAbortConstruction = true;
      }
    });
  }
  if (hasAbortConstruction) {
    walkAst(proof.program, (node) => {
      if (isProvenGlobalObjectReference(node, proof.scopes)) foreignBeforeCapture = true;
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "AbortController" &&
        !isNonReferenceIdentifier(node)
      ) {
        const construction = node.parent;
        if (
          !proof.scopes.isGlobalReference(node) ||
          !isNodeOfType(construction, "NewExpression") ||
          construction.callee !== node ||
          construction.arguments.length
        )
          foreignBeforeCapture = true;
      }
    });
  }
  const writerStatement = topStatement(value, activation.body);
  return (
    !foreignBeforeCapture &&
    writerStatement !== null &&
    activation.body.body.findIndex((statement) => statement === writerStatement) > index
  );
};

const hasClosedWriters = (proof: GenerationMaskProof): boolean => {
  if (!isReadonly(proof.setter, proof)) return false;
  const allowedTagWrites = new Set<EsTreeNode>();
  let trueWriters = 0;
  for (const reference of runtimeReferences(proof.setter)) {
    const call = reference.identifier.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== reference.identifier ||
      call.optional ||
      call.arguments.length !== 1
    )
      return false;
    const value = call.arguments[0];
    if (isLiteral(value, false)) continue;
    if (!isLiteral(value, true)) return false;
    trueWriters += 1;
    const activation = findEnclosingFunction(call);
    if (
      !isNodeOfType(activation, "ArrowFunctionExpression") ||
      activation.async ||
      !hasOnlyEventHandlerInvocations(activation, {
        ...proof,
        isReadonlyBinding: (symbol) => isReadonly(symbol, proof),
        isEventOwner: (owner, identifier) => isNativeEventUse(owner, identifier, proof),
      })
    )
      return false;
    const statement = call.parent;
    const block = statement?.parent;
    if (!isNodeOfType(statement, "ExpressionStatement") || !isNodeOfType(block, "BlockStatement"))
      return false;
    const next = expressionStatement(
      block.body[block.body.findIndex((entry) => entry === statement) + 1],
    );
    if (
      !isNodeOfType(next, "AssignmentExpression") ||
      next.operator !== "=" ||
      !isNodeOfType(next.left, "MemberExpression") ||
      refSymbol(next.left, proof) !== proof.tag ||
      !capturedEpoch(next.right, activation, proof)
    )
      return false;
    allowedTagWrites.add(next.left);
  }
  if (!trueWriters || !hasClosedRefReads(proof.tag, allowedTagWrites, proof)) return false;
  return runtimeReferences(proof.tag).every((reference) => {
    const member = currentMember(reference.identifier);
    if (!member) return false;
    if (allowedTagWrites.has(member)) return true;
    return proof.masks.has(member.parent ?? member);
  });
};

export const isGenerationMaskedBooleanReset = (
  write: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(write, "CallExpression") ||
    write.optional ||
    write.arguments.length !== 1 ||
    !isLiteral(write.arguments[0], false) ||
    !context.filename
  )
    return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  const stateCall = pair?.declarator.init;
  const component = pair && findEnclosingFunction(pair.declarator);
  const program = findProgramRoot(write);
  if (
    !pair?.stateSymbol ||
    pair.stateSymbol.kind !== "const" ||
    pair.setterSymbol.kind !== "const" ||
    !isNodeOfType(pair.declarator.id, "ArrayPattern") ||
    pair.declarator.id.elements.length !== 2 ||
    pair.declarator.id.elements[0] !== pair.stateSymbol.bindingIdentifier ||
    pair.declarator.id.elements[1] !== pair.setterSymbol.bindingIdentifier ||
    !isNodeOfType(stateCall, "CallExpression") ||
    stateCall.arguments.length !== 1 ||
    !isLiteral(stateCall.arguments[0], false) ||
    !component ||
    !isComponentFunction(component) ||
    !program ||
    !isFunctionLike(component) ||
    !isNodeOfType(component.body, "BlockStatement") ||
    !hasRefNotificationReactCall(stateCall, "useState", context) ||
    !isUnmodifiedLocalReactStateCall(stateCall, context.scopes, { allowDataOperations: true }) ||
    !hasCurrentContextRecordEnvironment(context.filename)
  )
    return false;
  const baseProof = { context, scopes: context.scopes, program, component };
  const effect = findEnclosingFunction(write);
  const effectCall = effect && findTransparentExpressionRoot(effect).parent;
  if (
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    effect.async ||
    effect.params.length ||
    findEnclosingFunction(effect) !== component ||
    !isNodeOfType(effectCall, "CallExpression") ||
    effectCall.arguments.length !== 2 ||
    effectCall.arguments[0] !== effect ||
    !hasRefNotificationReactCall(effectCall, "useEffect", context) ||
    !isNodeOfType(effectCall.arguments[1], "ArrayExpression")
  )
    return false;
  const dependencies = new Set<SymbolDescriptor>();
  for (const element of effectCall.arguments[1].elements) {
    const symbol = isNodeOfType(element, "Identifier") ? context.scopes.symbolFor(element) : null;
    if (!symbol || dependencies.has(symbol) || !hasCompatibleDependency(symbol, baseProof))
      return false;
    dependencies.add(symbol);
  }
  if (!dependencies.size || !isReadonly(pair.stateSymbol, baseProof)) return false;
  let tag: SymbolDescriptor | null = null;
  let generation: SymbolDescriptor | null = null;
  const masks = new Set<EsTreeNode>();
  for (const reference of runtimeReferences(pair.stateSymbol)) {
    let root: EsTreeNode = reference.identifier;
    while (isNodeOfType(root.parent, "LogicalExpression") && root.parent.operator === "&&")
      root = root.parent;
    const declaration = root.parent;
    const symbol =
      isNodeOfType(declaration, "VariableDeclarator") && isNodeOfType(declaration.id, "Identifier")
        ? context.scopes.symbolFor(declaration.id)
        : null;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isReadonly(symbol, baseProof) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== root ||
      findEnclosingFunction(declaration) !== component ||
      !hasPassiveCondition(root)
    )
      return false;
    const operands = flattenLogicalAndChain(root);
    const comparisons = operands.filter(
      (operand) => isNodeOfType(operand, "BinaryExpression") && operand.operator === "===",
    );
    let matched = false;
    for (const comparison of comparisons) {
      if (!isNodeOfType(comparison, "BinaryExpression")) continue;
      const left = refSymbol(comparison.left, baseProof);
      const right = refSymbol(comparison.right, baseProof);
      let candidateTag: SymbolDescriptor | null = null;
      if (left && right) {
        if (isInactiveTag(left)) candidateTag = left;
        else if (isInactiveTag(right)) candidateTag = right;
      }
      const candidateGeneration = candidateTag === left ? right : left;
      if (
        !candidateTag ||
        !candidateGeneration ||
        !isLiteral(refInitializer(candidateGeneration), GENERATION_MASK_INITIAL_VALUE)
      )
        continue;
      if ((tag && tag !== candidateTag) || (generation && generation !== candidateGeneration))
        return false;
      tag = candidateTag;
      generation = candidateGeneration;
      masks.add(comparison);
      matched = true;
    }
    if (!matched) return false;
  }
  if (!tag || !generation || !masks.size) return false;
  const proof: GenerationMaskProof = {
    ...baseProof,
    setter: pair.setterSymbol,
    tag,
    generation,
    masks,
  };
  return (
    hasClosedRefReads(
      generation,
      new Set(
        runtimeReferences(generation)
          .map((reference) => currentMember(reference.identifier))
          .filter(
            (member): member is EsTreeNode => member !== null && isWithinAssignmentTarget(member),
          ),
      ),
      proof,
    ) &&
    hasInvalidation(dependencies, proof) &&
    hasClosedWriters(proof)
  );
};
