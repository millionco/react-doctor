import { HOOKS_WITH_DEPS } from "../../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { findExportedValue } from "../find-exported-value.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { getImportedName } from "../get-imported-name.js";
import { getStaticPropertyKeyName } from "../get-static-property-key-name.js";
import { getStaticPropertyName } from "../get-static-property-name.js";
import { isFunctionLike } from "../is-function-like.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isWithinAssignmentTarget } from "../is-within-assignment-target.js";
import { isClosedReactHookCall } from "./is-closed-react-hook-call.js";
import type { RuleContext } from "../rule-context.js";
import { resolveReactUseStatePair } from "../resolve-react-use-state-pair.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { walkAst } from "../walk-ast.js";
import {
  IMPERATIVE_CERTIFICATE_MAX_DEPTH,
  IMPERATIVE_NATIVE_ANCESTOR_NAME_PATTERN,
} from "./imperative-state/constants.js";
import {
  isImperativePrimitive,
  type ImperativePrimitiveEnvironment,
} from "./is-imperative-primitive.js";

interface ImperativeRefCall {
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly methodName: string;
}

interface ImperativeChildTarget {
  readonly module: SourceProjectModule;
  readonly component: EsTreeNode;
  readonly refSymbol: SymbolDescriptor;
}

const isImperativeReadonlySymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");

const getImperativeReturnedExpression = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode) || functionNode.async || functionNode.generator) return null;
  if (!isNodeOfType(functionNode.body, "BlockStatement"))
    return stripParenExpression(functionNode.body);
  if (functionNode.body.body.length !== 1) return null;
  const statement = functionNode.body.body[0];
  return statement && isNodeOfType(statement, "ReturnStatement") && statement.argument
    ? stripParenExpression(statement.argument)
    : null;
};

const getImperativeRefCall = (identifier: EsTreeNode): ImperativeRefCall | null => {
  const currentMember = findTransparentExpressionRoot(identifier).parent;
  if (
    !currentMember ||
    !isNodeOfType(currentMember, "MemberExpression") ||
    currentMember.object !== findTransparentExpressionRoot(identifier) ||
    getStaticPropertyName(currentMember) !== "current"
  )
    return null;
  const methodMember = findTransparentExpressionRoot(currentMember).parent;
  if (
    !methodMember ||
    !isNodeOfType(methodMember, "MemberExpression") ||
    methodMember.object !== findTransparentExpressionRoot(currentMember)
  )
    return null;
  const methodName = getStaticPropertyName(methodMember);
  const call = findTransparentExpressionRoot(methodMember).parent;
  return methodName &&
    call &&
    isNodeOfType(call, "CallExpression") &&
    call.callee === findTransparentExpressionRoot(methodMember)
    ? { call, methodName }
    : null;
};

const isImperativeStableComponent = (
  component: EsTreeNode,
  module: SourceProjectModule,
): boolean => {
  if (!isFunctionLike(component)) return false;
  if (isNodeOfType(component, "FunctionDeclaration") && component.id) {
    const symbol = module.scopes.symbolFor(component.id);
    return Boolean(symbol && isImperativeReadonlySymbol(symbol));
  }
  const root = findTransparentExpressionRoot(component);
  const declaration = root.parent;
  if (declaration && isNodeOfType(declaration, "ExportDefaultDeclaration")) return true;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return false;
  const symbol = module.scopes.symbolFor(declaration.id);
  return Boolean(symbol && symbol.kind === "const" && isImperativeReadonlySymbol(symbol));
};

