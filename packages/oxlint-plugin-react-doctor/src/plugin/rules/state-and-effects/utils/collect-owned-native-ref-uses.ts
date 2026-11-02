import { isEventHandlerName } from "./event-handler-reference.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "../../../utils/has-symbol-binding-writes.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  OWNED_NATIVE_REF_RESERVED_ATTRIBUTES,
  OWNED_NATIVE_REF_SINGLE_VALUE_COUNT,
  OWNED_NATIVE_REF_MINIMUM_CHILD_INDEX,
  OWNED_NATIVE_REF_CALLBACK_RECEIVER_TYPES,
} from "./constants.js";
import { isReadonlyNativeSnapshot } from "./is-readonly-native-snapshot.js";

export interface OwnedNativeRefUses {
  readonly nativeRefs: ReadonlySet<SymbolDescriptor>;
  readonly approvedNativeUseNodes: ReadonlySet<EsTreeNode>;
}

export interface CollectOwnedNativeRefUsesInput {
  readonly module: SourceProjectModule;
  readonly resolveHostName: (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
    module: SourceProjectModule,
  ) => string | null;
}

const isBooleanRead = (raw: EsTreeNode): boolean => {
  const node = findTransparentExpressionRoot(raw);
  const parent = node.parent;
  if (
    isNodeOfType(parent, "UnaryExpression") &&
    (parent.operator === "!" || parent.operator === "typeof")
  )
    return true;
  if (
    isNodeOfType(parent, "BinaryExpression") &&
    (parent.operator === "===" || parent.operator === "!==")
  )
    return true;
  if (
    (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
    parent.test === node
  )
    return true;
  return isNodeOfType(parent, "LogicalExpression") && isBooleanRead(parent);
};

const isClosedPublicationEvent = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  module: SourceProjectModule,
): boolean => {
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const value = stripParenExpression(attribute.value.expression);
  const callbackSymbol = isNodeOfType(value, "Identifier") ? module.scopes.symbolFor(value) : null;
  const initializer = callbackSymbol ? getDirectConstInitializer(callbackSymbol) : null;
  const callback = initializer
    ? stripParenExpression(initializer)
    : callbackSymbol?.kind === "function"
      ? callbackSymbol.declarationNode
      : value;
  if (!isFunctionLike(callback) || callback.async || callback.generator || callback.params.length)
    return false;
  if (callbackSymbol) {
    const bindings = getFunctionBindingSymbols(callback, module.scopes);
    if (
      !bindings.includes(callbackSymbol) ||
      bindings.some(
        (binding) =>
          hasSymbolBindingWrites(binding) ||
          !hasCompleteSymbolReferences(binding, module.programNode, module.scopes) ||
          binding.references.some((reference) => {
            const root = findTransparentExpressionRoot(reference.identifier);
            const container = root.parent;
            const use = container?.parent;
            return (
              !isNodeOfType(container, "JSXExpressionContainer") ||
              container.expression !== root ||
              !isNodeOfType(use, "JSXAttribute") ||
              use.parent !== opening ||
              !isEventHandlerName(getJsxAttributeName(use.name) ?? "")
            );
          }),
      )
    )
      return false;
  }
  let closed = true;
  walkAst(callback, (node) => {
    if (OWNED_NATIVE_REF_CALLBACK_RECEIVER_TYPES.has(node.type)) closed = false;
    if (
      isNodeOfType(node, "Identifier") &&
      !isNonReferenceIdentifier(node) &&
      module.scopes.referenceFor(node) &&
      (node.name === "arguments" ||
        (node.name === "event" && module.scopes.isGlobalReference(node)))
    )
      closed = false;
  });
  return closed;
};

const isCleanPublication = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  module: SourceProjectModule,
): boolean => {
  const names = new Set<string>();
  return opening.attributes.every((attribute) => {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    if (!name || names.has(name) || OWNED_NATIVE_REF_RESERVED_ATTRIBUTES.has(name)) return false;
    names.add(name);
    return !isEventHandlerName(name) || isClosedPublicationEvent(attribute, opening, module);
  });
};

