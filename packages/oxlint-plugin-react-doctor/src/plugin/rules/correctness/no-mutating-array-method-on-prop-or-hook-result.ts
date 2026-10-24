import { LOCAL_UTILITY_ARGUMENT_CALL_DEPTH_LIMIT } from "./utils/constants.js";
import { getClosedLocalUtilityCalls } from "../../utils/get-closed-local-utility-calls.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findSameFileTypeDeclarations } from "../../utils/find-same-file-type-declaration.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getSymbolWriteReferences } from "../../utils/get-symbol-write-references.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { nodeDominatesNode } from "../../utils/node-dominates-node.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface AliasSource {
  rootIdentifier: EsTreeNodeOfType<"Identifier">;
  isMemberAccess: boolean;
  memberPath: ReadonlyArray<string> | null;
}

// Only the in-place reorder/remove mutators this rule targets — a deliberate
// subset of the canonical `MUTATING_ARRAY_METHODS`; named distinctly so it does
// not shadow that nine-method set.
const REORDERING_ARRAY_METHODS = new Set(["sort", "reverse", "splice"]);

// Immer drafts and mutation-callback targets are deliberately mutable, and
// their binding names conventionally advertise it. Matched as whole camel /
// snake words so ordinary names that merely contain the letters (e.g.
// `permutations`) are not exempted.
const MUTATION_SAFE_WORDS = new Set(["draft", "mutable", "mutation"]);

// `reverse()` / `sort()` also live on playback controllers (WAAPI
// Animation, GSAP Timeline/Tween) and sort-strategy objects, where they
// control playback direction or take the DATA as an argument — not
// Array.prototype mutators. Receivers named for those shapes stay quiet.
const NON_ARRAY_RECEIVER_NAME_PATTERN = /anim|timeline|tween|player|motion|strateg|sorter/i;

// Playback-control methods that never exist on arrays: a sibling
// `animation.pause()` / `timeline.play()` on the same receiver proves the
// `.reverse()` is playback control.
const PLAYBACK_SIBLING_METHOD_NAMES = new Set([
  "play",
  "pause",
  "cancel",
  "finish",
  "resume",
  "restart",
]);

// Store hooks whose entire API is mutate-the-proxy: MobX observables,
// SyncedStore/Yjs CRDT proxies, valtio proxies — splicing them IS the
// documented update mechanism, and a spread copy would silently break
// sync. `useCreation` (ahooks) is a documented useRef replacement, so the
// held instance is a deliberate mutable container like `.current`.
const MUTABLE_STORE_HOOK_PATTERN = /^use(?:LocalObservable|LocalStore|SyncedStore|Proxy|Creation)$/;

const ALIAS_RESOLUTION_DEPTH_LIMIT = 3;
const TYPE_RESOLUTION_DEPTH_LIMIT = 4;

const getStaticTypeMemberName = (member: EsTreeNode): string | null => {
  if (!isNodeOfType(member, "TSPropertySignature") && !isNodeOfType(member, "TSMethodSignature")) {
    return null;
  }
  if (member.computed) return null;
  if (isNodeOfType(member.key, "Identifier")) return member.key.name;
  if (isNodeOfType(member.key, "Literal") && typeof member.key.value === "string") {
    return member.key.value;
  }
  return null;
};

const typeCanBeArray = (
  typeNode: EsTreeNode,
  referenceNode: EsTreeNode,
  depth: number,
): boolean => {
  if (depth > TYPE_RESOLUTION_DEPTH_LIMIT) return true;
  if (isNodeOfType(typeNode, "TSTypeAnnotation")) {
    return typeCanBeArray(typeNode.typeAnnotation, referenceNode, depth);
  }
  if (isNodeOfType(typeNode, "TSArrayType") || isNodeOfType(typeNode, "TSTupleType")) return true;
  if (isNodeOfType(typeNode, "TSUnionType") || isNodeOfType(typeNode, "TSIntersectionType")) {
    return typeNode.types.some((member) => typeCanBeArray(member, referenceNode, depth + 1));
  }
  if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) {
    return (typeNode.extends ?? []).some((extension) => {
      if (!isNodeOfType(extension.expression, "Identifier")) return true;
      if (extension.expression.name === "Array" || extension.expression.name === "ReadonlyArray") {
        return true;
      }
      const declarations = findSameFileTypeDeclarations(referenceNode, extension.expression.name);
      return (
        declarations.length === 0 ||
        declarations.some((declaration) => typeCanBeArray(declaration, referenceNode, depth + 1))
      );
    });
  }
  if (isNodeOfType(typeNode, "TSTypeAliasDeclaration")) {
    return typeCanBeArray(typeNode.typeAnnotation, referenceNode, depth + 1);
  }
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  if (!isNodeOfType(typeNode.typeName, "Identifier")) return true;
  if (typeNode.typeName.name === "Array" || typeNode.typeName.name === "ReadonlyArray") return true;
  const declarations = findSameFileTypeDeclarations(referenceNode, typeNode.typeName.name);
  return (
    declarations.length === 0 ||
    declarations.some((declaration) => typeCanBeArray(declaration, referenceNode, depth + 1))
  );
};

const membersDeclareCallableMember = (
  members: ReadonlyArray<EsTreeNode>,
  memberName: string,
): boolean =>
  members.some((member) => {
    if (getStaticTypeMemberName(member) !== memberName) return false;
    if (isNodeOfType(member, "TSMethodSignature")) return true;
    return Boolean(
      isNodeOfType(member, "TSPropertySignature") &&
      member.typeAnnotation &&
      isNodeOfType(member.typeAnnotation.typeAnnotation, "TSFunctionType"),
    );
  });