const resolveImperativeComponent = (
  name: EsTreeNode,
  module: SourceProjectModule,
  projectIndex: SourceProjectIndex,
  visitedModules: ReadonlySet<string> = new Set(),
): { module: SourceProjectModule; component: EsTreeNode } | null => {
  if (visitedModules.size >= IMPERATIVE_CERTIFICATE_MAX_DEPTH) return null;
  const symbol = module.scopes.symbolFor(name);
  if (!symbol || !isImperativeReadonlySymbol(symbol)) return null;
  const declaration = symbol.declarationNode;
  if (isFunctionLike(declaration)) return { module, component: declaration };
  if (
    symbol.kind === "const" &&
    symbol.initializer &&
    isFunctionLike(stripParenExpression(symbol.initializer))
  )
    return { module, component: stripParenExpression(symbol.initializer) };
  if (
    !isNodeOfType(declaration, "ImportSpecifier") &&
    !isNodeOfType(declaration, "ImportDefaultSpecifier")
  )
    return null;
  const importDeclaration = declaration.parent;
  if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return null;
  const sourcePath = projectIndex.resolvedSourcePathByNode.get(importDeclaration);
  const importedModule = sourcePath ? projectIndex.modulesByFilePath.get(sourcePath) : null;
  if (!importedModule || visitedModules.has(importedModule.filePath)) return null;
  const exportedName = isNodeOfType(declaration, "ImportDefaultSpecifier")
    ? "default"
    : getImportedName(declaration);
  const exportedValue = exportedName
    ? findExportedValue(importedModule.programNode, exportedName)
    : null;
  if (!exportedValue) return null;
  if (isFunctionLike(exportedValue))
    return isImperativeStableComponent(exportedValue, importedModule)
      ? { module: importedModule, component: exportedValue }
      : null;
  return isNodeOfType(exportedValue, "Identifier")
    ? resolveImperativeComponent(
        exportedValue,
        importedModule,
        projectIndex,
        new Set([...visitedModules, module.filePath]),
      )
    : null;
};

const isImperativeClosedChildPlacement = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  let current = attribute.parent?.parent;
  if (!current || !isNodeOfType(current, "JSXElement")) return false;
  while (current.parent) {
    const parent: EsTreeNode = current.parent;
    if (isNodeOfType(parent, "ReturnStatement")) return parent.argument === current;
    if (isNodeOfType(parent, "JSXFragment")) {
      current = parent;
      continue;
    }
    if (
      !isNodeOfType(parent, "JSXElement") ||
      !isNodeOfType(parent.openingElement.name, "JSXIdentifier") ||
      !IMPERATIVE_NATIVE_ANCESTOR_NAME_PATTERN.test(parent.openingElement.name.name)
    )
      return false;
    current = parent;
  }
  return false;
};

const hasImperativeDynamicScopeEscape = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let hasEscape = false;
  walkAst(node, (child) => {
    if (isNodeOfType(child, "WithStatement")) hasEscape = true;
    if (!isNodeOfType(child, "Identifier") || !scopes.isGlobalReference(child)) return;
    if (child.name === "arguments") hasEscape = true;
    if (
      child.name === "eval" &&
      child.parent &&
      isNodeOfType(child.parent, "CallExpression") &&
      child.parent.callee === child
    )
      hasEscape = true;
  });
  return hasEscape;
};

const getImperativeChildTarget = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  parentModule: SourceProjectModule,
  projectIndex: SourceProjectIndex,
): ImperativeChildTarget | null => {
  if (
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    !isImperativeClosedChildPlacement(attribute)
  )
    return null;
  const opening = attribute.parent;
  if (
    !opening ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.attributes.some((entry) => isNodeOfType(entry, "JSXSpreadAttribute"))
  )
    return null;
  if (
    opening.attributes.filter(
      (entry) =>
        isNodeOfType(entry, "JSXAttribute") &&
        isNodeOfType(entry.name, "JSXIdentifier") &&
        entry.name.name === attribute.name.name,
    ).length !== 1
  )
    return null;
  const resolved = resolveImperativeComponent(opening.name, parentModule, projectIndex);
  if (
    !resolved ||
    !isFunctionLike(resolved.component) ||
    resolved.component.async ||
    resolved.component.params.length !== 1
  )
    return null;
  const parameter = resolved.component.params[0];
  if (
    !parameter ||
    !isNodeOfType(parameter, "ObjectPattern") ||
    parameter.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.kind !== "init" ||
        !isNodeOfType(property.value, "Identifier"),
    )
  )
    return null;
  const matches = parameter.properties.filter(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property) === attribute.name.name,
  );
  if (matches.length !== 1) return null;
  const property = matches[0];
  if (
    !property ||
    !isNodeOfType(property, "Property") ||
    !isNodeOfType(property.value, "Identifier")
  )
    return null;
  const refSymbol = resolved.module.scopes.symbolFor(property.value);
  return refSymbol && isImperativeReadonlySymbol(refSymbol) ? { ...resolved, refSymbol } : null;
};

