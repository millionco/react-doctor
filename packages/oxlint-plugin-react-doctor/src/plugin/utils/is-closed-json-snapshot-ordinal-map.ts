import { isClosedJsonSnapshotPublicEntry } from "./is-closed-json-snapshot-public-entry.js";
import { isClosedJsonSnapshotFragmentOpening } from "./is-closed-json-snapshot-fragment-opening.js";
import { isClosedJsonSnapshotStateKeyCount } from "./is-closed-json-snapshot-state-key-count.js";
import { isClosedJsonSnapshotInactiveBranch } from "./is-closed-json-snapshot-inactive-branch.js";
import { getClassBindingSymbol } from "./get-class-binding-symbol.js";
import { getClosedJsonSnapshotComponentExportNames } from "./get-closed-json-snapshot-component-export-names.js";
import { isClosedJsonSnapshotClassCarrier } from "./is-closed-json-snapshot-class-carrier.js";
import { isClosedJsonSnapshotLocaleCarrier } from "./is-closed-json-snapshot-locale-carrier.js";
import { areStaticPropertyPathsDisjoint } from "./are-static-property-paths-disjoint.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import type {
  ClosedJsonSnapshotModule,
  ClosedJsonSnapshotProject,
} from "./get-closed-json-snapshot-project.js";
import { getClosedJsonSnapshotProject } from "./get-closed-json-snapshot-project.js";
import { getClosedJsonSnapshotSourceRole } from "./get-closed-json-snapshot-source-role.js";
import type { ClosedJsonSnapshotSourceRole } from "./get-closed-json-snapshot-source-role.js";
import { getClosedJsonSnapshotLeaf } from "./get-closed-json-snapshot-leaf.js";
import { hasClosedJsonSnapshotNativeAttributes } from "./has-closed-json-snapshot-native-attributes.js";
import { isClosedJsonSnapshotProvider } from "./is-closed-json-snapshot-provider.js";
import { normalizeFilename } from "./normalize-filename.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getFunctionExportNames } from "./get-function-export-names.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isFunctionLike } from "./is-function-like.js";
import { walkAst } from "./walk-ast.js";
import {
  CLOSED_JSON_SNAPSHOT_APPLICATION_SUCCESS_VALUES,
  CLOSED_JSON_SNAPSHOT_ROUTE_PROP_NAMES,
  CLOSED_JSON_SNAPSHOT_PROTOTYPE_PROPERTY_NAMES,
} from "./closed-json-snapshot-owner/constants.js";

interface SnapshotConsumer {
  readonly module: ClosedJsonSnapshotModule;
  readonly reference: EsTreeNode;
}

interface SnapshotAccess {
  readonly symbol: SymbolDescriptor;
  readonly path: ReadonlyArray<string>;
  readonly node: EsTreeNode;
}

