import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { ClosedJsonSnapshotModule } from "./get-closed-json-snapshot-project.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { hasClosedJsonSnapshotNativeAttributes } from "./has-closed-json-snapshot-native-attributes.js";
import { isImportedFromReact, isReactNamespaceImport } from "./is-react-api-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenReactClassComponent } from "./is-proven-react-class-component.js";
import { walkAst } from "./walk-ast.js";

export interface ClosedJsonSnapshotClassCarrierInput {
  readonly classNode: EsTreeNode;
  readonly module: ClosedJsonSnapshotModule;
}

interface SnapshotClassErrorState {
  readonly propertyName: string;
  readonly value: boolean;
}

const readErrorState = (
  expression: EsTreeNode | null | undefined,
): SnapshotClassErrorState | null => {
  if (!isNodeOfType(expression, "ObjectExpression") || expression.properties.length !== 1)
    return null;
  const property = expression.properties[0];
  if (
    !isNodeOfType(property, "Property") ||
    property.method ||
    property.kind !== "init" ||
    property.computed ||
    !isNodeOfType(property.value, "Literal") ||
    typeof property.value.value !== "boolean"
  )
    return null;
  const propertyName = getStaticPropertyKeyName(property);
  if (!propertyName || ["__proto__", "constructor", "prototype"].includes(propertyName))
    return null;
  return { propertyName, value: property.value.value };
};

const isThisMember = (expression: EsTreeNode, propertyName: string): boolean =>
  isNodeOfType(expression, "MemberExpression") &&
  !expression.optional &&
  !expression.computed &&
  getStaticPropertyName(expression) === propertyName &&
  isNodeOfType(expression.object, "ThisExpression");

const isUnchangedChildren = (expression: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(expression, "MemberExpression") &&
  !expression.optional &&
  !expression.computed &&
  getStaticPropertyName(expression) === "children" &&
  isThisMember(expression.object, "props");

const isErrorStateTest = (expression: EsTreeNode, stateName: string): boolean =>
  isNodeOfType(expression, "MemberExpression") &&
  !expression.optional &&
  !expression.computed &&
  getStaticPropertyName(expression) === stateName &&
  isThisMember(expression.object, "state");

const hasNativeFallback = (
  expression: EsTreeNode | null | undefined,
  module: ClosedJsonSnapshotModule,
): boolean => {
  if (isNodeOfType(expression, "Literal"))
    return expression.value === null || typeof expression.value === "string";
  if (!isNodeOfType(expression, "JSXElement") && !isNodeOfType(expression, "JSXFragment"))
    return false;
  let isSafe = true;
  walkAst(expression, (node) => {
    if (!isSafe) return false;
    if (isNodeOfType(node, "JSXOpeningElement")) {
      if (!hasClosedJsonSnapshotNativeAttributes(node, null, module.scopes)) isSafe = false;
    } else if (isNodeOfType(node, "JSXExpressionContainer")) {
      if (
        !isNodeOfType(node.expression, "Literal") ||
        !(
          node.expression.value === null ||
          typeof node.expression.value === "string" ||
          typeof node.expression.value === "number"
        )
      )
        isSafe = false;
    } else if (isNodeOfType(node, "JSXSpreadChild")) isSafe = false;
  });
  return isSafe;
};

const hasOrdinaryLogging = (
  method: EsTreeNodeOfType<"MethodDefinition">,
  module: ClosedJsonSnapshotModule,
): boolean => {
  if (
    method.static ||
    method.value.params.length > 2 ||
    !isNodeOfType(method.value.body, "BlockStatement")
  )
    return false;
  const parameters = method.value.params;
  if (!parameters.every((parameter) => isNodeOfType(parameter, "Identifier"))) return false;
  return method.value.body.body.every((statement) => {
    if (
      !isNodeOfType(statement, "ExpressionStatement") ||
      !isNodeOfType(statement.expression, "CallExpression")
    )
      return false;
    const call = statement.expression;
    if (
      call.optional ||
      !isNodeOfType(call.callee, "MemberExpression") ||
      call.callee.computed ||
      call.callee.optional ||
      !["error", "warn", "log", "info"].includes(getStaticPropertyName(call.callee) ?? "") ||
      !isNodeOfType(call.callee.object, "Identifier") ||
      call.callee.object.name !== "console" ||
      !module.scopes.isGlobalReference(call.callee.object)
    )
      return false;
    return call.arguments.every((argument) => {
      if (isNodeOfType(argument, "Literal"))
        return (
          typeof argument.value === "string" ||
          typeof argument.value === "number" ||
          argument.value === null
        );
      const root = isNodeOfType(argument, "MemberExpression") ? argument.object : argument;
      if (
        !isNodeOfType(root, "Identifier") ||
        !parameters.some(
          (parameter) => module.scopes.symbolFor(parameter) === module.scopes.symbolFor(root),
        )
      )
        return false;
      return (
        argument === root ||
        (isNodeOfType(argument, "MemberExpression") &&
          !argument.computed &&
          !argument.optional &&
          ["message", "stack", "componentStack"].includes(getStaticPropertyName(argument) ?? ""))
      );
    });
  });
};

const readConstructorState = (
  constructor: EsTreeNodeOfType<"MethodDefinition">,
  module: ClosedJsonSnapshotModule,
): SnapshotClassErrorState | null | false => {
  if (
    constructor.static ||
    constructor.value.params.length !== 1 ||
    !isNodeOfType(constructor.value.params[0], "Identifier") ||
    !isNodeOfType(constructor.value.body, "BlockStatement")
  )
    return false;
  const parameter = constructor.value.params[0];
  const statements = constructor.value.body.body;
  const superStatement = statements[0];
  if (
    !isNodeOfType(superStatement, "ExpressionStatement") ||
    !isNodeOfType(superStatement.expression, "CallExpression") ||
    !isNodeOfType(superStatement.expression.callee, "Super") ||
    superStatement.expression.arguments.length !== 1 ||
    !isNodeOfType(superStatement.expression.arguments[0], "Identifier") ||
    module.scopes.symbolFor(superStatement.expression.arguments[0]) !==
      module.scopes.symbolFor(parameter)
  )
    return false;
  if (statements.length === 1) return null;
  if (statements.length !== 2) return false;
  const stateStatement = statements[1];
  if (
    !isNodeOfType(stateStatement, "ExpressionStatement") ||
    !isNodeOfType(stateStatement.expression, "AssignmentExpression") ||
    stateStatement.expression.operator !== "=" ||
    !isThisMember(stateStatement.expression.left, "state")
  )
    return false;
  return readErrorState(stateStatement.expression.right) ?? false;
};

const hasUnchangedRender = (
  render: EsTreeNodeOfType<"MethodDefinition">,
  errorState: SnapshotClassErrorState | null,
  module: ClosedJsonSnapshotModule,
): boolean => {
  if (
    render.static ||
    render.value.params.length !== 0 ||
    !isNodeOfType(render.value.body, "BlockStatement")
  )
    return false;
  if (!errorState) return isUnchangedChildren(getSingleReturnExpression(render.value));
  const singleReturn = getSingleReturnExpression(render.value);
  if (isNodeOfType(singleReturn, "ConditionalExpression")) {
    return (
      isErrorStateTest(singleReturn.test, errorState.propertyName) &&
      hasNativeFallback(singleReturn.consequent, module) &&
      isUnchangedChildren(singleReturn.alternate)
    );
  }
  const statements = render.value.body.body;
  if (statements.length !== 2) return false;
  const guard = statements[0];
  const childrenReturn = statements[1];
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isErrorStateTest(guard.test, errorState.propertyName) ||
    !isNodeOfType(childrenReturn, "ReturnStatement") ||
    !isUnchangedChildren(childrenReturn.argument)
  )
    return false;
  const fallbackReturn =
    isNodeOfType(guard.consequent, "BlockStatement") && guard.consequent.body.length === 1
      ? guard.consequent.body[0]
      : guard.consequent;
  return (
    isNodeOfType(fallbackReturn, "ReturnStatement") &&
    hasNativeFallback(fallbackReturn.argument, module)
  );
};

