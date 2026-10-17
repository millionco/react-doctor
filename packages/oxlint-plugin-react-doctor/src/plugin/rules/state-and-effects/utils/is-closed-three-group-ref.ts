import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { hasCapability } from "../../../utils/get-react-doctor-setting.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  THREE_REF_CHILD_CONSTRUCTORS,
  THREE_REF_DEPENDENCY_ARGUMENT_INDEX,
  THREE_REF_EFFECT_ARGUMENT_COUNT,
  THREE_REF_EMPTY_COUNT,
  THREE_REF_FIRST_ARGUMENT_INDEX,
  THREE_REF_SINGLE_ARGUMENT_COUNT,
  THREE_REF_VECTOR_PROPERTIES,
} from "./constants.js";
import { hasClosedThreeMutationProgram } from "./has-closed-three-mutation-program.js";

interface ThreeGroupRefProof {
  scopes: ScopeAnalysis;
  owner: EsTreeNode;
  ref: SymbolDescriptor;
  childAdmissions: Map<number, boolean>;
  sceneAdmissions: Map<number, boolean>;
  sceneInvocation: EsTreeNodeOfType<"CallExpression"> | null;
}

const admissionByScopes = new WeakMap<ScopeAnalysis, Map<number, boolean>>();

const isReadonly = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every(
    (reference) =>
      isTypeScriptTypePosition(reference.identifier) ||
      (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
  );

const isNamedApi = (
  node: EsTreeNode,
  source: string,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  const identifier = stripParenExpression(node);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === source &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    getImportedName(symbol.declarationNode) === name,
  );
};

const staticMemberAfter = (node: EsTreeNode): EsTreeNodeOfType<"MemberExpression"> | null => {
  const root = findTransparentExpressionRoot(node);
  const parent = root.parent;
  return isNodeOfType(parent, "MemberExpression") &&
    parent.object === root &&
    !parent.computed &&
    isNodeOfType(parent.property, "Identifier")
    ? parent
    : null;
};

const directMemberCall = (
  receiver: EsTreeNode,
  name: string,
  allowOptionalReceiver = false,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const member = staticMemberAfter(receiver);
  const call = member ? findTransparentExpressionRoot(member).parent : null;
  return member &&
    member.property.type === "Identifier" &&
    member.property.name === name &&
    (!member.optional || allowOptionalReceiver) &&
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.callee === findTransparentExpressionRoot(member)
    ? call
    : null;
};

const isStatementCall = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const root = findTransparentExpressionRoot(call);
  const parent = root.parent;
  return isNodeOfType(parent, "ExpressionStatement") && parent.expression === root;
};

const isCurrent = (node: EsTreeNode, proof: ThreeGroupRefProof): boolean => {
  const member = stripParenExpression(node);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "current"
  )
    return false;
  const object = stripParenExpression(member.object);
  return isNodeOfType(object, "Identifier") && proof.scopes.symbolFor(object) === proof.ref;
};

const isSingleArgument = (call: EsTreeNodeOfType<"CallExpression">, value: EsTreeNode): boolean =>
  call.arguments.length === THREE_REF_SINGLE_ARGUMENT_COUNT &&
  call.arguments[THREE_REF_FIRST_ARGUMENT_INDEX] === findTransparentExpressionRoot(value);

const hasOwnerAncestor = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let owner = findEnclosingFunction(node);
  while (owner) {
    if (owner === ancestor) return true;
    owner = findEnclosingFunction(owner);
  }
  return false;
};

const isChildAdd = (reference: EsTreeNode, proof: ThreeGroupRefProof): boolean => {
  const root = findTransparentExpressionRoot(reference);
  const call = root.parent;
  if (!isNodeOfType(call, "CallExpression") || !isSingleArgument(call, reference)) return false;
  const member = stripParenExpression(call.callee);
  return (
    isNodeOfType(member, "MemberExpression") &&
    isCurrent(member.object, proof) &&
    directMemberCall(member.object, "add") === call &&
    isStatementCall(call)
  );
};