const readAccess = (
  expression: EsTreeNode,
  module: ClosedJsonSnapshotModule,
): SnapshotAccess | null => {
  const segments: string[] = [];
  let current = expression;
  while (isNodeOfType(current, "MemberExpression")) {
    const property = getStaticPropertyName(current);
    if (!property || current.optional) return null;
    segments.unshift(property);
    current = current.object;
  }
  if (!isNodeOfType(current, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(current);
  return symbol ? { symbol, path: segments, node: expression } : null;
};

const isExportReference = (reference: EsTreeNode): boolean =>
  reference.parent?.type === "ExportDefaultDeclaration" ||
  reference.parent?.type === "ExportSpecifier";

const isClosedModuleComponent = (
  module: ClosedJsonSnapshotModule,
  component: EsTreeNode,
): boolean => {
  if (
    !(
      isFunctionLike(component) ||
      isNodeOfType(component, "ClassDeclaration") ||
      isNodeOfType(component, "ClassExpression")
    ) ||
    (isFunctionLike(component) && (component.async || component.generator)) ||
    (isNodeOfType(component, "ClassDeclaration") || isNodeOfType(component, "ClassExpression")
      ? module.scopes.ownScopeFor(component)?.parent
      : module.scopes.scopeFor(component)) !== module.scopes.rootScope
  )
    return false;
  const binding =
    isNodeOfType(component, "ClassDeclaration") || isNodeOfType(component, "ClassExpression")
      ? (getClassBindingSymbol(component, module.scopes)?.bindingIdentifier ?? null)
      : getDirectFunctionBindingIdentifier(component);
  const moduleSymbol = isNodeOfType(binding, "Identifier")
    ? module.scopes.rootScope.symbolsByName.get(binding.name)
    : null;
  return binding
    ? moduleSymbol?.bindingIdentifier === binding
    : component.parent?.type === "ExportDefaultDeclaration" &&
        component.parent.parent === module.program;
};

const getConsumers = (
  project: ClosedJsonSnapshotProject,
  module: ClosedJsonSnapshotModule,
  component: EsTreeNode,
): ReadonlyArray<SnapshotConsumer> | null => {
  if (!isNodeOfType(module.program, "Program") || !isClosedModuleComponent(module, component))
    return null;
  const exportNames = getClosedJsonSnapshotComponentExportNames(module, component);
  const binding =
    isNodeOfType(component, "ClassDeclaration") || isNodeOfType(component, "ClassExpression")
      ? (getClassBindingSymbol(component, module.scopes)?.bindingIdentifier ?? null)
      : getDirectFunctionBindingIdentifier(component);
  const localSymbol = isNodeOfType(binding, "Identifier")
    ? module.scopes.rootScope.symbolsByName.get(binding.name)
    : null;
  const recursiveSymbol = binding ? module.scopes.symbolFor(binding) : null;
  const namedExpressionSymbol =
    (isNodeOfType(component, "FunctionExpression") ||
      isNodeOfType(component, "FunctionDeclaration") ||
      isNodeOfType(component, "ClassDeclaration") ||
      isNodeOfType(component, "ClassExpression")) &&
    isNodeOfType(component.id, "Identifier")
      ? module.scopes.symbolFor(component.id)
      : null;
  const references = new Set([
    ...(localSymbol?.references ?? []),
    ...(recursiveSymbol?.references ?? []),
    ...(namedExpressionSymbol?.references ?? []),
  ]);
  const consumers: SnapshotConsumer[] = [];
  for (const reference of references) {
    if (isClosedJsonSnapshotInactiveBranch(reference.identifier)) continue;
    if (!isExportReference(reference.identifier))
      consumers.push({ module, reference: reference.identifier });
  }
  for (const consumerModule of project.modules.values()) {
    if (!isNodeOfType(consumerModule.program, "Program")) return null;
    for (const statement of consumerModule.program.body) {
      if (
        (isNodeOfType(statement, "ExportNamedDeclaration") ||
          isNodeOfType(statement, "ExportAllDeclaration")) &&
        statement.source
      ) {
        if (
          typeof statement.source.value === "string" &&
          project.resolveImport(consumerModule.filePath, statement.source.value)?.filePath ===
            module.filePath
        )
          return null;
      }
      if (
        !isNodeOfType(statement, "ImportDeclaration") ||
        typeof statement.source.value !== "string"
      )
        continue;
      if (
        project.resolveImport(consumerModule.filePath, statement.source.value)?.filePath !==
        module.filePath
      )
        continue;
      for (const specifier of statement.specifiers) {
        if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) return null;
        const exportedName = isNodeOfType(specifier, "ImportDefaultSpecifier")
          ? "default"
          : isNodeOfType(specifier, "ImportSpecifier")
            ? getModuleSpecifierName(specifier.imported)
            : null;
        if (!exportedName || !exportNames.has(exportedName)) continue;
        const symbol = consumerModule.scopes.symbolFor(specifier.local);
        if (!symbol) return null;
        for (const reference of symbol.references) {
          if (!isClosedJsonSnapshotInactiveBranch(reference.identifier))
            consumers.push({ module: consumerModule, reference: reference.identifier });
        }
      }
    }
  }
  return consumers.length > 0 ? consumers : null;
};

const getOpeningElement = (reference: EsTreeNode): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  const parent = reference.parent;
  if (isNodeOfType(parent, "JSXClosingElement")) return null;
  return isNodeOfType(parent, "JSXOpeningElement") && parent.name === reference ? parent : null;
};

const isClosingElementReference = (reference: EsTreeNode): boolean =>
  reference.parent?.type === "JSXClosingElement";

const isGenuineImport = (
  reference: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  source: string,
  exportedName: string,
): boolean => {
  if (!isNodeOfType(reference, "Identifier") && !isNodeOfType(reference, "JSXIdentifier"))
    return false;
  const symbol = module.scopes.symbolFor(reference);
  if (symbol?.kind !== "import") return false;
  const binding = getImportBindingForName(reference, reference.name);
  return binding?.source === source && binding.exportedName === exportedName;
};