const typeDeclaresCallableMember = (
  typeNode: EsTreeNode,
  memberName: string,
  referenceNode: EsTreeNode,
  depth: number,
): boolean => {
  if (depth > TYPE_RESOLUTION_DEPTH_LIMIT) return false;
  if (isNodeOfType(typeNode, "TSTypeAnnotation")) {
    return typeDeclaresCallableMember(typeNode.typeAnnotation, memberName, referenceNode, depth);
  }
  if (isNodeOfType(typeNode, "TSArrayType") || isNodeOfType(typeNode, "TSTupleType")) {
    return false;
  }
  if (isNodeOfType(typeNode, "TSUnionType")) {
    return typeNode.types.every((member) =>
      typeDeclaresCallableMember(member, memberName, referenceNode, depth + 1),
    );
  }
  if (isNodeOfType(typeNode, "TSIntersectionType")) {
    return typeNode.types.some((member) =>
      typeDeclaresCallableMember(member, memberName, referenceNode, depth + 1),
    );
  }
  if (isNodeOfType(typeNode, "TSTypeLiteral")) {
    return membersDeclareCallableMember(typeNode.members, memberName);
  }
  if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) {
    if (typeDeclaresCallableMember(typeNode.body, memberName, referenceNode, depth + 1)) {
      return true;
    }
    return (typeNode.extends ?? []).some((extension) => {
      if (extension.typeArguments || !isNodeOfType(extension.expression, "Identifier")) {
        return false;
      }
      return findSameFileTypeDeclarations(referenceNode, extension.expression.name).some(
        (declaration) =>
          typeDeclaresCallableMember(declaration, memberName, referenceNode, depth + 1),
      );
    });
  }
  if (isNodeOfType(typeNode, "TSInterfaceBody")) {
    return membersDeclareCallableMember(typeNode.body, memberName);
  }
  if (isNodeOfType(typeNode, "TSTypeAliasDeclaration")) {
    return typeDeclaresCallableMember(
      typeNode.typeAnnotation,
      memberName,
      referenceNode,
      depth + 1,
    );
  }
  if (
    !isNodeOfType(typeNode, "TSTypeReference") ||
    !isNodeOfType(typeNode.typeName, "Identifier") ||
    typeNode.typeName.name === "Array" ||
    typeNode.typeName.name === "ReadonlyArray"
  ) {
    return false;
  }
  return findSameFileTypeDeclarations(referenceNode, typeNode.typeName.name).some((declaration) =>
    typeDeclaresCallableMember(declaration, memberName, referenceNode, depth + 1),
  );
};

const propertyTypeFromObjectType = (
  typeNode: EsTreeNode,
  propertyName: string,
  referenceNode: EsTreeNode,
  depth: number,
): EsTreeNode | null => {
  if (depth > TYPE_RESOLUTION_DEPTH_LIMIT) return null;
  if (isNodeOfType(typeNode, "TSTypeAnnotation")) {
    return propertyTypeFromObjectType(typeNode.typeAnnotation, propertyName, referenceNode, depth);
  }
  let members: ReadonlyArray<EsTreeNode> | null = null;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) members = typeNode.members;
  if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) members = typeNode.body.body;
  if (members) {
    const typeMember = members.find((member) => getStaticTypeMemberName(member) === propertyName);
    if (typeMember && isNodeOfType(typeMember, "TSPropertySignature")) {
      return typeMember.typeAnnotation ?? null;
    }
  }
  if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) {
    for (const extension of typeNode.extends ?? []) {
      if (extension.typeArguments || !isNodeOfType(extension.expression, "Identifier")) continue;
      for (const declaration of findSameFileTypeDeclarations(
        referenceNode,
        extension.expression.name,
      )) {
        const inheritedPropertyType = propertyTypeFromObjectType(
          declaration,
          propertyName,
          referenceNode,
          depth + 1,
        );
        if (inheritedPropertyType) return inheritedPropertyType;
      }
    }
  }
  if (isNodeOfType(typeNode, "TSTypeAliasDeclaration")) {
    return propertyTypeFromObjectType(
      typeNode.typeAnnotation,
      propertyName,
      referenceNode,
      depth + 1,
    );
  }
  if (isNodeOfType(typeNode, "TSIntersectionType")) {
    for (const intersectionMember of typeNode.types) {
      const propertyType = propertyTypeFromObjectType(
        intersectionMember,
        propertyName,
        referenceNode,
        depth + 1,
      );
      if (propertyType) return propertyType;
    }
  }
  if (isNodeOfType(typeNode, "TSTypeReference") && isNodeOfType(typeNode.typeName, "Identifier")) {
    for (const declaration of findSameFileTypeDeclarations(referenceNode, typeNode.typeName.name)) {
      const propertyType = propertyTypeFromObjectType(
        declaration,
        propertyName,
        referenceNode,
        depth + 1,
      );
      if (propertyType) return propertyType;
    }
  }
  return null;
};

const propertyTypeForBinding = (bindingIdentifier: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(bindingIdentifier, "Identifier")) return null;
  if (bindingIdentifier.typeAnnotation) return bindingIdentifier.typeAnnotation;
  const property = bindingIdentifier.parent;
  const pattern = property?.parent;
  if (
    !property ||
    !isNodeOfType(property, "Property") ||
    property.computed ||
    !pattern ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    !pattern.typeAnnotation
  ) {
    return null;
  }
  let propertyName: string | null = null;
  if (isNodeOfType(property.key, "Identifier")) propertyName = property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    propertyName = property.key.value;
  }
  if (!propertyName) return null;
  return propertyTypeFromObjectType(pattern.typeAnnotation, propertyName, bindingIdentifier, 0);
};