const isClosedChild = (identifier: EsTreeNode, proof: ThreeGroupRefProof): boolean => {
  const symbol = proof.scopes.symbolFor(identifier);
  if (!symbol) return false;
  const cached = proof.childAdmissions.get(symbol.id);
  if (cached !== undefined) return cached;
  const initializer = getDirectConstInitializer(symbol);
  const construction = initializer ? stripParenExpression(initializer) : null;
  if (
    !isReadonly(symbol) ||
    !isNodeOfType(construction, "NewExpression") ||
    !hasOwnerAncestor(symbol.declarationNode, proof.owner)
  )
    return false;
  const constructor = stripParenExpression(construction.callee);
  if (!isNodeOfType(constructor, "Identifier")) return false;
  const imported = proof.scopes.symbolFor(constructor);
  if (
    !imported ||
    getValueImportSource(imported) !== "three" ||
    !THREE_REF_CHILD_CONSTRUCTORS.has(getImportedName(imported.declarationNode) ?? "")
  )
    return false;
  let hasAdd = false;
  const storageAdmissions = new Map<number, boolean>();
  const admitted =
    symbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      if (isChildAdd(reference.identifier, proof)) {
        hasAdd = true;
        return true;
      }
      const call = findTransparentExpressionRoot(reference.identifier).parent;
      if (!isNodeOfType(call, "CallExpression") || !isSingleArgument(call, reference.identifier))
        return false;
      const member = stripParenExpression(call.callee);
      if (!isNodeOfType(member, "MemberExpression")) return false;
      const arrayIdentifier = stripParenExpression(member.object);
      if (
        !isNodeOfType(arrayIdentifier, "Identifier") ||
        directMemberCall(arrayIdentifier, "push") !== call
      )
        return false;
      const storage = proof.scopes.symbolFor(arrayIdentifier);
      if (!storage) return false;
      const cachedStorage = storageAdmissions.get(storage.id);
      if (cachedStorage !== undefined) return cachedStorage;
      const array = getDirectConstInitializer(storage);
      const arrayOwner = findEnclosingFunction(storage.declarationNode);
      if (
        !isReadonly(storage) ||
        !isNodeOfType(array, "ArrayExpression") ||
        array.elements.length !== THREE_REF_EMPTY_COUNT ||
        !arrayOwner ||
        !hasOwnerAncestor(symbol.declarationNode, arrayOwner) ||
        !hasOwnerAncestor(storage.declarationNode, proof.owner)
      )
        return false;
      const admittedStorage = storage.references.every((storageReference) => {
        if (isTypeScriptTypePosition(storageReference.identifier)) return true;
        const push = directMemberCall(storageReference.identifier, "push");
        if (!push || push.arguments.length !== THREE_REF_SINGLE_ARGUMENT_COUNT) return false;
        const child = push.arguments[THREE_REF_FIRST_ARGUMENT_INDEX];
        return isNodeOfType(child, "Identifier") && proof.scopes.symbolFor(child) === symbol;
      });
      storageAdmissions.set(storage.id, admittedStorage);
      return admittedStorage;
    }) && hasAdd;
  proof.childAdmissions.set(symbol.id, admitted);
  return admitted;
};

const isChildrenIteration = (
  call: EsTreeNodeOfType<"CallExpression">,
  proof: ThreeGroupRefProof,
): boolean => {
  if (call.arguments.length !== THREE_REF_SINGLE_ARGUMENT_COUNT) return false;
  const member = stripParenExpression(call.callee);
  if (!isNodeOfType(member, "MemberExpression")) return false;
  const children = stripParenExpression(member.object);
  if (
    !isNodeOfType(children, "MemberExpression") ||
    children.computed ||
    children.optional ||
    !isNodeOfType(children.property, "Identifier") ||
    children.property.name !== "children" ||
    !isCurrent(children.object, proof) ||
    directMemberCall(children, "forEach") !== call
  )
    return false;
  const callback = call.arguments[THREE_REF_FIRST_ARGUMENT_INDEX];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.generator ||
    callback.params.length !== THREE_REF_SINGLE_ARGUMENT_COUNT
  )
    return false;
  const parameter = callback.params[THREE_REF_FIRST_ARGUMENT_INDEX];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const symbol = proof.scopes.symbolFor(parameter);
  if (!symbol || !isReadonly(symbol)) return false;
  let body: EsTreeNode = callback.body;
  if (isNodeOfType(body, "BlockStatement")) {
    if (
      body.body.length !== THREE_REF_SINGLE_ARGUMENT_COUNT ||
      !isNodeOfType(body.body[THREE_REF_FIRST_ARGUMENT_INDEX], "ExpressionStatement")
    )
      return false;
    body = body.body[THREE_REF_FIRST_ARGUMENT_INDEX].expression;
  }
  const remove = stripParenExpression(body);
  if (
    !isNodeOfType(remove, "CallExpression") ||
    remove.arguments.length !== THREE_REF_SINGLE_ARGUMENT_COUNT
  )
    return false;
  const receiver = stripParenExpression(remove.callee);
  const argument = remove.arguments[THREE_REF_FIRST_ARGUMENT_INDEX];
  return (
    isNodeOfType(receiver, "MemberExpression") &&
    isCurrent(receiver.object, proof) &&
    directMemberCall(receiver.object, "remove", true) === remove &&
    isNodeOfType(argument, "Identifier") &&
    proof.scopes.symbolFor(argument) === symbol &&
    symbol.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) || reference.identifier === argument,
    )
  );
};