const isEmptyStateTest = (
  test: EsTreeNode,
  state: SymbolDescriptor,
  module: ClosedJsonSnapshotModule,
  hasLodashEmptiness: boolean,
): boolean => {
  if (
    isNodeOfType(test, "BinaryExpression") &&
    (test.operator === "===" || test.operator === "==")
  ) {
    const count =
      isNodeOfType(test.right, "Literal") && test.right.value === 0
        ? test.left
        : isNodeOfType(test.left, "Literal") && test.left.value === 0
          ? test.right
          : null;
    return Boolean(count && isClosedJsonSnapshotStateKeyCount(count, state, module.scopes));
  }
  if (
    isNodeOfType(test, "CallExpression") &&
    test.arguments.length === 1 &&
    isNodeOfType(test.callee, "Identifier")
  ) {
    const binding = getImportBindingForName(test.callee, test.callee.name);
    const access = readAccess(test.arguments[0], module);
    return (
      hasLodashEmptiness &&
      module.scopes.symbolFor(test.callee)?.kind === "import" &&
      ((binding?.source === "lodash/isEmpty" && binding.exportedName === "default") ||
        (binding?.source === "lodash" && binding.exportedName === "isEmpty")) &&
      access?.symbol === state &&
      access.path.length === 0
    );
  }
  return false;
};

const isNonEmptyStateTest = (
  test: EsTreeNode,
  state: SymbolDescriptor,
  module: ClosedJsonSnapshotModule,
  hasLodashEmptiness: boolean,
): boolean =>
  isNodeOfType(test, "UnaryExpression") &&
  test.operator === "!" &&
  isEmptyStateTest(test.argument, state, module, hasLodashEmptiness);

const isEmptinessReference = (
  identifier: EsTreeNode,
  state: SymbolDescriptor,
  module: ClosedJsonSnapshotModule,
  hasLodashEmptiness: boolean,
): boolean => {
  let expression = identifier.parent;
  while (
    expression &&
    (isNodeOfType(expression, "CallExpression") ||
      isNodeOfType(expression, "MemberExpression") ||
      isNodeOfType(expression, "BinaryExpression") ||
      isNodeOfType(expression, "UnaryExpression"))
  ) {
    if (
      isEmptyStateTest(expression, state, module, hasLodashEmptiness) ||
      isClosedJsonSnapshotStateKeyCount(expression, state, module.scopes)
    )
      return true;
    expression = expression.parent;
  }
  return false;
};

const hasEmptyGate = (
  owner: EsTreeNode,
  state: SymbolDescriptor,
  route: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  hasLodashEmptiness: boolean,
): boolean => {
  if (!isFunctionLike(owner) || !isNodeOfType(owner.body, "BlockStatement")) return false;
  let child: EsTreeNode = route;
  let ancestor = route.parent;
  while (ancestor && ancestor !== owner) {
    if (
      (isNodeOfType(ancestor, "ConditionalExpression") || isNodeOfType(ancestor, "IfStatement")) &&
      ancestor.consequent === child &&
      isClosedJsonSnapshotStateKeyCount(ancestor.test, state, module.scopes)
    ) {
      const alternate =
        isNodeOfType(ancestor.alternate, "BlockStatement") && ancestor.alternate.body.length === 1
          ? ancestor.alternate.body[0]
          : ancestor.alternate;
      const omitted = isNodeOfType(alternate, "ReturnStatement") ? alternate.argument : alternate;
      if (
        (isNodeOfType(ancestor, "IfStatement") && !alternate) ||
        (isNodeOfType(omitted, "Literal") && (omitted.value === null || omitted.value === false))
      )
        return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      ((ancestor.alternate === child &&
        isEmptyStateTest(ancestor.test, state, module, hasLodashEmptiness)) ||
        (ancestor.consequent === child &&
          isNonEmptyStateTest(ancestor.test, state, module, hasLodashEmptiness)))
    )
      return true;
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.operator === "&&" &&
      ancestor.right === child &&
      isNonEmptyStateTest(ancestor.left, state, module, hasLodashEmptiness)
    )
      return true;
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ((ancestor.alternate === child &&
        isEmptyStateTest(ancestor.test, state, module, hasLodashEmptiness)) ||
        (ancestor.consequent === child &&
          isNonEmptyStateTest(ancestor.test, state, module, hasLodashEmptiness)))
    )
      return true;
    child = ancestor;
    ancestor = ancestor.parent;
  }
  let routeStatement: EsTreeNode | undefined | null = route;
  while (routeStatement && routeStatement.parent !== owner.body)
    routeStatement = routeStatement.parent;
  let hasPriorEmptyReturn = false;
  for (const statement of owner.body.body) {
    if (statement === routeStatement) return hasPriorEmptyReturn;
    if (
      hasPriorEmptyReturn ||
      !isNodeOfType(statement, "IfStatement") ||
      !isEmptyStateTest(statement.test, state, module, hasLodashEmptiness)
    )
      continue;
    const consequent =
      isNodeOfType(statement.consequent, "BlockStatement") && statement.consequent.body.length === 1
        ? statement.consequent.body[0]
        : statement.consequent;
    hasPriorEmptyReturn =
      isNodeOfType(consequent, "ReturnStatement") &&
      isNodeOfType(consequent.argument, "Literal") &&
      consequent.argument.value === null &&
      !statement.alternate;
  }
  return false;
};