const isReturnedPublication = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  owner: EsTreeNode,
  input: CollectOwnedNativeRefUsesInput,
): boolean => {
  let current: EsTreeNode = opening;
  if (!isNodeOfType(current.parent, "JSXElement") || current.parent.openingElement !== current)
    return false;
  current = current.parent;
  while (current.parent) {
    const root = findTransparentExpressionRoot(current);
    const parent = root.parent;
    if (
      isNodeOfType(parent, "ReturnStatement") &&
      parent.argument === root &&
      findEnclosingFunction(parent) === owner
    )
      return isNodeOfType(parent.parent, "BlockStatement") && parent.parent.parent === owner;
    if (isNodeOfType(owner, "ArrowFunctionExpression") && owner.body === root) return true;
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === root || parent.alternate === root)
    ) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === root) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === root) {
      const container = parent.parent;
      if (
        (!isNodeOfType(container, "JSXElement") && !isNodeOfType(container, "JSXFragment")) ||
        !container.children.some((child) => child === parent)
      )
        return false;
      current = parent;
      continue;
    }
    if (
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      parent.children.some((child) => child === root)
    ) {
      if (
        isNodeOfType(parent, "JSXElement") &&
        (!input.resolveHostName(parent.openingElement, input.module) ||
          !isCleanPublication(parent.openingElement, input.module))
      )
        return false;
      current = parent;
      continue;
    }
    return false;
  }
  return false;
};

const hasKnownNonNumericIndexSource = (
  raw: EsTreeNode,
  module: SourceProjectModule,
  seen = new Set<SymbolDescriptor>(),
): boolean => {
  const node = stripParenExpression(raw);
  if (isNodeOfType(node, "Literal"))
    return typeof node.value !== "number" || !Number.isFinite(node.value);
  if (
    isNodeOfType(node, "TemplateLiteral") ||
    isNodeOfType(node, "SequenceExpression") ||
    isNodeOfType(node, "ObjectExpression") ||
    isNodeOfType(node, "ArrayExpression") ||
    isFunctionLike(node) ||
    isNodeOfType(node, "NewExpression") ||
    isNodeOfType(node, "AssignmentExpression") ||
    isNodeOfType(node, "AssignmentPattern") ||
    isNodeOfType(node, "AwaitExpression") ||
    isNodeOfType(node, "YieldExpression") ||
    isNodeOfType(node, "TaggedTemplateExpression")
  )
    return true;
  if (isNodeOfType(node, "Identifier")) {
    if (
      module.scopes.isGlobalReference(node) &&
      (node.name === "undefined" || node.name === "NaN" || node.name === "Infinity")
    )
      return true;
    const symbol = module.scopes.symbolFor(node);
    if (!symbol) return false;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return false;
    if (
      seen.has(symbol) ||
      hasSymbolBindingWrites(symbol) ||
      !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes)
    )
      return true;
    return hasKnownNonNumericIndexSource(initializer, module, new Set([...seen, symbol]));
  }
  if (isNodeOfType(node, "UnaryExpression"))
    return (
      (node.operator !== "+" && node.operator !== "-") ||
      hasKnownNonNumericIndexSource(node.argument, module, seen)
    );
  if (isNodeOfType(node, "BinaryExpression"))
    return (
      !["+", "-", "*", "/", "%", "**", "<<", ">>", ">>>", "|", "&", "^"].includes(node.operator) ||
      hasKnownNonNumericIndexSource(node.left, module, seen) ||
      hasKnownNonNumericIndexSource(node.right, module, seen)
    );
  if (isNodeOfType(node, "ConditionalExpression"))
    return (
      hasKnownNonNumericIndexSource(node.consequent, module, seen) ||
      hasKnownNonNumericIndexSource(node.alternate, module, seen)
    );
  if (isNodeOfType(node, "LogicalExpression"))
    return (
      hasKnownNonNumericIndexSource(node.left, module, seen) ||
      hasKnownNonNumericIndexSource(node.right, module, seen)
    );
  return false;
};