export const isClosedJsonSnapshotClassCarrier = ({
  classNode,
  module,
}: ClosedJsonSnapshotClassCarrierInput): boolean => {
  if (
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    classNode.decorators.length !== 0 ||
    !classNode.superClass ||
    !isProvenReactClassComponent(classNode, module.scopes)
  )
    return false;
  const superclass = classNode.superClass;
  if (isNodeOfType(superclass, "Identifier")) {
    const symbol = module.scopes.symbolFor(superclass);
    if (
      !symbol ||
      !isImportedFromReact(symbol) ||
      getImportedName(symbol.declarationNode) !== "Component"
    )
      return false;
  } else if (
    !isNodeOfType(superclass, "MemberExpression") ||
    superclass.computed ||
    superclass.optional ||
    getStaticPropertyName(superclass) !== "Component" ||
    !isNodeOfType(superclass.object, "Identifier") ||
    !isReactNamespaceImport(superclass.object, module.scopes)
  )
    return false;
  let render: EsTreeNodeOfType<"MethodDefinition"> | null = null;
  let initialState: SnapshotClassErrorState | null = null;
  let derivedState: SnapshotClassErrorState | null = null;
  const memberNames = new Set<string>();
  for (const member of classNode.body.body) {
    if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition"))
      return false;
    const memberName = getStaticPropertyKeyName(member);
    if (
      !memberName ||
      memberNames.has(memberName) ||
      member.computed ||
      member.decorators.length !== 0
    )
      return false;
    memberNames.add(memberName);
    if (isNodeOfType(member, "PropertyDefinition")) {
      if (member.static || memberName !== "state") return false;
      const state = readErrorState(member.value);
      if (!state || initialState) return false;
      initialState = state;
      continue;
    }
    if (
      !isNodeOfType(member, "MethodDefinition") ||
      member.value.async ||
      member.value.generator ||
      !["method", "constructor"].includes(member.kind)
    )
      return false;
    if (memberName === "constructor") {
      const state = readConstructorState(member, module);
      if (state === false || (state && initialState)) return false;
      if (state) initialState = state;
    } else if (memberName === "render") render = member;
    else if (memberName === "getDerivedStateFromError") {
      if (
        !member.static ||
        member.value.params.length > 1 ||
        member.value.params.some(
          (parameter) =>
            !isNodeOfType(parameter, "Identifier") ||
            (module.scopes.symbolFor(parameter)?.references.length ?? 0) !== 0,
        )
      )
        return false;
      derivedState = readErrorState(getSingleReturnExpression(member.value));
      if (!derivedState) return false;
    } else if (memberName === "componentDidCatch") {
      if (!hasOrdinaryLogging(member, module)) return false;
    } else return false;
  }
  if (!render) return false;
  if (initialState || derivedState || memberNames.has("componentDidCatch")) {
    if (
      !initialState ||
      initialState.value ||
      !derivedState ||
      !derivedState.value ||
      initialState.propertyName !== derivedState.propertyName
    )
      return false;
  }
  return hasUnchangedRender(render, initialState, module);
};