const isImperativeOwnRecordUpdater = (
  rawUpdater: EsTreeNode,
  environment: ImperativePrimitiveEnvironment,
): boolean => {
  const updater = stripParenExpression(rawUpdater);
  if (
    !isFunctionLike(updater) ||
    updater.params.length !== 1 ||
    !isNodeOfType(updater.params[0], "Identifier")
  )
    return false;
  const previousSymbol = environment.scopes.symbolFor(updater.params[0]);
  const returned = getImperativeReturnedExpression(updater);
  if (
    !previousSymbol ||
    !isImperativeReadonlySymbol(previousSymbol) ||
    !returned ||
    !isNodeOfType(returned, "ObjectExpression") ||
    returned.properties.length < 2
  )
    return false;
  const previousSpread = returned.properties[0];
  if (
    !previousSpread ||
    !isNodeOfType(previousSpread, "SpreadElement") ||
    !isNodeOfType(previousSpread.argument, "Identifier") ||
    environment.scopes.symbolFor(previousSpread.argument) !== previousSymbol ||
    previousSymbol.references.length !== 1
  )
    return false;
  return returned.properties
    .slice(1)
    .every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.method &&
        property.computed &&
        isImperativePrimitive(property.key, environment) &&
        isImperativePrimitive(property.value, environment),
    );
};

const hasImperativeClosedRecordWriters = (
  setterIdentifier: EsTreeNode,
  environment: ImperativePrimitiveEnvironment,
  childComponent: EsTreeNode,
): boolean => {
  const pair = resolveReactUseStatePair(setterIdentifier, environment.scopes);
  if (
    !pair ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    !isClosedReactHookCall(pair.declarator.init, "useState", environment.scopes) ||
    pair.declarator.init.arguments.length !== 1
  )
    return false;
  let owner: EsTreeNode | null | undefined = pair.declarator.parent;
  while (owner && !isFunctionLike(owner)) owner = owner.parent;
  if (owner !== childComponent) return false;
  const initializer = pair.declarator.init.arguments[0];
  if (!initializer) return false;
  const initialValue = stripParenExpression(initializer);
  if (
    !isNodeOfType(initialValue, "ObjectExpression") ||
    initialValue.properties.length !== 0 ||
    !isImperativeReadonlySymbol(pair.setterSymbol)
  )
    return false;
  if (
    !pair.setterSymbol.references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      const call = root.parent;
      return Boolean(
        call &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === root &&
        call.arguments.length === 1 &&
        call.arguments[0] &&
        isImperativeOwnRecordUpdater(call.arguments[0], environment),
      );
    })
  )
    return false;
  return (
    !pair.stateSymbol ||
    pair.stateSymbol.references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      const member = root.parent;
      if (member && isNodeOfType(member, "ArrayExpression")) {
        const dependencyExpression = findTransparentExpressionRoot(member);
        const dependencyCall = dependencyExpression.parent;
        if (
          reference.flag !== "read" ||
          !dependencyCall ||
          !isNodeOfType(dependencyCall, "CallExpression") ||
          dependencyCall.optional
        )
          return false;
        const [callback, dependencies, ...extraArguments] = dependencyCall.arguments;
        const callee = stripParenExpression(dependencyCall.callee);
        let hookOwner: EsTreeNode | null | undefined = dependencyCall.parent;
        while (hookOwner && !isFunctionLike(hookOwner)) hookOwner = hookOwner.parent;
        return Boolean(
          callback &&
          !isNodeOfType(callback, "SpreadElement") &&
          dependencies === dependencyExpression &&
          extraArguments.length === 0 &&
          member.elements.some((element) => element === root) &&
          member.elements.every((element) =>
            Boolean(element && !isNodeOfType(element, "SpreadElement")),
          ) &&
          hookOwner === childComponent &&
          (!isNodeOfType(callee, "MemberExpression") || !callee.optional) &&
          [...HOOKS_WITH_DEPS].some((hookName) =>
            isClosedReactHookCall(dependencyCall, hookName, environment.scopes),
          ),
        );
      }
      if (!member || !isNodeOfType(member, "MemberExpression") || member.object !== root)
        return false;
      const memberRoot = findTransparentExpressionRoot(member);
      const parent = memberRoot.parent;
      return Boolean(
        parent &&
        !isWithinAssignmentTarget(memberRoot) &&
        !(
          (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
          parent.callee === memberRoot
        ) &&
        !(isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === memberRoot),
      );
    })
  );
};