const isNativeEffectDependency = (reference: EsTreeNode, proof: ThreeGroupRefProof): boolean => {
  const root = findTransparentExpressionRoot(reference);
  const array = root.parent;
  const call = array?.parent;
  if (
    !isNodeOfType(array, "ArrayExpression") ||
    array.elements.length !== THREE_REF_SINGLE_ARGUMENT_COUNT ||
    array.elements[THREE_REF_FIRST_ARGUMENT_INDEX] !== root ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== THREE_REF_EFFECT_ARGUMENT_COUNT ||
    call.arguments[THREE_REF_DEPENDENCY_ARGUMENT_INDEX] !== array ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    findEnclosingFunction(call) !== proof.owner ||
    !isNamedApi(call.callee, "react", "useEffect", proof.scopes)
  )
    return false;
  const callback = call.arguments[THREE_REF_FIRST_ARGUMENT_INDEX];
  return (
    isFunctionLike(callback) &&
    !callback.async &&
    !callback.generator &&
    callback.params.length === THREE_REF_EMPTY_COUNT
  );
};

const isClosedSceneArgument = (current: EsTreeNode, proof: ThreeGroupRefProof): boolean => {
  const call = findTransparentExpressionRoot(current).parent;
  if (!isNodeOfType(call, "CallExpression") || !isSingleArgument(call, current)) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const identifier = stripParenExpression(callee.object);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = proof.scopes.symbolFor(identifier);
  if (!symbol) return false;
  const cached = proof.sceneAdmissions.get(symbol.id);
  if (cached !== undefined) return cached;
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  const declaration = pattern?.parent;
  if (
    symbol.kind !== "const" ||
    !isReadonly(symbol) ||
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.value !== symbol.bindingIdentifier ||
    !isNodeOfType(property.key, "Identifier") ||
    property.key.name !== "scene" ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    pattern.properties.length !== THREE_REF_SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    findEnclosingFunction(declaration) !== proof.owner
  )
    return false;
  const initializer = declaration.init ? stripParenExpression(declaration.init) : null;
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== THREE_REF_EMPTY_COUNT ||
    !isNamedApi(initializer.callee, "@react-three/fiber", "useThree", proof.scopes)
  )
    return false;
  const admitted = symbol.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier) || reference.identifier === property.key)
      return true;
    if (isNativeEffectDependency(reference.identifier, proof)) return true;
    const attach =
      directMemberCall(reference.identifier, "add") ??
      directMemberCall(reference.identifier, "remove");
    return Boolean(
      attach &&
      isStatementCall(attach) &&
      attach.arguments.length === THREE_REF_SINGLE_ARGUMENT_COUNT &&
      isCurrent(attach.arguments[THREE_REF_FIRST_ARGUMENT_INDEX], proof),
    );
  });
  if (admitted) proof.sceneInvocation = initializer;
  proof.sceneAdmissions.set(symbol.id, admitted);
  return admitted;
};

const isDeferredRotation = (
  call: EsTreeNodeOfType<"CallExpression">,
  proof: ThreeGroupRefProof,
): boolean => {
  const callback = findEnclosingFunction(call);
  if (
    !callback ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== THREE_REF_EMPTY_COUNT
  )
    return false;
  const frame = findTransparentExpressionRoot(callback).parent;
  return (
    isNodeOfType(frame, "CallExpression") &&
    !frame.optional &&
    isSingleArgument(frame, callback) &&
    findEnclosingFunction(frame) === proof.owner &&
    isNodeOfType(callback, "ArrowFunctionExpression") &&
    isStatementCall(call) &&
    isNamedApi(frame.callee, "@react-three/fiber", "useFrame", proof.scopes)
  );
};