const hasClosedIndexSetterWrites = (
  declaration: EsTreeNodeOfType<"VariableDeclarator">,
  module: SourceProjectModule,
): boolean => {
  if (!isNodeOfType(declaration.id, "ArrayPattern")) return false;
  const [, setterIdentifier] = declaration.id.elements;
  if (!isNodeOfType(setterIdentifier, "Identifier")) return false;
  const setter = module.scopes.symbolFor(setterIdentifier);
  if (
    !setter ||
    hasSymbolBindingWrites(setter) ||
    !hasCompleteSymbolReferences(setter, module.programNode, module.scopes)
  )
    return false;
  return setter.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== root || call.optional)
      return false;
    const [argument, ...extra] = call.arguments;
    return Boolean(
      argument &&
      !extra.length &&
      !isNodeOfType(argument, "SpreadElement") &&
      !hasKnownNonNumericIndexSource(argument, module),
    );
  });
};

const isReadonlyIndex = (
  raw: EsTreeNode,
  module: SourceProjectModule,
  seen = new Set<SymbolDescriptor>(),
): boolean => {
  const node = stripParenExpression(raw);
  if (isNodeOfType(node, "Literal"))
    return (
      typeof node.value === "number" &&
      Number.isFinite(node.value) &&
      Number.isInteger(node.value) &&
      node.value >= OWNED_NATIVE_REF_MINIMUM_CHILD_INDEX
    );
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = module.scopes.symbolFor(node);
  if (
    !symbol ||
    seen.has(symbol) ||
    hasSymbolBindingWrites(symbol) ||
    !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) ||
    !findEnclosingFunction(symbol.declarationNode)
  )
    return false;
  if (symbol.kind !== "const") return false;
  const declaration = symbol.declarationNode;
  if (
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.id, "ArrayPattern")
  ) {
    const [value] = declaration.id.elements;
    const initializer = declaration.init ? stripParenExpression(declaration.init) : null;
    return (
      value === symbol.bindingIdentifier &&
      Boolean(
        initializer &&
        isNodeOfType(initializer, "CallExpression") &&
        isProvenUnmodifiedReactApiCall(initializer, "useState", module.scopes) &&
        !hasReactDefaultProviderMutation("useState", module.scopes) &&
        initializer.arguments.length === OWNED_NATIVE_REF_SINGLE_VALUE_COUNT &&
        isNumericSource(initializer.arguments[0], module, new Set([...seen, symbol])) &&
        hasClosedIndexSetterWrites(declaration, module),
      )
    );
  }
  const initializer = getDirectConstInitializer(symbol);
  return Boolean(initializer && isNumericSource(initializer, module, new Set([...seen, symbol])));
};

const isNumericSource = (
  raw: EsTreeNode | undefined,
  module: SourceProjectModule,
  seen: Set<SymbolDescriptor>,
): boolean => {
  if (!raw) return false;
  const node = stripParenExpression(raw);
  if (isNodeOfType(node, "Literal"))
    return typeof node.value === "number" && Number.isFinite(node.value);
  if (isNodeOfType(node, "UnaryExpression") && (node.operator === "+" || node.operator === "-"))
    return isNumericSource(node.argument, module, seen);
  if (isNodeOfType(node, "Identifier")) return isReadonlyIndex(node, module, seen);
  if (isNodeOfType(node, "BinaryExpression") && (node.operator === "+" || node.operator === "-"))
    return isNumericSource(node.left, module, seen) && isNumericSource(node.right, module, seen);
  return false;
};

const isZeroArgumentFocus = (raw: EsTreeNode): boolean => {
  const receiver = findTransparentExpressionRoot(raw);
  const member = receiver.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== receiver ||
    getStaticPropertyName(member) !== "focus"
  )
    return false;
  const method = findTransparentExpressionRoot(member);
  const call = method.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === method && !call.arguments.length;
};