const isImperativeStateMethod = (method: EsTreeNode, child: ImperativeChildTarget): boolean => {
  if (
    !isFunctionLike(method) ||
    method.async ||
    method.generator ||
    method.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  )
    return false;
  const primitiveSymbols = new Set<SymbolDescriptor>();
  for (const parameter of method.params) {
    const symbol = child.module.scopes.symbolFor(parameter);
    if (!symbol || !isImperativeReadonlySymbol(symbol)) return false;
    primitiveSymbols.add(symbol);
  }
  const environment = { scopes: child.module.scopes, primitiveSymbols };
  let hasSetter = false;
  const certifyExpression = (rawExpression: EsTreeNode): boolean => {
    const expression = stripParenExpression(rawExpression);
    if (
      !isNodeOfType(expression, "CallExpression") ||
      !isNodeOfType(expression.callee, "Identifier") ||
      expression.arguments.length !== 1
    )
      return false;
    if (!hasImperativeClosedRecordWriters(expression.callee, environment, child.component))
      return false;
    hasSetter = true;
    return true;
  };
  if (!isNodeOfType(method.body, "BlockStatement")) return certifyExpression(method.body);
  for (const statement of method.body.body) {
    if (isNodeOfType(statement, "ExpressionStatement") && certifyExpression(statement.expression))
      continue;
    if (
      isNodeOfType(statement, "ReturnStatement") &&
      statement.argument &&
      certifyExpression(statement.argument)
    )
      continue;
    if (
      isNodeOfType(statement, "VariableDeclaration") &&
      statement.kind === "const" &&
      statement.declarations.every(
        (declaration) =>
          isNodeOfType(declaration.id, "Identifier") &&
          declaration.init &&
          isImperativePrimitive(declaration.init, environment),
      )
    )
      continue;
    return false;
  }
  return hasSetter;
};

