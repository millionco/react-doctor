import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isProvenReactClassComponent } from "./is-proven-react-class-component.js";
import { isSynchronousIteratorCall } from "./is-synchronous-iterator-callback.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { getClassMemberName } from "./get-class-member-name.js";
import { getEnclosingClassMember } from "./get-enclosing-class-member.js";
import { getSplideModuleProof } from "./get-splide-module-proof.js";
import { getRuntimeSymbolReferences } from "./get-runtime-symbol-references.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isClosedImportedSplideEventVector } from "./is-closed-imported-splide-event-vector.js";

export const isSplideOwnedListenerDisposed = (
  registration: EsTreeNodeOfType<"CallExpression">,
  classBody: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(classBody, "ClassBody")) return false;
  if (
    classBody.body.some(
      (member) =>
        (isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition")) &&
        member.computed,
    )
  )
    return false;
  const classNode = classBody.parent;
  if (!classNode || !isProvenReactClassComponent(classNode, context.scopes)) return false;
  if (
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    !classNode.superClass
  )
    return false;
  const superclass = stripParenExpression(classNode.superClass);
  const superclassReceiver = isNodeOfType(superclass, "MemberExpression")
    ? stripParenExpression(superclass.object)
    : superclass;
  if (!isNodeOfType(superclassReceiver, "Identifier")) return false;
  const reactProvider = context.scopes.symbolFor(superclassReceiver);
  if (!reactProvider || getValueImportSource(reactProvider) !== "react") return false;
  if (isNodeOfType(superclass, "MemberExpression")) {
    if (
      superclass.computed ||
      superclass.optional ||
      !["Component", "PureComponent"].includes(getStaticPropertyName(superclass) ?? "") ||
      (!isNodeOfType(reactProvider.declarationNode, "ImportDefaultSpecifier") &&
        !isNodeOfType(reactProvider.declarationNode, "ImportNamespaceSpecifier"))
    )
      return false;
  } else if (
    !["Component", "PureComponent"].includes(getImportedName(reactProvider.declarationNode) ?? "")
  )
    return false;
  const ordinaryMember = (name: string) => {
    const matches = classBody.body.filter((member) => getClassMemberName(member) === name);
    const member = matches.length === 1 ? matches[0] : null;
    return member &&
      isNodeOfType(member, "MethodDefinition") &&
      !member.static &&
      !member.computed &&
      member.kind === "method" &&
      !member.decorators?.length &&
      isFunctionLike(member.value) &&
      !member.value.async &&
      !member.value.generator &&
      isNodeOfType(member.value.body, "BlockStatement")
      ? member
      : null;
  };
  const mountMember = ordinaryMember("componentDidMount");
  const cleanupMember = ordinaryMember("componentWillUnmount");
  if (
    !mountMember ||
    !cleanupMember ||
    mountMember.value.params.length !== 0 ||
    cleanupMember.value.params.length !== 0
  )
    return false;
  const registrationMember = getEnclosingClassMember(registration, classBody);
  const registrationMemberName = registrationMember && getClassMemberName(registrationMember);
  if (!registrationMemberName || ordinaryMember(registrationMemberName) !== registrationMember)
    return false;
  const registrationFunction = isNodeOfType(registrationMember, "MethodDefinition")
    ? registrationMember.value
    : null;
  if (!registrationFunction || !isFunctionLike(registrationFunction)) return false;
  const callee = stripParenExpression(registration.callee);
  if (
    registration.optional ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    callee.computed ||
    getStaticPropertyName(callee) !== "on"
  )
    return false;
  const receiver = stripParenExpression(callee.object);
  const parameter = registrationFunction.params[0];
  const parameterSymbol = isNodeOfType(parameter, "Identifier")
    ? context.scopes.symbolFor(parameter)
    : null;
  const usesHelper = registrationMember !== mountMember;
  if (
    usesHelper &&
    (registrationFunction.params.length !== 1 ||
      !parameterSymbol ||
      !isNodeOfType(receiver, "Identifier") ||
      context.scopes.symbolFor(receiver) !== parameterSymbol)
  )
    return false;
  const helperInvocations: EsTreeNodeOfType<"CallExpression">[] = [];
  let hasHelperReferenceEscape = false;
  if (usesHelper)
    walkAst(classBody, (candidate) => {
      if (
        !isNodeOfType(candidate, "MemberExpression") ||
        !isNodeOfType(candidate.object, "ThisExpression") ||
        getStaticPropertyName(candidate) !== registrationMemberName
      )
        return;
      const call = candidate.parent;
      if (isNodeOfType(call, "CallExpression") && call.callee === candidate)
        helperInvocations.push(call);
      else hasHelperReferenceEscape = true;
    });
  const invocation =
    usesHelper && helperInvocations.length === 1 ? helperInvocations[0] : registration;
  if (
    usesHelper &&
    (hasHelperReferenceEscape ||
      helperInvocations.length !== 1 ||
      invocation === registration ||
      invocation.optional ||
      invocation.arguments.length !== 1 ||
      getEnclosingClassMember(invocation, classBody) !== mountMember)
  )
    return false;
  const owner = usesHelper ? invocation.arguments[0] : receiver;
  if (
    !isNodeOfType(owner, "MemberExpression") ||
    owner.optional ||
    owner.computed ||
    !isNodeOfType(owner.object, "ThisExpression")
  )
    return false;
  const ownerName = getStaticPropertyName(owner);
  if (!ownerName) return false;
  const isOwnerField = (candidate: EsTreeNode) =>
    isNodeOfType(candidate, "MemberExpression") &&
    !candidate.computed &&
    !candidate.optional &&
    isNodeOfType(candidate.object, "ThisExpression") &&
    getStaticPropertyName(candidate) === ownerName;
  const isOwner = (candidate: EsTreeNode) =>
    isOwnerField(candidate) ||
    Boolean(
      usesHelper &&
      isNodeOfType(candidate, "Identifier") &&
      context.scopes.symbolFor(candidate) === parameterSymbol,
    );
  const isEmpty = (candidate: EsTreeNode | null | undefined) =>
    !candidate ||
    (isNodeOfType(candidate, "Literal") && candidate.value === null) ||
    (isNodeOfType(candidate, "Identifier") &&
      candidate.name === "undefined" &&
      context.scopes.isGlobalReference(candidate));
  const fields = classBody.body.filter((member) => getClassMemberName(member) === ownerName);
  const field = fields.length === 1 ? fields[0] : null;
  if (
    !field ||
    !isNodeOfType(field, "PropertyDefinition") ||
    field.static ||
    field.computed ||
    field.decorators?.length ||
    !isEmpty(field.value)
  )
    return false;
  const assignments: EsTreeNodeOfType<"AssignmentExpression">[] = [];
  const mountCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(classBody, (candidate) => {
    if (
      isNodeOfType(candidate, "AssignmentExpression") &&
      isOwnerField(candidate.left) &&
      !isEmpty(candidate.right)
    )
      assignments.push(candidate);
    if (
      isNodeOfType(candidate, "CallExpression") &&
      isNodeOfType(candidate.callee, "MemberExpression") &&
      isOwnerField(candidate.callee.object) &&
      getStaticPropertyName(candidate.callee) === "mount"
    )
      mountCalls.push(candidate);
  });
  const acquisition = assignments.length === 1 ? assignments[0] : null;
  const mount = mountCalls.length === 1 ? mountCalls[0] : null;
  if (
    !acquisition ||
    acquisition.operator !== "=" ||
    !isNodeOfType(acquisition.right, "NewExpression") ||
    !isNodeOfType(acquisition.right.callee, "Identifier") ||
    !mount ||
    mount.arguments.length !== 0 ||
    mount.optional ||
    !isNodeOfType(mount.callee, "MemberExpression") ||
    mount.callee.optional ||
    mount.callee.computed ||
    getEnclosingClassMember(acquisition, classBody) !== mountMember ||
    getEnclosingClassMember(mount, classBody) !== mountMember ||
    acquisition.right.arguments.length < 1 ||
    acquisition.right.arguments.length > 2 ||
    acquisition.right.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  )
    return false;
  const provider = context.scopes.symbolFor(acquisition.right.callee);
  if (
    !provider ||
    getValueImportSource(provider) !== "@splidejs/splide" ||
    getImportedName(provider.declarationNode) !== "Splide"
  )
    return false;
  const acquisitionStatement = acquisition.parent;
  const invocationStatement = invocation.parent;
  const mountStatement = mount.parent;
  if (
    !isNodeOfType(acquisitionStatement, "ExpressionStatement") ||
    !isNodeOfType(invocationStatement, "ExpressionStatement") ||
    !isNodeOfType(mountStatement, "ExpressionStatement") ||
    !isNodeOfType(acquisitionStatement.parent, "BlockStatement") ||
    invocationStatement.parent !== acquisitionStatement.parent ||
    mountStatement.parent !== acquisitionStatement.parent ||
    acquisitionStatement.range[0] >= invocationStatement.range[0] ||
    invocationStatement.range[0] >= mountStatement.range[0]
  )
    return false;
  const lifecycleStatements = acquisitionStatement.parent.body;
  const acquisitionStatementIndex = lifecycleStatements.findIndex(
    (statement) => statement === acquisitionStatement,
  );
  if (
    lifecycleStatements[acquisitionStatementIndex + 1] !== invocationStatement ||
    lifecycleStatements[acquisitionStatementIndex + 2] !== mountStatement
  )
    return false;
  let acquisitionBranch: EsTreeNode = acquisitionStatement.parent;
  while (acquisitionBranch !== mountMember.value.body) {
    const parentBranch: EsTreeNode | null | undefined = acquisitionBranch.parent;
    if (
      !parentBranch ||
      !(
        isNodeOfType(parentBranch, "BlockStatement") ||
        (isNodeOfType(parentBranch, "IfStatement") &&
          (parentBranch.consequent === acquisitionBranch ||
            parentBranch.alternate === acquisitionBranch))
      )
    )
      return false;
    acquisitionBranch = parentBranch;
  }
  const cleanupBody = cleanupMember.value.body;
  if (!isNodeOfType(cleanupBody, "BlockStatement")) return false;
  const presence = cleanupBody.body[0];
  if (
    !isNodeOfType(presence, "IfStatement") ||
    !isOwnerField(presence.test) ||
    presence.alternate ||
    !isNodeOfType(presence.consequent, "BlockStatement")
  )
    return false;
  const [destroyStatement, clearStatement, ...extraStatements] = presence.consequent.body;
  const destroy = isNodeOfType(destroyStatement, "ExpressionStatement")
    ? destroyStatement.expression
    : null;
  if (
    !isNodeOfType(destroy, "CallExpression") ||
    destroy.optional ||
    destroy.arguments.length !== 0 ||
    !isNodeOfType(destroy.callee, "MemberExpression") ||
    destroy.callee.optional ||
    destroy.callee.computed ||
    !isOwnerField(destroy.callee.object) ||
    getStaticPropertyName(destroy.callee) !== "destroy" ||
    extraStatements.length !== 0
  )
    return false;
  const clear = isNodeOfType(clearStatement, "ExpressionStatement")
    ? clearStatement.expression
    : null;
  if (
    clearStatement &&
    (!isNodeOfType(clear, "AssignmentExpression") ||
      clear.operator !== "=" ||
      !isOwnerField(clear.left) ||
      !isEmpty(clear.right))
  )
    return false;
  let program: EsTreeNode = classBody;
  while (program.parent) program = program.parent;
  if (!isNodeOfType(program, "Program")) return false;
  const classSymbol =
    (isNodeOfType(classNode, "ClassDeclaration") || isNodeOfType(classNode, "ClassExpression")) &&
    classNode.id
      ? context.scopes.symbolFor(classNode.id)
      : null;
  if (!classSymbol) return false;
  let valid = true;
  const iterators = new Set<EsTreeNode>();
  let ancestor: EsTreeNode | null | undefined = registration.parent;
  while (ancestor && ancestor !== registrationFunction) {
    if (isFunctionLike(ancestor)) {
      const iterator: EsTreeNode | null | undefined = ancestor.parent;
      if (
        ancestor.async ||
        ancestor.generator ||
        !isNodeOfType(iterator, "CallExpression") ||
        iterator.optional ||
        iterator.arguments[0] !== ancestor ||
        !isNodeOfType(iterator.callee, "MemberExpression") ||
        iterator.callee.optional ||
        iterator.callee.computed ||
        getStaticPropertyName(iterator.callee) !== "forEach"
      )
        return false;
      const collection = iterator.callee.object;
      const symbol = isNodeOfType(collection, "Identifier")
        ? context.scopes.symbolFor(collection)
        : null;
      const source = symbol ? getValueImportSource(symbol) : null;
      if (
        !isSynchronousIteratorCall(iterator, ancestor, context.scopes) &&
        !(symbol && source && isClosedImportedSplideEventVector(symbol, context.filename))
      )
        return false;
      if (symbol) iterators.add(symbol.bindingIdentifier);
    }
    ancestor = ancestor.parent;
  }
  const moduleProof = getSplideModuleProof(program, context.scopes);
  if (
    !moduleProof.valid ||
    moduleProof.splideDeclarations.size !== 1 ||
    !moduleProof.splideDeclarations.has(provider.declarationNode) ||
    !hasCompleteSymbolReferences(classSymbol, program, context.scopes) ||
    getRuntimeSymbolReferences(classSymbol).some(
      (reference) => reference.identifier !== classSymbol.bindingIdentifier,
    ) ||
    (parameterSymbol && !hasCompleteSymbolReferences(parameterSymbol, program, context.scopes))
  )
    return false;
  for (const imported of moduleProof.runtimeImports) {
    if (["react", "@splidejs/splide"].includes(imported.source.value)) continue;
    if (imported.specifiers.length === 0) return false;
    for (const specifier of imported.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol || !isClosedImportedSplideEventVector(symbol, context.filename)) return false;
    }
  }
  let providerClosed = moduleProof.providerClosures.get(provider);
  if (providerClosed === undefined) {
    providerClosed =
      hasCompleteSymbolReferences(provider, program, context.scopes) &&
      getRuntimeSymbolReferences(provider).every((reference) => {
        const parent = reference.identifier.parent;
        return (
          reference.flag === "read" &&
          isNodeOfType(parent, "NewExpression") &&
          parent.callee === reference.identifier
        );
      });
    moduleProof.providerClosures.set(provider, providerClosed);
  }
  if (!providerClosed) return false;
  for (const identifier of iterators) {
    if (!isNodeOfType(identifier, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(identifier);
    if (!symbol) return false;
    let iteratorClosed = moduleProof.iteratorClosures.get(symbol);
    if (iteratorClosed === undefined) {
      iteratorClosed =
        hasCompleteSymbolReferences(symbol, program, context.scopes) &&
        getRuntimeSymbolReferences(symbol).every((reference) => {
          const member = reference.identifier.parent;
          return (
            reference.flag === "read" &&
            isNodeOfType(member, "MemberExpression") &&
            member.object === reference.identifier &&
            !member.computed &&
            ["forEach", "map"].includes(getStaticPropertyName(member) ?? "") &&
            isNodeOfType(member.parent, "CallExpression") &&
            member.parent.callee === member &&
            !isWithinAssignmentTarget(member)
          );
        });
      moduleProof.iteratorClosures.set(symbol, iteratorClosed);
    }
    if (!iteratorClosed) return false;
  }
  walkAst(classBody, (candidate) => {
    if (!valid) return false;
    if (isKeyedDraftTypeReference(candidate)) return false;
    if (
      isNodeOfType(candidate, "MemberExpression") &&
      isNodeOfType(candidate.object, "ThisExpression")
    ) {
      const property = getStaticPropertyName(candidate);
      const member = property ? ordinaryMember(property) : null;
      if (
        member &&
        (!isNodeOfType(candidate.parent, "CallExpression") ||
          candidate.parent.callee !== candidate ||
          candidate.optional)
      )
        valid = false;
    }
    if (
      isNodeOfType(candidate, "CallExpression") &&
      isNodeOfType(candidate.callee, "MemberExpression") &&
      isNodeOfType(candidate.callee.object, "ThisExpression")
    ) {
      const name = getStaticPropertyName(candidate.callee);
      if (!name || !ordinaryMember(name)) valid = false;
    }
    if (getEnclosingClassMember(candidate, classBody)?.parent !== classBody) return;
    if (isNodeOfType(candidate, "ThisExpression")) {
      const member = candidate.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== candidate ||
        member.computed ||
        member.optional ||
        getStaticPropertyName(member) === null ||
        ["constructor", "prototype", "__proto__"].includes(getStaticPropertyName(member) ?? "")
      )
        valid = false;
    }
    if (isOwner(candidate)) {
      const parent = candidate.parent;
      if (
        candidate === acquisition.left ||
        candidate === presence.test ||
        (isNodeOfType(clear, "AssignmentExpression") && candidate === clear.left) ||
        (usesHelper && candidate === invocation.arguments[0]) ||
        candidate === parameter
      )
        return;
      if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return;
      if (isNodeOfType(parent, "IfStatement") && parent.test === candidate) return;
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === candidate &&
        !parent.computed
      ) {
        const method = getStaticPropertyName(parent);
        const call = parent.parent;
        if (isNodeOfType(call, "CallExpression") && call.callee === parent) {
          if ((method === "mount" && call === mount) || (method === "destroy" && call === destroy))
            return;
          if (["go", "refresh"].includes(method ?? "") && isOwnerField(candidate)) return;
          if (
            method === "on" &&
            call === registration &&
            !call.optional &&
            !parent.optional &&
            isNodeOfType(call.parent, "ExpressionStatement") &&
            call.arguments.length === 2 &&
            !call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) &&
            isFunctionLike(call.arguments[1]) &&
            !call.arguments[1].async &&
            !call.arguments[1].generator &&
            getEnclosingClassMember(call, classBody) === registrationMember
          )
            return;
        }
        if (
          method === "options" &&
          isNodeOfType(call, "AssignmentExpression") &&
          call.left === parent &&
          call.operator === "="
        )
          return;
        if (method === "Components") {
          let current: EsTreeNode = parent;
          for (const part of ["Elements", "list", "children"]) {
            const nextMember: EsTreeNode | null | undefined = current.parent;
            if (
              !isNodeOfType(nextMember, "MemberExpression") ||
              nextMember.object !== current ||
              nextMember.computed ||
              getStaticPropertyName(nextMember) !== part
            ) {
              valid = false;
              return;
            }
            current = nextMember;
          }
          if (!isWithinAssignmentTarget(current)) return;
        }
      }
      valid = false;
    }
  });
  return valid;
};