const bindingDeclaresNonArrayMethod = (binding: BindingInfo, methodName: string): boolean => {
  const bindingType = propertyTypeForBinding(binding.bindingIdentifier);
  return Boolean(
    bindingType &&
    !typeCanBeArray(bindingType, binding.bindingIdentifier, 0) &&
    typeDeclaresCallableMember(bindingType, methodName, binding.bindingIdentifier, 0),
  );
};

const identifierWords = (name: string): string[] =>
  name
    .split(/[^a-zA-Z]+/)
    .flatMap((chunk) => chunk.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter(Boolean);

const hasMutationSafeWord = (name: string): boolean =>
  identifierWords(name).some((word) => MUTATION_SAFE_WORDS.has(word.toLowerCase()));

// A `.current` in the receiver chain (`stackRef.current.splice()`,
// `mapRef.current[key].splice()`) means the array lives inside a React ref.
// `useRef` is itself a hook, so the root would otherwise be misclassified as
// a "hook result" — but a ref is a deliberately mutable container the docs
// endorse mutating, not shared/cached state, so mutating it is not the bug
// this rule targets. (useState arrays keep no such contract and stay flagged.)
const receiverReachesThroughRefCurrent = (receiver: EsTreeNode): boolean => {
  let cursor: EsTreeNode = receiver;
  while (isNodeOfType(cursor, "MemberExpression")) {
    if (
      !cursor.computed &&
      isNodeOfType(cursor.property, "Identifier") &&
      cursor.property.name === "current"
    ) {
      return true;
    }
    cursor = stripParenExpression(cursor.object as EsTreeNode);
  }
  return false;
};

const rootIdentifierNode = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "Identifier")) return cursor;
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression as unknown as EsTreeNode;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = cursor.object;
      continue;
    }
    return null;
  }
  return null;
};

const isHookCallExpression = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const calleeName = getCalleeName(node);
  return calleeName !== null && isReactHookName(calleeName);
};

const isMutableStoreHookCall = (node: EsTreeNode | null): boolean => {
  if (!node || !isNodeOfType(node, "CallExpression")) return false;
  const calleeName = getCalleeName(node);
  return calleeName !== null && MUTABLE_STORE_HOOK_PATTERN.test(calleeName);
};

// The same receiver gets playback-control calls (`animation.pause()`,
// `timeline.play()`) somewhere in the file — it is a WAAPI Animation /
// GSAP Timeline, not an array.
const scopeShowsPlaybackSiblingCall = (
  rootIdentifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(rootIdentifier);
  return Boolean(
    symbol?.references.some((reference) => {
      const member = reference.identifier.parent;
      return Boolean(
        member &&
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference.identifier &&
        !member.computed &&
        isNodeOfType(member.property, "Identifier") &&
        PLAYBACK_SIBLING_METHOD_NAMES.has(member.property.name) &&
        isNodeOfType(member.parent, "CallExpression") &&
        member.parent.callee === member,
      );
    }),
  );
};

// `useEffect(() => { locks.push(id); return () => { locks.splice(...); }; })`
// — the subscribe/unsubscribe registry idiom: the mutation lives in the
// effect's cleanup and the effect body registered into the same container.
const isRegistryCleanupMutation = (callNode: EsTreeNode, rootIdentifierName: string): boolean => {
  let cleanupFunction: EsTreeNode | null = null;
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      cleanupFunction = ancestor;
      break;
    }
    ancestor = ancestor.parent ?? null;
  }
  if (!cleanupFunction) return false;
  let cursor: EsTreeNode | null | undefined = cleanupFunction.parent;
  while (cursor && !isNodeOfType(cursor, "ReturnStatement")) {
    if (isFunctionLike(cursor)) return false;
    cursor = cursor.parent ?? null;
  }
  if (!cursor) return false;
  let effectCallback: EsTreeNode | null | undefined = cursor.parent;
  while (effectCallback && !isFunctionLike(effectCallback)) {
    effectCallback = effectCallback.parent ?? null;
  }
  if (!effectCallback) return false;
  const effectCall = effectCallback.parent;
  if (
    !effectCall ||
    !isNodeOfType(effectCall, "CallExpression") ||
    !(effectCall.arguments ?? []).includes(effectCallback as never)
  ) {
    return false;
  }
  const effectName = getCalleeName(effectCall);
  if (!effectName || !/^use(?:Layout|Insertion)?Effect$/.test(effectName)) return false;
  let didRegister = false;
  walkAst(effectCallback, (child) => {
    if (didRegister) return false;
    if (child === cleanupFunction) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      !child.callee.computed &&
      isNodeOfType(child.callee.property, "Identifier") &&
      (child.callee.property.name === "push" || child.callee.property.name === "add") &&
      rootIdentifierNode(stripParenExpression(child.callee.object as EsTreeNode))?.name ===
        rootIdentifierName
    ) {
      didRegister = true;
      return false;
    }
  });
  return didRegister;
};