const isClosedSnapshotCarrierOpening = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  module: ClosedJsonSnapshotModule,
  project: ClosedJsonSnapshotProject,
  hasAntdLocaleProvider: boolean,
): boolean => {
  if (hasClosedJsonSnapshotNativeAttributes(opening, null, module.scopes)) return true;
  if (isClosedJsonSnapshotFragmentOpening(opening, module.scopes)) return true;
  if (
    opening.attributes.length === 0 &&
    (isGenuineImport(opening.name, module, "react-router-dom", "BrowserRouter") ||
      isGenuineImport(opening.name, module, "react-router-dom", "Switch"))
  )
    return true;
  if (
    opening.attributes.length === 1 &&
    isGenuineImport(opening.name, module, "react-router-dom", "BrowserRouter")
  ) {
    const attribute = opening.attributes[0];
    if (
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === "basename"
    ) {
      const value = isNodeOfType(attribute.value, "JSXExpressionContainer")
        ? attribute.value.expression
        : attribute.value;
      if (isNodeOfType(value, "Literal") && typeof value.value === "string") return true;
    }
  }
  if (isClosedJsonSnapshotLocaleCarrier({ opening, module, project, hasAntdLocaleProvider }))
    return true;
  if (opening.attributes.length !== 0 || !isNodeOfType(opening.name, "JSXIdentifier")) return false;
  const symbol = module.scopes.symbolFor(opening.name);
  if (!symbol) return false;
  let classModule = module;
  let classNode: EsTreeNode | null = symbol.initializer ?? symbol.declarationNode;
  if (symbol.kind === "import") {
    const binding = getImportBindingForName(opening.name, opening.name.name);
    if (!binding?.exportedName) return false;
    const imported = project.resolveImport(module.filePath, binding.source);
    if (!imported || !isNodeOfType(imported.program, "Program")) return false;
    classModule = imported;
    classNode = null;
    walkAst(imported.program, (candidate) => {
      if (
        (isNodeOfType(candidate, "ClassDeclaration") ||
          isNodeOfType(candidate, "ClassExpression")) &&
        isClosedModuleComponent(imported, candidate) &&
        getClosedJsonSnapshotComponentExportNames(imported, candidate).has(
          binding.exportedName ?? "",
        )
      )
        classNode = candidate;
    });
  }
  if (!classNode || !isClosedJsonSnapshotClassCarrier({ classNode, module: classModule }))
    return false;
  const consumers = getConsumers(project, classModule, classNode);
  return Boolean(
    consumers &&
    consumers.every(
      (consumer) =>
        isClosingElementReference(consumer.reference) ||
        getOpeningElement(consumer.reference)?.attributes.length === 0,
    ),
  );
};

const hasClosedRenderAncestors = (
  child: EsTreeNode,
  owner: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  project: ClosedJsonSnapshotProject,
  hasAntdLocaleProvider: boolean,
): boolean => {
  let ancestor = child.parent;
  while (ancestor && ancestor !== owner) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const opening = ancestor.openingElement;
      if (!isClosedSnapshotCarrierOpening(opening, module, project, hasAntdLocaleProvider))
        return false;
    } else if (
      !isNodeOfType(ancestor, "JSXExpressionContainer") &&
      !isNodeOfType(ancestor, "JSXFragment") &&
      !isNodeOfType(ancestor, "ReturnStatement") &&
      !isNodeOfType(ancestor, "BlockStatement") &&
      !isNodeOfType(ancestor, "IfStatement") &&
      !isNodeOfType(ancestor, "ConditionalExpression") &&
      !isNodeOfType(ancestor, "LogicalExpression")
    )
      return false;
    ancestor = ancestor.parent;
  }
  return ancestor === owner;
};