const hasClosedCurrentUse = (
  current: EsTreeNode,
  module: SourceProjectModule,
  approved: Set<EsTreeNode>,
): boolean => {
  if (isMemberMutationTarget(current)) return false;
  if (isBooleanRead(current) || isZeroArgumentFocus(current)) return true;
  const root = findTransparentExpressionRoot(current);
  const member = root.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== root ||
    isMemberMutationTarget(member)
  )
    return false;
  const name = getStaticPropertyName(member);
  if (name === "contains") {
    const method = findTransparentExpressionRoot(member);
    const call = method.parent;
    return (
      isNodeOfType(call, "CallExpression") &&
      call.callee === method &&
      call.arguments.length === OWNED_NATIVE_REF_SINGLE_VALUE_COUNT &&
      !isNodeOfType(call.arguments[0], "SpreadElement")
    );
  }
  if (name !== "children") return false;
  if (isReadonlyNativeSnapshot(member, module)) {
    approved.add(member);
    approved.add(findTransparentExpressionRoot(member));
    return true;
  }
  const collection = findTransparentExpressionRoot(member);
  const item = collection.parent;
  if (
    !isNodeOfType(item, "MemberExpression") ||
    item.object !== collection ||
    !item.computed ||
    !isReadonlyIndex(item.property, module) ||
    isMemberMutationTarget(item) ||
    !isZeroArgumentFocus(item)
  )
    return false;
  approved.add(member);
  approved.add(collection);
  return true;
};

export const collectOwnedNativeRefUses = (
  input: CollectOwnedNativeRefUsesInput,
): OwnedNativeRefUses => {
  const { module } = input;
  const nativeRefs = new Set<SymbolDescriptor>();
  const approvedNativeUseNodes = new Set<EsTreeNode>();
  if (hasReactDefaultProviderMutation("useRef", module.scopes))
    return { nativeRefs, approvedNativeUseNodes };
  walkAst(module.programNode, (node) => {
    if (
      !isNodeOfType(node, "VariableDeclarator") ||
      !isNodeOfType(node.id, "Identifier") ||
      !node.init
    )
      return;
    const symbol = module.scopes.symbolFor(node.id);
    const initializer = stripParenExpression(node.init);
    const owner = findEnclosingFunction(node);
    if (
      !symbol ||
      !owner ||
      getDirectConstInitializer(symbol) !== node.init ||
      !isNodeOfType(initializer, "CallExpression") ||
      !isProvenUnmodifiedReactApiCall(initializer, "useRef", module.scopes) ||
      hasSymbolBindingWrites(symbol) ||
      !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes)
    )
      return;
    const [initial, ...remaining] = initializer.arguments;
    if (remaining.length) return;
    if (initial) {
      const value = stripParenExpression(initial);
      if (
        !(isNodeOfType(value, "Literal") && value.value === null) &&
        !(
          isNodeOfType(value, "Identifier") &&
          value.name === "undefined" &&
          module.scopes.isGlobalReference(value)
        )
      )
        return;
    }
    const publications: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
    const approved = new Set<EsTreeNode>();
    const isClosed = symbol.references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      if (
        isNodeOfType(parent, "JSXExpressionContainer") &&
        parent.expression === root &&
        isNodeOfType(parent.parent, "JSXAttribute") &&
        getJsxAttributeName(parent.parent.name) === "ref" &&
        isNodeOfType(parent.parent.parent, "JSXOpeningElement")
      ) {
        const opening = parent.parent.parent;
        if (
          !input.resolveHostName(opening, module) ||
          !isCleanPublication(opening, module) ||
          !isReturnedPublication(opening, owner, input)
        )
          return false;
        publications.push(opening);
        return true;
      }
      return (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === root &&
        getStaticPropertyName(parent) === "current" &&
        hasClosedCurrentUse(parent, module, approved)
      );
    });
    if (!isClosed || publications.length !== OWNED_NATIVE_REF_SINGLE_VALUE_COUNT) return;
    nativeRefs.add(symbol);
    for (const approvedNode of approved) approvedNativeUseNodes.add(approvedNode);
  });
  return { nativeRefs, approvedNativeUseNodes };
};