// Stops at function boundaries so a callback parameter nested inside a hook
// call (`const handler = useCallback((rows) => rows.sort(), [])`) never
// tunnels out to the enclosing declarator and gets misread as a hook result.
const nearestVariableDeclarator = (
  node: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) return cursor;
    if (isNodeOfType(cursor, "VariableDeclaration") || isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// A rest-element destructuring binding (`const [a, ...rest] = arr`,
// `const { a, ...rest } = obj`) materializes a freshly allocated array /
// object, so mutating the binding itself never touches the source. Member
// access through the binding (`rest.items.sort()`) still reaches shared
// inner values and stays flagged.
const isBoundThroughRestElement = (binding: BindingInfo): boolean => {
  let cursor: EsTreeNode | null | undefined = binding.bindingIdentifier;
  while (cursor && !isNodeOfType(cursor, "VariableDeclarator") && !isFunctionLike(cursor)) {
    if (isNodeOfType(cursor, "RestElement")) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const declaratorInitFor = (binding: BindingInfo): EsTreeNode | null => {
  const declarator = nearestVariableDeclarator(binding.bindingIdentifier);
  return declarator ? ((declarator.init as EsTreeNode | null) ?? null) : null;
};

const isDerivedFromHookCall = (binding: BindingInfo): boolean => {
  if (binding.initializer && isHookCallExpression(stripParenExpression(binding.initializer))) {
    return true;
  }
  // Destructured hook result: `const { data } = useQuery()`.
  const declaratorInit = declaratorInitFor(binding);
  return Boolean(declaratorInit && isHookCallExpression(stripParenExpression(declaratorInit)));
};

// `const [store] = useState({...})` with the setter never destructured is the
// deliberate ref-like mutable-container idiom (same rationale as the
// `.current` carve-out). Applies when the array is reached through a member
// access on the container, and to direct `splice` (registry add/remove
// maintenance, e.g. a timeout-id registry emptied on unmount) — a direct
// `stateArray.sort()` stays flagged.
const isSetterlessUseStateBinding = (binding: BindingInfo): boolean => {
  const declarator = nearestVariableDeclarator(binding.bindingIdentifier);
  if (!declarator || !isNodeOfType(declarator.id, "ArrayPattern")) return false;
  const boundElements = declarator.id.elements.filter(Boolean);
  if (boundElements.length !== 1) return false;
  if (!declarator.init) return false;
  return getCalleeName(stripParenExpression(declarator.init as EsTreeNode)) === "useState";
};

// Array-returning methods that always allocate a fresh array, so mutating
// their result never touches the source collection.
const FRESH_ARRAY_PRODUCING_METHODS = new Set([
  "filter",
  "map",
  "slice",
  "concat",
  "flat",
  "flatMap",
  "toSorted",
  "toReversed",
  "toSpliced",
]);

const isProvablyFreshOrAbsentValue = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ArrayExpression")) return true;
  if (isNodeOfType(stripped, "Identifier") && stripped.name === "undefined") return true;
  if (isNodeOfType(stripped, "Literal") && stripped.value === null) return true;
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isProvablyFreshOrAbsentValue(stripped.consequent) &&
      isProvablyFreshOrAbsentValue(stripped.alternate)
    );
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      isProvablyFreshOrAbsentValue(stripped.left) && isProvablyFreshOrAbsentValue(stripped.right)
    );
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    const callee = stripped.callee;
    if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
      const method = callee.property;
      if (!isNodeOfType(method, "Identifier")) return false;
      if (FRESH_ARRAY_PRODUCING_METHODS.has(method.name)) return true;
      return (
        method.name === "from" &&
        isNodeOfType(callee.object, "Identifier") &&
        callee.object.name === "Array"
      );
    }
  }
  return false;
};