const resolveImportedFunction = (
  expression: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  project: ClosedJsonSnapshotProject,
): { module: ClosedJsonSnapshotModule; component: EsTreeNode } | null => {
  if (
    !isNodeOfType(expression, "Identifier") ||
    module.scopes.symbolFor(expression)?.kind !== "import"
  )
    return null;
  const binding = getImportBindingForName(expression, expression.name);
  if (!binding?.exportedName) return null;
  const importedModule = project.resolveImport(module.filePath, binding.source);
  if (!importedModule || !isNodeOfType(importedModule.program, "Program")) return null;
  const importedProgram = importedModule.program;
  let component: EsTreeNode | null = null;
  walkAst(importedProgram, (candidate) => {
    if (
      isFunctionLike(candidate) &&
      isClosedModuleComponent(importedModule, candidate) &&
      getFunctionExportNames(importedProgram, candidate).includes(binding.exportedName ?? "")
    )
      component = candidate;
  });
  return component ? { module: importedModule, component } : null;
};

const hasStableOwnerHookOrder = (
  owner: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  hasLodashEmptiness: boolean,
): boolean => {
  if (
    !isFunctionLike(owner) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  )
    return false;
  const body = owner.body;
  let isStable = true;
  const hookStatements = new Set<EsTreeNode>();
  walkAst(owner, (node) => {
    if (!isStable) return false;
    if (
      (isNodeOfType(node, "Property") && node.kind !== "init") ||
      (isNodeOfType(node, "MethodDefinition") && (node.kind === "get" || node.kind === "set"))
    ) {
      isStable = false;
      return false;
    }
    if (node !== owner && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "NewExpression") || isNodeOfType(node, "TaggedTemplateExpression")) {
      isStable = false;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const isStateCall = isReactApiCall(node, "useState", module.scopes, {
      resolveNamedAliases: true,
    });
    if (
      !isStateCall &&
      !isReactApiCall(node, "useEffect", module.scopes, { resolveNamedAliases: true })
    ) {
      const argument = node.arguments[0];
      const argumentSymbol = isNodeOfType(argument, "Identifier")
        ? module.scopes.symbolFor(argument)
        : null;
      if (
        node.arguments.length !== 1 ||
        !isNodeOfType(argument, "Identifier") ||
        !argumentSymbol ||
        !isEmptinessReference(argument, argumentSymbol, module, hasLodashEmptiness)
      )
        isStable = false;
      return;
    }
    const initializer = node.arguments[0];
    if (
      isStateCall &&
      (!initializer ||
        (!isNodeOfType(initializer, "Literal") &&
          !isNodeOfType(initializer, "ObjectExpression") &&
          !isNodeOfType(initializer, "ArrayExpression")))
    ) {
      isStable = false;
      return;
    }
    const parent = node.parent;
    const statement = isNodeOfType(parent, "VariableDeclarator")
      ? parent.parent
      : isNodeOfType(parent, "ExpressionStatement")
        ? parent
        : null;
    if (!statement || statement.parent !== body || node.optional) {
      isStable = false;
      return;
    }
    hookStatements.add(statement);
  });
  const lastHookStatement = body.body.filter((statement) => hookStatements.has(statement)).at(-1);
  if (!isStable || !lastHookStatement) return false;
  for (const statement of body.body) {
    if (!hookStatements.has(statement)) return false;
    const calls = isNodeOfType(statement, "VariableDeclaration")
      ? statement.declarations.map((declarator) => {
          if (
            !isNodeOfType(declarator.id, "ArrayPattern") ||
            declarator.id.elements.some((element) => !isNodeOfType(element, "Identifier")) ||
            !isNodeOfType(declarator.init, "CallExpression") ||
            !isReactApiCall(declarator.init, "useState", module.scopes, {
              resolveNamedAliases: true,
            }) ||
            declarator.init.arguments.length !== 1
          )
            return null;
          return declarator.init;
        })
      : isNodeOfType(statement, "ExpressionStatement") &&
          isNodeOfType(statement.expression, "CallExpression") &&
          isReactApiCall(statement.expression, "useEffect", module.scopes, {
            resolveNamedAliases: true,
          }) &&
          statement.expression.arguments.length === 2 &&
          isFunctionLike(statement.expression.arguments[0]) &&
          isNodeOfType(statement.expression.arguments[1], "ArrayExpression")
        ? [statement.expression]
        : [];
    if (calls.length === 0 || calls.some((call) => !call)) return false;
    for (const call of calls) {
      if (!call) return false;
      const argument = call.arguments.at(-1);
      if (!argument) return false;
      walkAst(argument, (node) => {
        if (
          isNodeOfType(node, "Literal") ||
          isNodeOfType(node, "ArrayExpression") ||
          isNodeOfType(node, "ObjectExpression") ||
          (isNodeOfType(node, "Property") &&
            node.kind === "init" &&
            !node.computed &&
            !node.method &&
            !node.shorthand) ||
          (isNodeOfType(node, "Identifier") &&
            isNodeOfType(node.parent, "Property") &&
            node.parent.key === node &&
            !node.parent.computed &&
            !node.parent.shorthand)
        )
          return;
        isStable = false;
        return false;
      });
    }
    if (statement === lastHookStatement) break;
  }
  return isStable;
};