const isSupportedCurrentUse = (current: EsTreeNode, proof: ThreeGroupRefProof): boolean => {
  const member = staticMemberAfter(current);
  if (member && !member.optional && member.property.type === "Identifier") {
    if (THREE_REF_VECTOR_PROPERTIES.has(member.property.name)) {
      const set = directMemberCall(member, "set");
      const clone = directMemberCall(member, "clone");
      return Boolean(
        (set && isStatementCall(set)) ||
        (clone && clone.arguments.length === THREE_REF_EMPTY_COUNT),
      );
    }
    if (member.property.name === "children") {
      const iteration = directMemberCall(member, "forEach");
      return Boolean(iteration && isChildrenIteration(iteration, proof));
    }
    if (member.property.name === "rotation") {
      const set = directMemberCall(member, "set");
      return Boolean(set && isDeferredRotation(set, proof));
    }
  }
  const add = directMemberCall(current, "add");
  if (add && isStatementCall(add) && add.arguments.length === THREE_REF_SINGLE_ARGUMENT_COUNT) {
    const child = add.arguments[THREE_REF_FIRST_ARGUMENT_INDEX];
    return isNodeOfType(child, "Identifier") && isClosedChild(child, proof);
  }
  const remove = directMemberCall(current, "remove", true);
  if (remove) {
    const callback = findEnclosingFunction(remove);
    const iteration = callback ? findTransparentExpressionRoot(callback).parent : null;
    return isNodeOfType(iteration, "CallExpression") && isChildrenIteration(iteration, proof);
  }
  return isClosedSceneArgument(current, proof);
};

const hasClosedSceneProvider = (proof: ThreeGroupRefProof): boolean => {
  let admitted = true;
  walkAst(proof.scopes.rootScope.node, (candidate) => {
    if (!admitted || isTypeScriptTypePosition(candidate)) return false;
    if (!isNodeOfType(candidate, "ImportDeclaration")) return;
    for (const specifier of candidate.specifiers) {
      if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
      const symbol = proof.scopes.symbolFor(specifier.local);
      if (
        !symbol ||
        getValueImportSource(symbol) !== "@react-three/fiber" ||
        getImportedName(specifier) !== "useThree"
      )
        continue;
      for (const reference of symbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        if (
          !proof.sceneInvocation ||
          proof.sceneInvocation.callee !== findTransparentExpressionRoot(reference.identifier)
        ) {
          admitted = false;
          return false;
        }
      }
    }
  });
  return admitted;
};

export const isClosedThreeGroupRef = (
  ref: SymbolDescriptor,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (findEnclosingFunction(ref.declarationNode) !== owner) return false;
  let admissions = admissionByScopes.get(context.scopes);
  if (!admissions) {
    admissions = new Map();
    admissionByScopes.set(context.scopes, admissions);
  }
  const cached = admissions.get(ref.id);
  if (cached !== undefined) return cached;
  const initializer = getDirectConstInitializer(ref);
  const call = initializer ? stripParenExpression(initializer) : null;
  const construction = isNodeOfType(call, "CallExpression")
    ? call.arguments[THREE_REF_FIRST_ARGUMENT_INDEX]
    : null;
  const proof: ThreeGroupRefProof = {
    scopes: context.scopes,
    owner,
    ref,
    childAdmissions: new Map<number, boolean>(),
    sceneAdmissions: new Map<number, boolean>(),
    sceneInvocation: null,
  };
  let admitted = Boolean(
    isReadonly(ref) &&
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.arguments.length === THREE_REF_SINGLE_ARGUMENT_COUNT &&
    isNamedApi(call.callee, "react", "useRef", context.scopes) &&
    isNodeOfType(construction, "NewExpression") &&
    construction.arguments.length === THREE_REF_EMPTY_COUNT &&
    isNamedApi(construction.callee, "three", "Group", context.scopes) &&
    hasClosedThreeMutationProgram(context.scopes),
  );
  if (admitted)
    admitted = ref.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const root = findTransparentExpressionRoot(reference.identifier);
      const member = staticMemberAfter(reference.identifier);
      if (member && isCurrent(member, proof)) return isSupportedCurrentUse(member, proof);
      const container = root.parent;
      const attribute = container?.parent;
      const opening = attribute?.parent;
      return (
        hasCapability(context.settings, "r3f") &&
        isNodeOfType(container, "JSXExpressionContainer") &&
        container.expression === root &&
        isNodeOfType(attribute, "JSXAttribute") &&
        attribute.value === container &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name === "ref" &&
        isNodeOfType(opening, "JSXOpeningElement") &&
        isNodeOfType(opening.name, "JSXIdentifier") &&
        opening.name.name === "group" &&
        opening.attributes.length === THREE_REF_SINGLE_ARGUMENT_COUNT &&
        opening.attributes[THREE_REF_FIRST_ARGUMENT_INDEX] === attribute
      );
    });
  if (admitted) admitted = hasClosedSceneProvider(proof);
  admissions.set(ref.id, admitted);
  return admitted;
};