// `const rows = useMemo(() => source?.filter(...), deps)` — the memo result
// is a component-owned fresh copy on every return path (`.filter()`,
// `.slice()`, `[...]`, an array literal, or nothing at all), so an in-place
// sort touches no shared/cached data. Any return path yielding an identifier
// or member expression (e.g. `return payload ?? []`) can still alias the
// source, so the exemption is refused.
const isUseMemoReturningOnlyFreshArrays = (hookCall: EsTreeNode | null): boolean => {
  if (!hookCall || !isNodeOfType(hookCall, "CallExpression")) return false;
  if (getCalleeName(hookCall) !== "useMemo") return false;
  const factoryArgument = hookCall.arguments?.[0];
  if (!factoryArgument) return false;
  const factory = stripParenExpression(factoryArgument);
  if (!isFunctionLike(factory)) return false;
  const body = factory.body;
  if (!body) return false;
  if (!isNodeOfType(body, "BlockStatement")) return isProvablyFreshOrAbsentValue(body);
  let sawUnprovenReturn = false;
  let sawFreshReturn = false;
  walkAst(body, (child) => {
    if (child !== body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement")) return undefined;
    const returnedValue = child.argument;
    if (!returnedValue || isProvablyFreshOrAbsentValue(returnedValue)) {
      sawFreshReturn = true;
    } else {
      sawUnprovenReturn = true;
    }
    return undefined;
  });
  return sawFreshReturn && !sawUnprovenReturn;
};

// True when the binding is a parameter of its scope-owning function
// (rather than a local declaration inside it).
const isParameterBinding = (binding: BindingInfo): boolean => {
  const owner = binding.scopeOwner;
  const params = (owner as { params?: EsTreeNode[] }).params;
  if (!Array.isArray(params)) return false;
  let cursor: EsTreeNode | null | undefined = binding.bindingIdentifier;
  while (cursor && cursor !== owner) {
    if (params.includes(cursor)) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

// `events = events.filter(...)` before the flagged call rebinds the name to a
// fresh array, so the mutating call no longer touches the prop / hook result.
// The assignment must complete before the call starts, so `items = items.sort()`
// (which still mutates the shared array in place) stays flagged.
const hasRebindBeforeCall = (
  binding: BindingInfo,
  identifierName: string,
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(binding.bindingIdentifier);
  if (!symbol || symbol.name !== identifierName) return false;
  return getSymbolWriteReferences(symbol).some((reference) => {
    const assignment = reference.identifier.parent;
    return Boolean(
      assignment &&
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === reference.identifier &&
      isProvablyFreshOrAbsentValue(assignment.right as EsTreeNode) &&
      nodeDominatesNode(assignment, callNode, context),
    );
  });
};

const isProvableArrayContainerHookBinding = (binding: BindingInfo): boolean => {
  const initializer = binding.initializer ? stripParenExpression(binding.initializer) : null;
  const declaratorInitializer = declaratorInitFor(binding);
  let hookCall: EsTreeNode | null = null;
  if (initializer && isNodeOfType(initializer, "CallExpression")) {
    hookCall = initializer;
  } else if (declaratorInitializer) {
    const strippedDeclaratorInitializer = stripParenExpression(declaratorInitializer);
    if (isNodeOfType(strippedDeclaratorInitializer, "CallExpression")) {
      hookCall = strippedDeclaratorInitializer;
    }
  }
  if (!hookCall || !isNodeOfType(hookCall, "CallExpression")) return false;
  const hookName = getCalleeName(hookCall);
  return (
    hookName === "useContext" ||
    hookName === "useMemo" ||
    hookName === "useReducer" ||
    hookName === "useState" ||
    hookName === "useSyncExternalStore"
  );
};

// Body-level prop aliases: `const { items } = props` / `const list = props.items`
// keep pointing at the parent's array, so follow the initializer chain back to
// its root identifier. Copies (`[...items]`, `items.slice()`) are call / array
// expressions and produce no alias, and a `.current` chain stays exempt.
const aliasSourceFor = (binding: BindingInfo): AliasSource | null => {
  const declarator = nearestVariableDeclarator(binding.bindingIdentifier);
  const bindingPath = declarator
    ? bindingPatternPath(binding.bindingIdentifier, declarator.id)
    : [];
  const aliasCandidates = [binding.initializer, declaratorInitFor(binding)];
  for (const aliasCandidate of aliasCandidates) {
    if (!aliasCandidate) continue;
    const strippedCandidate = stripParenExpression(aliasCandidate);
    if (isNodeOfType(strippedCandidate, "Identifier")) {
      return { rootIdentifier: strippedCandidate, isMemberAccess: false, memberPath: bindingPath };
    }
    if (
      isNodeOfType(strippedCandidate, "MemberExpression") &&
      !receiverReachesThroughRefCurrent(strippedCandidate)
    ) {
      const aliasRoot = rootIdentifierNode(strippedCandidate);
      const initializerPath = staticMemberPath(strippedCandidate);
      if (aliasRoot)
        return {
          rootIdentifier: aliasRoot,
          isMemberAccess: true,
          memberPath: initializerPath && bindingPath ? [...initializerPath, ...bindingPath] : null,
        };
    }
  }
  return null;
};

interface SharedArrayResolution {
  readonly source: "prop" | "hook-result" | null;
  readonly isExempt: boolean;
}

interface UtilityParameterFacts {
  readonly scopes: RuleContext["scopes"];
  readonly cfg: RuleContext["cfg"];
  readonly resolutions: Map<string, SharedArrayResolution>;
}

const UNKNOWN_ARRAY_SOURCE: SharedArrayResolution = { source: null, isExempt: false };
const EXEMPT_ARRAY_SOURCE: SharedArrayResolution = { source: null, isExempt: true };
const PROP_ARRAY_SOURCE: SharedArrayResolution = { source: "prop", isExempt: false };
const HOOK_ARRAY_SOURCE: SharedArrayResolution = { source: "hook-result", isExempt: false };
const utilityParameterFacts = new WeakMap<EsTreeNode, UtilityParameterFacts>();
const utilityCallDepths = new WeakMap<RuleContext, number>();

const staticMemberPath = (expression: EsTreeNode): ReadonlyArray<string> | null => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "Identifier")) return [];
  if (!isNodeOfType(stripped, "MemberExpression")) return null;
  const path = staticMemberPath(stripped.object);
  const name =
    getStaticPropertyName(stripped) ??
    (stripped.computed &&
    isNodeOfType(stripped.property, "Literal") &&
    typeof stripped.property.value === "number"
      ? String(stripped.property.value)
      : null);
  return path && name !== null ? [...path, name] : null;
};

const bindingPatternPath = (
  identifier: EsTreeNode,
  pattern: EsTreeNode,
): ReadonlyArray<string> | null => {
  const path: string[] = [];
  let cursor = identifier;
  while (cursor !== pattern) {
    const parent = cursor.parent;
    if (isNodeOfType(parent, "AssignmentPattern") && parent.left === cursor) {
      cursor = parent;
    } else if (
      isNodeOfType(parent, "Property") &&
      parent.value === cursor &&
      isNodeOfType(parent.parent, "ObjectPattern")
    ) {
      const name = getStaticPropertyKeyName(parent, { allowComputedString: true });
      if (name === null) return null;
      path.unshift(name);
      cursor = parent.parent;
    } else if (isNodeOfType(parent, "ArrayPattern")) {
      const index = parent.elements.findIndex((element) => element === cursor);
      if (
        index < 0 ||
        parent.elements.slice(0, index).some((element) => isNodeOfType(element, "RestElement"))
      )
        return null;
      path.unshift(String(index));
      cursor = parent;
    } else return null;
  }
  return path;
};

