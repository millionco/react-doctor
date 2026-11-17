import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { areExpressionsStructurallyEqual } from "../../../utils/are-expressions-structurally-equal.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface EmptyRecordComparatorConvergenceInput {
  readonly comparison: EsTreeNodeOfType<"CallExpression">;
  readonly fieldName: string;
  readonly setStateCall: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly isPropsTransitionUpdate: (call: EsTreeNode) => boolean;
}

const isEmptyRecord = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "ObjectExpression") && expression.properties.length === 0;
};

const isOwnState = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  return (
    isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    !expression.optional &&
    isNodeOfType(expression.object, "ThisExpression") &&
    getStaticPropertyName(expression) === "state"
  );
};

const getStateField = (node: EsTreeNode): string | null => {
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    !expression.optional &&
    isOwnState(expression.object)
    ? getStaticPropertyName(expression)
    : null;
};

const hasOwnThis = (
  node: EsTreeNode,
  classNode: EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression">,
): boolean => {
  if (findEnclosingClass(node) !== classNode) return false;
  for (let ancestor = node.parent; ancestor && ancestor !== classNode; ancestor = ancestor.parent) {
    if (isNodeOfType(ancestor, "PropertyDefinition") && ancestor.static) return false;
    if (isFunctionLike(ancestor) && !isNodeOfType(ancestor, "ArrowFunctionExpression")) {
      return (
        isNodeOfType(ancestor.parent, "MethodDefinition") &&
        !ancestor.parent.static &&
        ancestor.parent.parent === classNode.body
      );
    }
  }
  return true;
};

const isNullReturn = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ReturnStatement") &&
  isNodeOfType(node.argument, "Literal") &&
  node.argument.value === null;

const hasNullRenderBarrier = (
  render: EsTreeNode,
  setStateCall: EsTreeNode,
  lifecycle: EsTreeNode,
  fieldName: string,
): boolean => {
  if (!isFunctionLike(render) || !isNodeOfType(render.body, "BlockStatement")) return false;
  const first = render.body.body[0];
  if (!first) return false;
  if (isNullReturn(first)) return true;
  if (!isNodeOfType(first, "IfStatement") || first.alternate) return false;
  const consequent =
    isNodeOfType(first.consequent, "BlockStatement") && first.consequent.body.length === 1
      ? first.consequent.body[0]
      : first.consequent;
  if (!consequent || !isNullReturn(consequent)) return false;
  const barrier = stripParenExpression(first.test);
  const barrierValue =
    isNodeOfType(barrier, "UnaryExpression") && barrier.operator === "!"
      ? stripParenExpression(barrier.argument)
      : barrier;
  const barrierField = getStateField(barrierValue);
  if (!barrierField || barrierField === fieldName) return false;
  const includesBarrier = (test: EsTreeNode): boolean => {
    const expression = stripParenExpression(test);
    if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
      return includesBarrier(expression.left) || includesBarrier(expression.right);
    }
    if (isNodeOfType(barrier, "UnaryExpression") && barrier.operator === "!") {
      return (
        isNodeOfType(expression, "UnaryExpression") &&
        expression.operator === "!" &&
        areExpressionsStructurallyEqual(expression.argument, barrier.argument)
      );
    }
    return areExpressionsStructurallyEqual(expression, barrier);
  };
  let child = setStateCall;
  for (
    let ancestor = child.parent;
    ancestor && ancestor !== lifecycle;
    ancestor = ancestor.parent
  ) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      child === ancestor.consequent &&
      includesBarrier(ancestor.test)
    )
      return true;
    child = ancestor;
  }
  return false;
};