export const certifyImperativeStateCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
  isPrimitiveArgument?: (argument: EsTreeNode) => boolean,
): boolean => {
  const parentModule = [...projectIndex.modulesByFilePath.values()].find(
    (module) => module.programNode === context.scopes.rootScope.node,
  );
  if (!parentModule) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const currentMember = stripParenExpression(callee.object);
  if (
    !isNodeOfType(currentMember, "MemberExpression") ||
    getStaticPropertyName(currentMember) !== "current" ||
    !isNodeOfType(stripParenExpression(currentMember.object), "Identifier")
  )
    return false;
  const refIdentifier = stripParenExpression(currentMember.object);
  const refSymbol = parentModule.scopes.symbolFor(refIdentifier);
  if (
    !refSymbol ||
    refSymbol.kind !== "const" ||
    !isImperativeReadonlySymbol(refSymbol) ||
    !refSymbol.initializer
  )
    return false;
  const initializer = stripParenExpression(refSymbol.initializer);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    !isClosedReactHookCall(initializer, "useRef", parentModule.scopes) ||
    initializer.arguments.length !== 1 ||
    !isNodeOfType(initializer.arguments[0], "Literal") ||
    initializer.arguments[0].value !== null
  )
    return false;
  let refOwner: EsTreeNode | null | undefined = refSymbol.declarationNode.parent;
  while (refOwner && !isFunctionLike(refOwner)) refOwner = refOwner.parent;
  if (!refOwner || hasImperativeDynamicScopeEscape(refOwner, parentModule.scopes)) return false;
  const refCalls: ImperativeRefCall[] = [];
  const refAttributes: EsTreeNodeOfType<"JSXAttribute">[] = [];
  for (const reference of refSymbol.references) {
    const referenceCall = getImperativeRefCall(reference.identifier);
    if (referenceCall) {
      refCalls.push(referenceCall);
      continue;
    }
    const expression = findTransparentExpressionRoot(reference.identifier).parent;
    const attribute = expression?.parent;
    if (
      !expression ||
      !isNodeOfType(expression, "JSXExpressionContainer") ||
      !attribute ||
      !isNodeOfType(attribute, "JSXAttribute")
    )
      return false;
    let attributeOwner: EsTreeNode | null | undefined = attribute.parent;
    while (attributeOwner && !isFunctionLike(attributeOwner))
      attributeOwner = attributeOwner.parent;
    if (attributeOwner !== refOwner) return false;
    refAttributes.push(attribute);
  }
  if (refAttributes.length !== 1) return false;
  const selectedCall = refCalls.find((entry) => entry.call === call);
  const attribute = refAttributes[0];
  if (!selectedCall || !attribute) return false;
  const environment = {
    scopes: parentModule.scopes,
    primitiveSymbols: new Set<SymbolDescriptor>(),
  };
  if (
    !refCalls
      .filter((entry) => entry.methodName === selectedCall.methodName)
      .every((entry) =>
        entry.call.arguments.every(
          (argument) =>
            !isNodeOfType(argument, "SpreadElement") &&
            (isImperativePrimitive(argument, environment) ||
              Boolean(isPrimitiveArgument?.(argument))),
        ),
      )
  )
    return false;
  const child = getImperativeChildTarget(attribute, parentModule, projectIndex);
  if (
    !child ||
    child.refSymbol.references.length !== 1 ||
    hasImperativeDynamicScopeEscape(child.component, child.module.scopes)
  )
    return false;
  const childRef = child.refSymbol.references[0]?.identifier;
  if (!childRef) return false;
  const handleCall = findTransparentExpressionRoot(childRef).parent;
  if (
    !handleCall ||
    !isNodeOfType(handleCall, "CallExpression") ||
    handleCall.arguments[0] !== findTransparentExpressionRoot(childRef) ||
    !isClosedReactHookCall(handleCall, "useImperativeHandle", child.module.scopes) ||
    handleCall.arguments.length < 2 ||
    handleCall.arguments.length > 3
  )
    return false;
  let handleOwner: EsTreeNode | null | undefined = handleCall.parent;
  while (handleOwner && !isFunctionLike(handleOwner)) handleOwner = handleOwner.parent;
  if (handleOwner !== child.component) return false;
  const factory = handleCall.arguments[1];
  if (!factory || !isFunctionLike(stripParenExpression(factory))) return false;
  const factoryFunction = stripParenExpression(factory);
  if (!isFunctionLike(factoryFunction) || factoryFunction.params.length !== 0) return false;
  const handle = getImperativeReturnedExpression(factoryFunction);
  if (!handle || !isNodeOfType(handle, "ObjectExpression")) return false;
  const propertyNames = new Set<string>();
  let selectedMethod: EsTreeNode | null = null;
  for (const property of handle.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      !isFunctionLike(stripParenExpression(property.value))
    )
      return false;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (
      !propertyName ||
      propertyNames.has(propertyName) ||
      (propertyName === "__proto__" && !property.computed && !property.method)
    )
      return false;
    let hasHandleReceiver = false;
    walkAst(property.value, (node) => {
      if (isNodeOfType(node, "ThisExpression")) hasHandleReceiver = true;
    });
    if (hasHandleReceiver) return false;
    propertyNames.add(propertyName);
    if (propertyName === selectedCall.methodName)
      selectedMethod = stripParenExpression(property.value);
  }
  if (
    !selectedMethod ||
    !isFunctionLike(selectedMethod) ||
    refCalls.some(
      (entry) =>
        entry.methodName === selectedCall.methodName &&
        entry.call.arguments.length !== selectedMethod.params.length,
    )
  )
    return false;
  if (handleCall.arguments[2]) {
    const dependencies = stripParenExpression(handleCall.arguments[2]);
    if (
      !isNodeOfType(dependencies, "ArrayExpression") ||
      dependencies.elements.some(
        (element) =>
          !element ||
          !isNodeOfType(element, "Identifier") ||
          child.module.scopes.symbolFor(element) !== child.refSymbol,
      )
    )
      return false;
  }
  return isImperativeStateMethod(selectedMethod, child);
};