const hasSolePopulation = (
  state: SymbolDescriptor,
  owner: EsTreeNode,
  module: ClosedJsonSnapshotModule,
  project: ClosedJsonSnapshotProject,
  decoderRole: "browser-native-json",
  allowsAxiosDefaultResponseSnapshot: boolean,
): boolean => {
  if (!isFunctionLike(owner)) return false;
  const declarator = state.declarationNode;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== 2 ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isReactApiCall(declarator.init, "useState", module.scopes, { resolveNamedAliases: true }) ||
    declarator.init.arguments.length !== 1 ||
    !isNodeOfType(declarator.init.arguments[0], "ObjectExpression") ||
    declarator.init.arguments[0].properties.length !== 0 ||
    declarator.parent?.parent !== owner.body ||
    findEnclosingFunction(declarator) !== owner
  )
    return false;
  const setterIdentifier = declarator.id.elements[1];
  if (!isNodeOfType(setterIdentifier, "Identifier")) return false;
  const setter = module.scopes.symbolFor(setterIdentifier);
  const setterReferences =
    setter?.references.filter(
      (reference) => !isClosedJsonSnapshotInactiveBranch(reference.identifier),
    ) ?? [];
  if (!setter || setterReferences.length !== 1) return false;
  const setReference = setterReferences[0];
  const population = setReference?.identifier.parent;
  if (
    !isNodeOfType(population, "CallExpression") ||
    population.callee !== setReference.identifier ||
    population.arguments.length !== 1
  )
    return false;
  const payload = readAccess(population.arguments[0], module);
  if (!payload || payload.path.length !== 1 || payload.symbol.kind !== "parameter") return false;
  const populationStatement = population.parent;
  if (!isNodeOfType(populationStatement, "ExpressionStatement")) return false;
  const populationBranch =
    isNodeOfType(populationStatement.parent, "BlockStatement") &&
    populationStatement.parent.body.length === 1
      ? populationStatement.parent
      : populationStatement;
  const success = populationBranch.parent;
  if (
    !isNodeOfType(success, "IfStatement") ||
    success.consequent !== populationBranch ||
    success.alternate ||
    !isNodeOfType(success.test, "BinaryExpression") ||
    !["===", "=="].includes(success.test.operator)
  )
    return false;
  const testAccess = readAccess(success.test.left, module);
  if (
    testAccess?.symbol !== payload.symbol ||
    testAccess.path.length !== 1 ||
    testAccess.path[0] === payload.path[0] ||
    !isNodeOfType(success.test.right, "Literal") ||
    !CLOSED_JSON_SNAPSHOT_APPLICATION_SUCCESS_VALUES.has(success.test.right.value)
  )
    return false;
  const fulfillment = findEnclosingFunction(population);
  if (
    !fulfillment ||
    !isFunctionLike(fulfillment) ||
    fulfillment.async ||
    fulfillment.generator ||
    fulfillment.params.length !== 1 ||
    fulfillment.params[0] !== payload.symbol.bindingIdentifier ||
    !isNodeOfType(fulfillment.body, "BlockStatement") ||
    fulfillment.body.body.length !== 1 ||
    fulfillment.body.body[0] !== success ||
    payload.symbol.references.length !== 2
  )
    return false;
  const then = fulfillment.parent;
  if (
    !isNodeOfType(then, "CallExpression") ||
    then.arguments.length !== 1 ||
    then.arguments[0] !== fulfillment ||
    !isNodeOfType(then.callee, "MemberExpression") ||
    getStaticPropertyName(then.callee) !== "then" ||
    !isNodeOfType(then.callee.object, "CallExpression") ||
    then.callee.object.arguments.length > 1
  )
    return false;
  const imported = resolveImportedFunction(then.callee.object.callee, module, project);
  if (!imported) return false;
  const helperConsumers = getConsumers(project, imported.module, imported.component);
  if (
    !helperConsumers ||
    helperConsumers.length !== 1 ||
    helperConsumers[0]?.reference !== then.callee.object.callee ||
    !isClosedJsonSnapshotProvider({
      project,
      module: imported.module,
      helperFunction: imported.component,
      decoderRole,
      allowsAxiosDefaultResponseSnapshot,
      invocation:
        then.callee.object.arguments.length === 1
          ? { module, call: then.callee.object }
          : undefined,
    })
  )
    return false;
  const effectCallback = findEnclosingFunction(then);
  if (
    !effectCallback ||
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    effectCallback.params.length !== 0 ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    effectCallback.body.body.length !== 1 ||
    !isNodeOfType(effectCallback.body.body[0], "ExpressionStatement") ||
    effectCallback.body.body[0].expression !== then
  )
    return false;
  const effect = effectCallback.parent;
  return (
    isNodeOfType(effect, "CallExpression") &&
    effect.arguments.length === 2 &&
    effect.arguments[0] === effectCallback &&
    isNodeOfType(effect.arguments[1], "ArrayExpression") &&
    effect.arguments[1].elements.length === 0 &&
    isReactApiCall(effect, "useEffect", module.scopes, { resolveNamedAliases: true }) &&
    findEnclosingFunction(effect) === owner &&
    effect.parent?.parent === owner.body
  );
};