interface ArrayProjectionUsage {
  readonly transports: ReadonlySet<EsTreeNode> | null;
  readonly allowedArguments: WeakMap<ReadonlyArray<EsTreeNode>, boolean>;
}

interface ArrayProjectionFacts {
  readonly scopes: RuleContext["scopes"];
  readonly cfg: RuleContext["cfg"];
  readonly paths: Map<string, ArrayProjectionUsage>;
}

const arrayProjectionFacts = new WeakMap<EsTreeNode, ArrayProjectionFacts>();

const hasStableArrayProjection = (
  binding: BindingInfo,
  path: ReadonlyArray<string>,
  context: RuleContext,
  allowedArguments?: ReadonlyArray<EsTreeNode>,
): boolean => {
  const symbol = context.scopes.symbolFor(binding.bindingIdentifier);
  if (!symbol || getSymbolWriteReferences(symbol).length > 0) return false;
  if (path.length === 0) return true;
  let facts = arrayProjectionFacts.get(binding.bindingIdentifier);
  if (!facts || facts.scopes !== context.scopes || facts.cfg !== context.cfg) {
    facts = { scopes: context.scopes, cfg: context.cfg, paths: new Map() };
    arrayProjectionFacts.set(binding.bindingIdentifier, facts);
  }
  const key = JSON.stringify(path);
  let usage = facts.paths.get(key);
  if (!usage) {
    const transports = new Set<EsTreeNode>();
    let stable = true;
    for (const reference of symbol.references) {
      if (isWithinAssignmentTarget(reference.identifier)) {
        stable = false;
        break;
      }
      let receiver: EsTreeNode = reference.identifier;
      while (
        isNodeOfType(receiver.parent, "MemberExpression") &&
        receiver.parent.object === receiver
      )
        receiver = receiver.parent;
      const selectedPath = staticMemberPath(receiver);
      if (selectedPath && path.every((name, index) => selectedPath[index] === name)) continue;
      const parent = receiver.parent;
      if (!parent) {
        stable = false;
        break;
      }
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        (isNodeOfType(parent.id, "ArrayPattern") || isNodeOfType(parent.id, "ObjectPattern")) &&
        selectedPath &&
        selectedPath.every((name, index) => path[index] === name)
      ) {
        const remainingPath = path.slice(selectedPath.length);
        let extractsAncestor = false;
        walkAst(parent.id, (node) => {
          if (
            isNodeOfType(node, "RestElement") ||
            (isNodeOfType(node, "Property") &&
              getStaticPropertyKeyName(node, { allowComputedString: true }) === null)
          )
            extractsAncestor = true;
          if (!isNodeOfType(node, "Identifier")) return;
          const extractedPath = bindingPatternPath(node, parent.id);
          if (
            extractedPath &&
            extractedPath.length < remainingPath.length &&
            extractedPath.every((name, index) => remainingPath[index] === name)
          )
            extractsAncestor = true;
        });
        if (!extractsAncestor) continue;
      }
      if (
        (isNodeOfType(parent, "IfStatement") ||
          isNodeOfType(parent, "WhileStatement") ||
          isNodeOfType(parent, "DoWhileStatement") ||
          isNodeOfType(parent, "ConditionalExpression")) &&
        parent.test === receiver
      )
        continue;
      if (isNodeOfType(parent, "CallExpression") && parent.callee !== receiver)
        transports.add(receiver);
      else {
        stable = false;
        break;
      }
    }
    usage = { transports: stable ? transports : null, allowedArguments: new WeakMap() };
    facts.paths.set(key, usage);
  }
  if (!usage.transports) return false;
  if (usage.transports.size === 0) return true;
  if (!allowedArguments) return false;
  const cached = usage.allowedArguments.get(allowedArguments);
  if (cached !== undefined) return cached;
  const allowed = new Set(allowedArguments);
  const stable = [...usage.transports].every((transport) => allowed.has(transport));
  usage.allowedArguments.set(allowedArguments, stable);
  return stable;
};