export const hasEmptyRecordComparatorConvergence = ({
  comparison,
  fieldName,
  setStateCall,
  scopes,
  isPropsTransitionUpdate,
}: EmptyRecordComparatorConvergenceInput): boolean => {
  if (
    comparison.optional ||
    comparison.arguments.length !== 2 ||
    !isNodeOfType(comparison.callee, "Identifier") ||
    !isNodeOfType(setStateCall, "CallExpression") ||
    setStateCall.arguments.length !== 1
  )
    return false;
  const imported = resolveImportedApiReference(comparison.callee, scopes);
  const comparatorSymbol = scopes.symbolFor(comparison.callee);
  if (
    imported?.source !== "react-fast-compare" ||
    imported.importedName !== "default" ||
    comparatorSymbol?.kind !== "import" ||
    !isNodeOfType(comparatorSymbol.declarationNode, "ImportDefaultSpecifier")
  )
    return false;
  const lifecycle = findEnclosingFunction(setStateCall);
  const classNode = findEnclosingClass(setStateCall);
  if (
    !classNode ||
    !isNodeOfType(lifecycle, "FunctionExpression") ||
    lifecycle.async ||
    lifecycle.generator ||
    lifecycle.params.length !== 2 ||
    !isNodeOfType(lifecycle.params[0], "Identifier") ||
    !isNodeOfType(lifecycle.params[1], "Identifier") ||
    !isNodeOfType(lifecycle.parent, "MethodDefinition") ||
    lifecycle.parent.static ||
    lifecycle.parent.kind !== "method" ||
    getStaticPropertyKeyName(lifecycle.parent) !== "componentDidUpdate" ||
    lifecycle.parent.parent !== classNode.body ||
    !classNode.superClass ||
    classNode.decorators?.length
  )
    return false;
  const superclass = stripParenExpression(classNode.superClass);
  const reactApi = resolveImportedApiReference(superclass, scopes);
  const reactIdentifier =
    isNodeOfType(superclass, "MemberExpression") && !superclass.computed && !superclass.optional
      ? superclass.object
      : superclass;
  if (
    !isNodeOfType(reactIdentifier, "Identifier") ||
    reactApi?.source !== "react" ||
    !["Component", "PureComponent"].includes(reactApi.importedName ?? "") ||
    scopes.symbolFor(reactIdentifier)?.kind !== "import"
  )
    return false;
  const classSymbol = classNode.id ? scopes.symbolFor(classNode.id) : null;
  if (
    classNode.id &&
    (!classSymbol ||
      classSymbol.references.some(({ identifier, flag }) => {
        if (flag !== "read") return true;
        if (isTypeScriptTypePosition(identifier)) return false;
        const parent = identifier.parent;
        return (
          !(
            (isNodeOfType(parent, "JSXOpeningElement") ||
              isNodeOfType(parent, "JSXClosingElement")) &&
            parent.name === identifier
          ) &&
          !(
            isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === identifier
          ) &&
          !(isNodeOfType(parent, "ExportSpecifier") && parent.local === identifier)
        );
      }))
  )
    return false;
  if (
    !classNode.id &&
    !(
      isNodeOfType(classNode.parent, "ReturnStatement") && classNode.parent.argument === classNode
    ) &&
    !(
      isNodeOfType(classNode.parent, "ExportDefaultDeclaration") &&
      classNode.parent.declaration === classNode
    )
  )
    return false;
  const previousProps = scopes.symbolFor(lifecycle.params[0]);
  if (
    !previousProps ||
    previousProps.references.some(
      (reference) =>
        reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== lifecycle,
    )
  )
    return false;
  const previousState = scopes.symbolFor(lifecycle.params[1]);
  if (
    !previousState ||
    previousState.references.some(
      (reference) =>
        reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== lifecycle,
    )
  )
    return false;
  const payload = setStateCall.arguments[0];
  if (!isNodeOfType(payload, "ObjectExpression") || payload.properties.length !== 1) return false;
  const property = payload.properties[0];
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.method ||
    property.kind !== "init" ||
    getStaticPropertyKeyName(property) !== fieldName ||
    !isEmptyRecord(property.value)
  )
    return false;
  const members = classNode.body.body;
  if (
    members.some((member) => {
      if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition"))
        return true;
      if (member.computed || member.decorators?.length) return true;
      const name = getStaticPropertyKeyName(member);
      if (
        [
          "props",
          "setState",
          "forceUpdate",
          "getDerivedStateFromProps",
          "getDerivedStateFromError",
          "getSnapshotBeforeUpdate",
          "shouldComponentUpdate",
          "componentWillUpdate",
          "UNSAFE_componentWillUpdate",
          "componentWillReceiveProps",
          "UNSAFE_componentWillReceiveProps",
          "componentWillMount",
          "UNSAFE_componentWillMount",
          "componentDidMount",
          "componentDidCatch",
          "componentWillUnmount",
        ].includes(name ?? "")
      )
        return true;
      if (!isNodeOfType(member, "PropertyDefinition")) return false;
      if (name === "displayName" && member.static) {
        const value = member.value;
        if (isNodeOfType(value, "Literal")) return typeof value.value !== "string";
        if (!isNodeOfType(value, "TemplateLiteral")) return true;
        return value.expressions.some((expression) => {
          if (
            !isNodeOfType(expression, "MemberExpression") ||
            expression.computed ||
            expression.optional ||
            getStaticPropertyName(expression) !== "displayName" ||
            !isNodeOfType(expression.object, "Identifier")
          )
            return true;
          const symbol = scopes.symbolFor(expression.object);
          if (
            symbol?.kind !== "parameter" ||
            symbol.scope.node !== findEnclosingFunction(classNode)
          )
            return true;
          return symbol.references.some(({ identifier, flag }) => {
            if (flag !== "read") return true;
            if (identifier === expression.object || isTypeScriptTypePosition(identifier))
              return false;
            const parent = identifier.parent;
            return !(
              (isNodeOfType(parent, "JSXOpeningElement") ||
                isNodeOfType(parent, "JSXClosingElement")) &&
              parent.name === identifier &&
              findEnclosingClass(identifier) === classNode
            );
          });
        });
      }
      if (name === "state") return member.static || !isNodeOfType(member.value, "ObjectExpression");
      return member.static || !isNodeOfType(member.value, "ArrowFunctionExpression");
    })
  )
    return false;
  const constructors = members.filter(
    (member) => getStaticPropertyKeyName(member) === "constructor",
  );
  if (constructors.length > 1) return false;
  const constructor = constructors[0];
  if (constructor) {
    if (
      !isNodeOfType(constructor, "MethodDefinition") ||
      constructor.static ||
      !isNodeOfType(constructor.value, "FunctionExpression") ||
      constructor.value.params.length !== 1 ||
      !isNodeOfType(constructor.value.params[0], "Identifier") ||
      !isNodeOfType(constructor.value.body, "BlockStatement") ||
      constructor.value.body.body.length !== 2
    )
      return false;
    const [superStatement, stateStatement] = constructor.value.body.body;
    if (
      !isNodeOfType(superStatement, "ExpressionStatement") ||
      !isNodeOfType(superStatement.expression, "CallExpression") ||
      !isNodeOfType(superStatement.expression.callee, "Super") ||
      superStatement.expression.arguments.length !== 1 ||
      !isNodeOfType(superStatement.expression.arguments[0], "Identifier") ||
      scopes.symbolFor(superStatement.expression.arguments[0]) !==
        scopes.symbolFor(constructor.value.params[0]) ||
      !isNodeOfType(stateStatement, "ExpressionStatement") ||
      !isNodeOfType(stateStatement.expression, "AssignmentExpression") ||
      stateStatement.expression.operator !== "=" ||
      !isOwnState(stateStatement.expression.left) ||
      !isNodeOfType(stateStatement.expression.right, "ObjectExpression")
    )
      return false;
  }
  const stateInitializers: EsTreeNode[] = members.filter(
    (member) => getStaticPropertyKeyName(member) === "state",
  );
  if (
    isNodeOfType(constructor, "MethodDefinition") &&
    isNodeOfType(constructor.value, "FunctionExpression") &&
    isNodeOfType(constructor.value.body, "BlockStatement")
  ) {
    const constructorState = constructor.value.body.body[1];
    if (constructorState) stateInitializers.push(constructorState);
  }
  if (
    stateInitializers.some((initializer) =>
      someAst(initializer, (candidate) => {
        if (isNodeOfType(candidate, "ThisExpression")) {
          return (
            !isNodeOfType(initializer, "ExpressionStatement") ||
            !isNodeOfType(initializer.expression, "AssignmentExpression") ||
            !isNodeOfType(initializer.expression.left, "MemberExpression") ||
            !isOwnState(initializer.expression.left) ||
            initializer.expression.left.object !== candidate
          );
        }
        if (
          [
            "CallExpression",
            "NewExpression",
            "TaggedTemplateExpression",
            "SpreadElement",
            "UpdateExpression",
          ].includes(candidate.type) ||
          isFunctionLike(candidate)
        )
          return true;
        if (isNodeOfType(candidate, "AssignmentExpression"))
          return (
            candidate !== initializer &&
            !(
              isNodeOfType(initializer, "ExpressionStatement") &&
              initializer.expression === candidate
            )
          );
        return (
          isNodeOfType(candidate, "Property") &&
          (candidate.computed || candidate.method || candidate.kind !== "init")
        );
      }),
    )
  )
    return false;
  const lifecycleMembers = members.filter(
    (member) => getStaticPropertyKeyName(member) === "componentDidUpdate",
  );
  const renderMembers = members.filter((member) => getStaticPropertyKeyName(member) === "render");
  const renderMember = renderMembers[0];
  if (
    lifecycleMembers.length !== 1 ||
    renderMembers.length !== 1 ||
    !isNodeOfType(renderMember, "MethodDefinition") ||
    renderMember.static ||
    renderMember.kind !== "method" ||
    !isNodeOfType(renderMember.value, "FunctionExpression") ||
    renderMember.value.async ||
    renderMember.value.generator ||
    !hasNullRenderBarrier(renderMember.value, setStateCall, lifecycle, fieldName)
  )
    return false;
  const reactSymbol = scopes.symbolFor(reactIdentifier);
  if (
    !reactSymbol ||
    reactSymbol.references.some(({ identifier, flag }) => {
      if (flag !== "read") return true;
      if (identifier === reactIdentifier || isTypeScriptTypePosition(identifier)) return false;
      const owner = identifier.parent;
      return (
        !isNodeOfType(owner, "MemberExpression") ||
        owner.object !== identifier ||
        (!isNodeOfType(owner.parent, "ClassDeclaration") &&
          !isNodeOfType(owner.parent, "ClassExpression")) ||
        owner.parent.superClass !== owner
      );
    })
  )
    return false;
  if (
    comparatorSymbol.references.some(
      (reference) =>
        reference.flag !== "read" ||
        !isNodeOfType(reference.identifier.parent, "CallExpression") ||
        reference.identifier.parent.callee !== reference.identifier ||
        findEnclosingFunction(reference.identifier) !== lifecycle,
    )
  )
    return false;
  let supported = true;
  walkAst(lifecycle.body, (candidate) => {
    if (
      candidate !== lifecycle.body &&
      (isFunctionLike(candidate) ||
        isNodeOfType(candidate, "ClassDeclaration") ||
        isNodeOfType(candidate, "ClassExpression"))
    )
      supported = false;
    if (
      [
        "AssignmentExpression",
        "UpdateExpression",
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
        "WhileStatement",
        "DoWhileStatement",
        "TryStatement",
        "AwaitExpression",
        "YieldExpression",
      ].includes(candidate.type) ||
      (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "delete")
    )
      supported = false;
    if (
      isNodeOfType(candidate, "MemberExpression") &&
      isNodeOfType(candidate.object, "ThisExpression") &&
      !["state", "props", "setState"].includes(getStaticPropertyName(candidate) ?? "")
    )
      supported = false;
    if (isNodeOfType(candidate, "NewExpression")) supported = false;
    if (isNodeOfType(candidate, "CallExpression")) {
      if (
        isNodeOfType(candidate.callee, "Identifier") &&
        scopes.symbolFor(candidate.callee) === comparatorSymbol
      )
        return;
      const callee = candidate.callee;
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        callee.computed ||
        callee.optional ||
        !isNodeOfType(callee.object, "ThisExpression") ||
        getStaticPropertyName(callee) !== "setState" ||
        candidate.arguments.length !== 1 ||
        !isNodeOfType(candidate.arguments[0], "ObjectExpression")
      ) {
        supported = false;
        return false;
      }
      const keys = new Set<string>();
      let writesOtherField = false;
      for (const written of candidate.arguments[0].properties) {
        if (
          !isNodeOfType(written, "Property") ||
          written.computed ||
          written.method ||
          written.kind !== "init"
        ) {
          supported = false;
          break;
        }
        const key = getStaticPropertyKeyName(written);
        if (!key || keys.has(key) || (key === fieldName && !isEmptyRecord(written.value))) {
          supported = false;
          break;
        }
        if (key !== fieldName) writesOtherField = true;
        keys.add(key);
      }
      if (writesOtherField && !isPropsTransitionUpdate(candidate)) supported = false;
    }
    return supported;
  });
  if (!supported) return false;
  const isUnsupportedRuntimeCandidate = (candidate: EsTreeNode): boolean => {
    if (
      [
        "TSEnumDeclaration",
        "TSModuleDeclaration",
        "TSImportEqualsDeclaration",
        "TSExportAssignment",
        "TSParameterProperty",
        "ImportExpression",
        "Decorator",
        "NewExpression",
      ].includes(candidate.type)
    )
      return true;
    if (
      isNodeOfType(candidate, "Identifier") &&
      [
        "Object",
        "Reflect",
        "eval",
        "Function",
        "require",
        "window",
        "globalThis",
        "document",
      ].includes(candidate.name)
    )
      return true;
    if (isNodeOfType(candidate, "MemberExpression")) {
      const name = getStaticPropertyName(candidate);
      if (
        !name ||
        ["prototype", "constructor", "__proto__"].includes(name) ||
        isNodeOfType(candidate.object, "Super")
      )
        return true;
      if (
        isNodeOfType(candidate.object, "ThisExpression") &&
        hasOwnThis(candidate, classNode) &&
        isWithinAssignmentTarget(candidate)
      ) {
        const method = findEnclosingFunction(candidate)?.parent;
        const assignment = candidate.parent;
        if (
          !(
            name === "state" &&
            isNodeOfType(assignment, "AssignmentExpression") &&
            assignment.left === candidate &&
            assignment.operator === "=" &&
            isNodeOfType(assignment.right, "ObjectExpression") &&
            isNodeOfType(method, "MethodDefinition") &&
            method.parent === classNode.body &&
            getStaticPropertyKeyName(method) === "constructor"
          )
        )
          return true;
      }
      if (getStateField(candidate) === fieldName) {
        const parent = candidate.parent;
        if (isWithinAssignmentTarget(candidate)) return true;
        const isComparatorArgument =
          isNodeOfType(parent, "CallExpression") &&
          parent.arguments.some((argument) => argument === candidate) &&
          isNodeOfType(parent.callee, "Identifier") &&
          scopes.symbolFor(parent.callee) === comparatorSymbol &&
          findEnclosingFunction(candidate) === lifecycle;
        const isFreshRecordSpread =
          isNodeOfType(parent, "SpreadElement") &&
          parent.argument === candidate &&
          isNodeOfType(parent.parent, "ObjectExpression");
        if (!isComparatorArgument && !isFreshRecordSpread) return true;
      }
      if (name === "setState")
        return (
          !isNodeOfType(candidate.object, "ThisExpression") ||
          !hasOwnThis(candidate, classNode) ||
          !isNodeOfType(candidate.parent, "CallExpression") ||
          candidate.parent.callee !== candidate
        );
      if (name === "state") {
        if (!isNodeOfType(candidate.object, "ThisExpression") || !hasOwnThis(candidate, classNode))
          return true;
        if (
          isNodeOfType(candidate.parent, "MemberExpression") &&
          candidate.parent.object === candidate
        )
          return false;
        const method = findEnclosingFunction(candidate)?.parent;
        return (
          !isNodeOfType(candidate.parent, "AssignmentExpression") ||
          candidate.parent.left !== candidate ||
          candidate.parent.operator !== "=" ||
          !isNodeOfType(candidate.parent.right, "ObjectExpression") ||
          !isNodeOfType(method, "MethodDefinition") ||
          getStaticPropertyKeyName(method) !== "constructor"
        );
      }
    }
    if (
      isNodeOfType(candidate, "Property") &&
      isNodeOfType(candidate.parent, "ObjectPattern") &&
      ["state", "setState", fieldName].includes(getStaticPropertyKeyName(candidate) ?? "")
    )
      return true;
    if (isNodeOfType(candidate, "CallExpression") && findEnclosingClass(candidate) !== classNode)
      return true;
    if (isNodeOfType(candidate, "ThisExpression")) {
      if (!hasOwnThis(candidate, classNode)) return true;
      if (
        isNodeOfType(candidate.parent, "MemberExpression") &&
        candidate.parent.object === candidate
      )
        return false;
      const call = candidate.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.arguments.length !== 1 ||
        call.arguments[0] !== candidate ||
        !isNodeOfType(call.callee, "MemberExpression") ||
        getStaticPropertyName(call.callee) !== "bind" ||
        !isNodeOfType(call.callee.object, "MemberExpression") ||
        !isNodeOfType(call.callee.object.object, "ThisExpression")
      )
        return true;
    }
    return false;
  };
  let hasUnsupportedRuntime = false;
  walkAst(scopes.rootScope.node, (candidate) => {
    if (
      hasUnsupportedRuntime ||
      isNodeOfType(candidate, "TSInterfaceDeclaration") ||
      isNodeOfType(candidate, "TSTypeAliasDeclaration")
    )
      return false;
    hasUnsupportedRuntime = isUnsupportedRuntimeCandidate(candidate);
    return !hasUnsupportedRuntime;
  });
  return !hasUnsupportedRuntime;
};