const certifyRouteConsumer = (
  consumer: SnapshotConsumer,
  targetPath: ReadonlyArray<string>,
  project: ClosedJsonSnapshotProject,
  decoderRole: "browser-native-json",
  allowsAxiosDefaultResponseSnapshot: boolean,
  hasLodashEmptiness: boolean,
  hasAntdLocaleProvider: boolean,
): boolean => {
  if (isClosingElementReference(consumer.reference)) return true;
  const opening = getOpeningElement(consumer.reference);
  if (!opening) return false;
  const callback = findEnclosingFunction(opening);
  if (
    !callback ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    callback.body !== opening.parent
  )
    return false;
  const renderContainer = callback.parent;
  const renderAttribute = renderContainer?.parent;
  const route = renderAttribute?.parent;
  if (
    !isNodeOfType(renderContainer, "JSXExpressionContainer") ||
    !isNodeOfType(renderAttribute, "JSXAttribute") ||
    !isNodeOfType(renderAttribute.name, "JSXIdentifier") ||
    renderAttribute.name.name !== "render" ||
    !isNodeOfType(route, "JSXOpeningElement") ||
    !isGenuineImport(route.name, consumer.module, "react-router-dom", "Route")
  )
    return false;
  const owner = findEnclosingFunction(callback);
  if (
    !owner ||
    !route.parent ||
    !hasClosedRenderAncestors(route.parent, owner, consumer.module, project, hasAntdLocaleProvider)
  )
    return false;
  const routeProps = consumer.module.scopes.symbolFor(callback.params[0]);
  if (!routeProps || routeProps.references.length !== 1) return false;
  let stateAccess: SnapshotAccess | null = null;
  let remainingPath = targetPath;
  let didSpreadRouteProps = false;
  let didSpreadState = false;
  for (const attribute of opening.attributes) {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      const access = readAccess(attribute.argument, consumer.module);
      if (access?.symbol === routeProps && access.path.length === 0 && !stateAccess) {
        didSpreadRouteProps = true;
        continue;
      }
      if (!didSpreadRouteProps || stateAccess || !access || access.path.length !== 0) return false;
      stateAccess = access;
      didSpreadState = true;
    } else if (
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === targetPath[0] &&
      isNodeOfType(attribute.value, "JSXExpressionContainer") &&
      didSpreadRouteProps &&
      !stateAccess
    ) {
      stateAccess = readAccess(attribute.value.expression, consumer.module);
      remainingPath = targetPath.slice(1);
    } else return false;
  }
  if (
    !stateAccess ||
    stateAccess.path.length !== 0 ||
    remainingPath.length === 0 ||
    remainingPath.some((segment) => CLOSED_JSON_SNAPSHOT_PROTOTYPE_PROPERTY_NAMES.has(segment)) ||
    (didSpreadState && CLOSED_JSON_SNAPSHOT_ROUTE_PROP_NAMES.has(remainingPath[0] ?? ""))
  )
    return false;
  const state = stateAccess.symbol;
  if (
    !hasEmptyGate(owner, state, route, consumer.module, hasLodashEmptiness) ||
    !hasStableOwnerHookOrder(owner, consumer.module, hasLodashEmptiness) ||
    !hasSolePopulation(
      state,
      owner,
      consumer.module,
      project,
      decoderRole,
      allowsAxiosDefaultResponseSnapshot,
    ) ||
    !getConsumers(project, consumer.module, owner)?.every(
      (ownerConsumer) =>
        isClosingElementReference(ownerConsumer.reference) ||
        getOpeningElement(ownerConsumer.reference) !== null,
    )
  )
    return false;
  for (const reference of state.references) {
    if (isClosedJsonSnapshotInactiveBranch(reference.identifier)) continue;
    const identifier = reference.identifier;
    if (identifier === stateAccess.node) continue;
    if (isEmptinessReference(identifier, state, consumer.module, hasLodashEmptiness)) continue;
    let outerAccess = identifier;
    while (
      isNodeOfType(outerAccess.parent, "MemberExpression") &&
      outerAccess.parent.object === outerAccess
    )
      outerAccess = outerAccess.parent;
    const access = readAccess(outerAccess, consumer.module);
    if (
      access &&
      access.path.length > 0 &&
      areStaticPropertyPathsDisjoint(access.path, remainingPath)
    )
      continue;
    return false;
  }
  return true;
};