const resolveUtilityArgumentSource = (
  expression: EsTreeNode,
  path: ReadonlyArray<string>,
  caller: EsTreeNodeOfType<"CallExpression">,
  method: string,
  depth: number,
  context: RuleContext,
  allowedArguments: ReadonlyArray<EsTreeNode>,
): SharedArrayResolution => {
  if (depth > ALIAS_RESOLUTION_DEPTH_LIMIT) return UNKNOWN_ARRAY_SOURCE;
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "MemberExpression")) {
    const memberPath = staticMemberPath(stripped);
    const identifier = rootIdentifierNode(stripped);
    return memberPath && identifier
      ? resolveUtilityArgumentSource(
          identifier,
          [...memberPath, ...path],
          caller,
          method,
          depth,
          context,
          allowedArguments,
        )
      : UNKNOWN_ARRAY_SOURCE;
  }
  if (isNodeOfType(stripped, "Identifier")) {
    const resolution = resolveSharedArraySource(
      stripped,
      caller,
      method,
      path.length > 0,
      0,
      context,
      path,
    );
    if (resolution.source) return resolution;
    const binding = findVariableInitializer(stripped, stripped.name);
    if (!binding) return UNKNOWN_ARRAY_SOURCE;
    const callerSymbol = context.scopes.symbolFor(binding.bindingIdentifier);
    const writtenReferences = callerSymbol ? getSymbolWriteReferences(callerSymbol) : undefined;
    if (!writtenReferences || writtenReferences.length > 0) {
      return writtenReferences?.length === 1 &&
        path.length === 0 &&
        hasRebindBeforeCall(binding, stripped.name, caller, context)
        ? EXEMPT_ARRAY_SOURCE
        : UNKNOWN_ARRAY_SOURCE;
    }
    if (!hasStableArrayProjection(binding, path, context, allowedArguments))
      return UNKNOWN_ARRAY_SOURCE;
    if (resolution.isExempt) return resolution;
    if (!binding || isParameterBinding(binding)) return UNKNOWN_ARRAY_SOURCE;
    const symbol = context.scopes.symbolFor(binding.bindingIdentifier);
    const declarator = nearestVariableDeclarator(binding.bindingIdentifier);
    if (!symbol || getSymbolWriteReferences(symbol).length > 0 || !declarator?.init)
      return UNKNOWN_ARRAY_SOURCE;
    const bindingPath = bindingPatternPath(binding.bindingIdentifier, declarator.id);
    return bindingPath
      ? resolveUtilityArgumentSource(
          declarator.init,
          [...bindingPath, ...path],
          caller,
          method,
          depth + 1,
          context,
          allowedArguments,
        )
      : UNKNOWN_ARRAY_SOURCE;
  }
  if (path.length > 0) {
    const [propertyName, ...remainingPath] = path;
    if (isNodeOfType(stripped, "ObjectExpression")) {
      const value = getStaticObjectPropertyValue(stripped, propertyName!);
      return value
        ? resolveUtilityArgumentSource(
            value,
            remainingPath,
            caller,
            method,
            depth,
            context,
            allowedArguments,
          )
        : UNKNOWN_ARRAY_SOURCE;
    }
    if (isNodeOfType(stripped, "ArrayExpression")) {
      const index = Number(propertyName);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        String(index) !== propertyName ||
        stripped.elements
          .slice(0, index + 1)
          .some((element) => isNodeOfType(element, "SpreadElement"))
      )
        return UNKNOWN_ARRAY_SOURCE;
      const value = stripped.elements[index];
      return value
        ? resolveUtilityArgumentSource(
            value,
            remainingPath,
            caller,
            method,
            depth,
            context,
            allowedArguments,
          )
        : UNKNOWN_ARRAY_SOURCE;
    }
    return UNKNOWN_ARRAY_SOURCE;
  }
  return isProvablyFreshOrAbsentValue(stripped) || isUseMemoReturningOnlyFreshArrays(stripped)
    ? EXEMPT_ARRAY_SOURCE
    : UNKNOWN_ARRAY_SOURCE;
};

const resolveUtilityParameterSource = (
  binding: BindingInfo,
  memberPath: ReadonlyArray<string> | null,
  method: string,
  context: RuleContext,
): SharedArrayResolution => {
  const calls = getClosedLocalUtilityCalls(binding.scopeOwner, context);
  if (!calls || !isFunctionLike(binding.scopeOwner) || !memberPath) return PROP_ARRAY_SOURCE;
  const parameters = binding.scopeOwner.params;
  const parameterIndex = parameters.findIndex(
    (parameter) => bindingPatternPath(binding.bindingIdentifier, parameter) !== null,
  );
  const parameter = parameters[parameterIndex];
  if (!parameter) return PROP_ARRAY_SOURCE;
  const parameterPath = bindingPatternPath(binding.bindingIdentifier, parameter);
  if (!parameterPath) return PROP_ARRAY_SOURCE;
  const path = [...parameterPath, ...memberPath];
  const callDepth = utilityCallDepths.get(context) ?? 0;
  if (callDepth >= LOCAL_UTILITY_ARGUMENT_CALL_DEPTH_LIMIT) return PROP_ARRAY_SOURCE;
  const key = JSON.stringify([method, path, callDepth]);
  let facts = utilityParameterFacts.get(binding.bindingIdentifier);
  if (!facts || facts.scopes !== context.scopes || facts.cfg !== context.cfg) {
    facts = { scopes: context.scopes, cfg: context.cfg, resolutions: new Map() };
    utilityParameterFacts.set(binding.bindingIdentifier, facts);
  }
  const cached = facts.resolutions.get(key);
  if (cached) return cached;
  facts.resolutions.set(key, PROP_ARRAY_SOURCE);
  if (!hasStableArrayProjection(binding, memberPath, context)) return PROP_ARRAY_SOURCE;
  const allowedArguments = calls.map((caller) => caller.arguments[parameterIndex] ?? caller);
  let result = EXEMPT_ARRAY_SOURCE;
  utilityCallDepths.set(context, callDepth + 1);
  try {
    for (const caller of calls) {
      if (
        caller.arguments
          .slice(0, parameterIndex + 1)
          .some((argument) => isNodeOfType(argument, "SpreadElement"))
      ) {
        result = PROP_ARRAY_SOURCE;
        break;
      }
      const argument = caller.arguments[parameterIndex];
      const resolution = argument
        ? resolveUtilityArgumentSource(argument, path, caller, method, 0, context, allowedArguments)
        : UNKNOWN_ARRAY_SOURCE;
      if (!resolution.isExempt) {
        result = resolution.source ? resolution : PROP_ARRAY_SOURCE;
        break;
      }
    }
  } finally {
    utilityCallDepths.set(context, callDepth);
  }
  facts.resolutions.set(key, result);
  return result;
};