export const createClosedJsonSnapshotOrdinalMap = (context: RuleContext) => {
  let role: ClosedJsonSnapshotSourceRole | null | undefined;
  let project: ClosedJsonSnapshotProject | null | undefined;
  return (iteratorCall: EsTreeNode): boolean => {
    if (!context.filename || !isNodeOfType(iteratorCall, "CallExpression")) return false;
    if (role === undefined) role = getClosedJsonSnapshotSourceRole(context.filename);
    if (!role) return false;
    const leaf = getClosedJsonSnapshotLeaf({
      iteratorCall,
      scopes: context.scopes,
      hasAntdComponentRole: role.hasAntdLocaleProvider,
    });
    if (!leaf) return false;
    const program = context.scopes.rootScope.node;
    if (!isNodeOfType(program, "Program")) return false;
    if (project === undefined)
      project = getClosedJsonSnapshotProject({
        rootDirectory: role.projectDirectory,
        allowJsxInJs: role.allowsJavaScriptJsx,
        currentFilePath: context.filename,
        currentProgramNode: program,
        currentScopes: context.scopes,
        currentSourceText: context.sourceCode?.getText?.(),
        sourceResolutionPolicy: role.sourceResolutionPolicy,
        knownPublicEntryTargets: role.knownPublicEntryTargets,
      });
    if (!project) return false;
    const module = project.modules.get(normalizeFilename(context.filename));
    if (!module) return false;
    if (
      getClosedJsonSnapshotComponentExportNames(module, leaf.componentFunction).size > 0 &&
      isClosedJsonSnapshotPublicEntry({ project, filePath: module.filePath })
    )
      return false;
    const consumers = getConsumers(project, module, leaf.componentFunction);
    if (!consumers) return false;
    const openings = consumers.filter((consumer) => !isClosingElementReference(consumer.reference));
    return (
      openings.length === 1 &&
      certifyRouteConsumer(
        openings[0],
        leaf.targetPath,
        project,
        role.decoderRole,
        role.allowsAxiosDefaultResponseSnapshot,
        role.hasLodashEmptiness,
        role.hasAntdLocaleProvider,
      )
    );
  };
};