const resolveSharedArraySource = (
  rootIdentifier: EsTreeNodeOfType<"Identifier">,
  callNode: EsTreeNodeOfType<"CallExpression">,
  mutatingMethodName: string,
  reachesThroughMemberAccess: boolean,
  depth: number,
  context: RuleContext,
  memberPath: ReadonlyArray<string> | null,
): SharedArrayResolution => {
  if (depth > ALIAS_RESOLUTION_DEPTH_LIMIT) return UNKNOWN_ARRAY_SOURCE;
  if (hasMutationSafeWord(rootIdentifier.name)) return EXEMPT_ARRAY_SOURCE;
  const binding = findVariableInitializer(rootIdentifier, rootIdentifier.name);
  if (!binding) return UNKNOWN_ARRAY_SOURCE;
  if (bindingDeclaresNonArrayMethod(binding, mutatingMethodName)) return EXEMPT_ARRAY_SOURCE;
  if (hasRebindBeforeCall(binding, rootIdentifier.name, callNode, context))
    return EXEMPT_ARRAY_SOURCE;
  if (!reachesThroughMemberAccess && isBoundThroughRestElement(binding)) return EXEMPT_ARRAY_SOURCE;
  if (isDerivedFromHookCall(binding)) {
    if (!isProvableArrayContainerHookBinding(binding)) return EXEMPT_ARRAY_SOURCE;
    if (
      isSetterlessUseStateBinding(binding) &&
      (reachesThroughMemberAccess || mutatingMethodName === "splice")
    ) {
      return EXEMPT_ARRAY_SOURCE;
    }
    const initializerCall = binding.initializer ? stripParenExpression(binding.initializer) : null;
    const declaratorInit = declaratorInitFor(binding);
    if (
      isMutableStoreHookCall(initializerCall) ||
      isMutableStoreHookCall(declaratorInit ? stripParenExpression(declaratorInit) : null)
    ) {
      return EXEMPT_ARRAY_SOURCE;
    }
    if (!reachesThroughMemberAccess && isUseMemoReturningOnlyFreshArrays(initializerCall)) {
      return EXEMPT_ARRAY_SOURCE;
    }
    return HOOK_ARRAY_SOURCE;
  }
  // A parameter of a React component (or hook) is a prop — shared with
  // the parent across renders. Plain-function/utility params and the
  // draft/mutation params of `produce`/`useMutation` callbacks are not
  // components, so they never reach this branch.
  if (isParameterBinding(binding)) {
    return componentOrHookDisplayNameForFunction(binding.scopeOwner)
      ? resolveUtilityParameterSource(binding, memberPath, mutatingMethodName, context)
      : UNKNOWN_ARRAY_SOURCE;
  }
  const aliasSource = aliasSourceFor(binding);
  if (!aliasSource) return UNKNOWN_ARRAY_SOURCE;
  return resolveSharedArraySource(
    aliasSource.rootIdentifier,
    callNode,
    mutatingMethodName,
    reachesThroughMemberAccess || aliasSource.isMemberAccess,
    depth + 1,
    context,
    memberPath && aliasSource.memberPath ? [...aliasSource.memberPath, ...memberPath] : null,
  );
};

const messageFor = (source: "prop" | "hook-result"): string => {
  const origin =
    source === "prop"
      ? "a prop, so you mutate the parent's array"
      : "a hook result, so you mutate shared/cached state";
  return `\`sort\`, \`reverse\`, and \`splice\` mutate the array in place; this one comes from ${origin} and corrupts it across renders and components. Copy it first with \`[...array]\` or use \`toSorted\`/\`toReversed\`.`;
};

export const noMutatingArrayMethodOnPropOrHookResult = defineRule({
  id: "no-mutating-array-method-on-prop-or-hook-result",
  title: "In-place array mutation on a prop or hook result",
  severity: "warn",
  recommendation:
    "`sort`, `reverse`, and `splice` mutate in place, so calling them on a prop or hook result corrupts shared state. Use the immutable `toSorted`/`toReversed`/`toSpliced`, or copy the array first (`[...array].sort()`) when targeting pre-ES2023 runtimes.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return;
      const mutatingMethodName = getStaticPropertyName(callee);
      if (!mutatingMethodName || !REORDERING_ARRAY_METHODS.has(mutatingMethodName)) return;

      const receiver = stripParenExpression(callee.object as EsTreeNode);
      if (receiverReachesThroughRefCurrent(receiver)) return;
      const rootIdentifier = rootIdentifierNode(receiver);
      if (!rootIdentifier) return;
      if (NON_ARRAY_RECEIVER_NAME_PATTERN.test(rootIdentifier.name)) return;
      if (scopeShowsPlaybackSiblingCall(rootIdentifier, context)) return;
      if (
        mutatingMethodName === "splice" &&
        isRegistryCleanupMutation(node as EsTreeNode, rootIdentifier.name)
      ) {
        return;
      }
      const receiverIsMemberAccess = isNodeOfType(receiver, "MemberExpression");
      const source = resolveSharedArraySource(
        rootIdentifier,
        node,
        mutatingMethodName,
        receiverIsMemberAccess,
        0,
        context,
        staticMemberPath(receiver),
      );
      if (!source.source) return;
      context.report({ node, message: messageFor(source.source) });
    },
  }),
});
