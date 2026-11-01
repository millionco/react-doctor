import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import {
  getReactDoctorNumberSetting,
  getReactDoctorStringArraySetting,
  getReactDoctorStringSetting,
} from "../../../utils/get-react-doctor-setting.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  CHART_CONSTRUCTION_TAIL_STATEMENT_COUNT,
  CHART_CONSTRUCTOR_ARGUMENT_COUNT,
  CHART_DATA_EXPRESSION_TYPES,
  CHART_EMPTY_ARGUMENT_COUNT,
  CHART_HOOK_ARGUMENT_COUNT,
  CHART_INCOMPATIBLE_CAPABILITIES,
  CHART_OPTIONS_COLOR_PATHS,
  CHART_SETTER_ARGUMENT_COUNT,
  CHART_SINGLE_DECLARATOR_COUNT,
  CHART_STATE_TUPLE_LENGTH,
  CHART_UNSUPPORTED_GLOBAL_NAMES,
  CHART_UNSUPPORTED_NODE_TYPES,
  CHART_UNSUPPORTED_PROVIDER_MODULES,
  CHART_UPDATE_MIN_STATEMENT_COUNT,
} from "./chart-options-state/constants.js";

interface ChartMemberPath {
  root: EsTreeNodeOfType<"Identifier">;
  names: string[];
}

interface ChartEffect {
  callback: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">;
  call: EsTreeNodeOfType<"CallExpression">;
  body: EsTreeNodeOfType<"BlockStatement">;
  dependencies: EsTreeNodeOfType<"ArrayExpression">;
}

const hasOnlyReadsAt = (symbol: SymbolDescriptor, allowed: ReadonlySet<EsTreeNode>): boolean =>
  symbol.references.every(
    (reference) => reference.flag === "read" && allowed.has(reference.identifier),
  );

const isNamedValueProvider = (
  node: EsTreeNode,
  source: string,
  name: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === source &&
    getImportedName(symbol.declarationNode) === name,
  );
};

const readEffect = (
  callback: EsTreeNode | null,
  component: EsTreeNode,
  context: RuleContext,
): ChartEffect | null => {
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.async ||
    callback.generator ||
    (isNodeOfType(callback, "FunctionExpression") && callback.id !== null) ||
    callback.params.length !== CHART_EMPTY_ARGUMENT_COUNT ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return null;
  const call = callback.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== CHART_HOOK_ARGUMENT_COUNT ||
    call.arguments[0] !== callback ||
    !isNamedValueProvider(call.callee, "react", "useEffect", context) ||
    !isNodeOfType(call.arguments[1], "ArrayExpression") ||
    call.arguments[1].elements.some(
      (element) => element === null || isNodeOfType(element, "SpreadElement"),
    ) ||
    !isNodeOfType(call.parent, "ExpressionStatement") ||
    call.parent.parent !== component
  )
    return null;
  return { callback, call, body: callback.body, dependencies: call.arguments[1] };
};

const readMemberPath = (expression: EsTreeNode): ChartMemberPath | null => {
  const names: string[] = [];
  let current = expression;
  while (isNodeOfType(current, "MemberExpression")) {
    if (current.computed || current.optional || !isNodeOfType(current.property, "Identifier"))
      return null;
    names.unshift(current.property.name);
    current = current.object;
  }
  return isNodeOfType(current, "Identifier") ? { root: current, names } : null;
};

const hasOrdinaryConfigurationPath = (
  configuration: EsTreeNode,
  names: ReadonlyArray<string>,
): boolean => {
  let current = configuration;
  for (const name of names) {
    if (!isNodeOfType(current, "ObjectExpression")) return false;
    let selected: EsTreeNode | null = null;
    const keys = new Set<string>();
    for (const property of current.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      )
        return false;
      const key = isNodeOfType(property.key, "Identifier")
        ? property.key.name
        : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
          ? property.key.value
          : null;
      if (key === null || keys.has(key)) return false;
      keys.add(key);
      if (key === name) selected = property.value;
    }
    if (!selected) return false;
    current = selected;
  }
  return true;
};

const isOrdinaryDataExpression = (expression: EsTreeNode, context: RuleContext): boolean => {
  let supported = true;
  walkAst(expression, (node) => {
    if (!supported) return false;
    if (
      !CHART_DATA_EXPRESSION_TYPES.has(node.type) ||
      (isNodeOfType(node, "MemberExpression") && (node.computed || node.optional)) ||
      (isNodeOfType(node, "UnaryExpression") &&
        node.operator !== "!" &&
        node.operator !== "+" &&
        node.operator !== "-" &&
        node.operator !== "typeof")
    )
      supported = false;
    const reference = context.scopes.referenceFor(node);
    if (reference && reference.flag !== "read") supported = false;
    return supported;
  });
  return supported;
};

const readMethodCall = (
  node: EsTreeNode,
  symbol: SymbolDescriptor,
  name: string,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    node.callee.optional ||
    !isNodeOfType(node.callee.object, "Identifier") ||
    context.scopes.symbolFor(node.callee.object) !== symbol ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== name
  )
    return null;
  return node;
};

const hasCompatibleProfile = (context: RuleContext): boolean => {
  const settings = context.settings;
  const profile = settings?.["react-doctor"];
  if (
    typeof profile === "object" &&
    profile !== null &&
    (Object.getOwnPropertyDescriptor(profile, "hasReactNativeWorkspace")?.value === true ||
      Object.getOwnPropertyDescriptor(profile, "hasReactCompiler")?.value === true)
  )
    return false;
  return (
    !getReactDoctorStringSetting(settings, "preactVersion") &&
    getReactDoctorNumberSetting(settings, "preactMajorVersion") === undefined &&
    !CHART_UNSUPPORTED_PROVIDER_MODULES.has(
      getReactDoctorStringSetting(settings, "framework") ?? "",
    ) &&
    !getReactDoctorStringArraySetting(settings, "capabilities").some(
      (capability) =>
        CHART_INCOMPATIBLE_CAPABILITIES.has(capability) || capability.startsWith("preact:"),
    )
  );
};

const isChartRegistration = (node: EsTreeNode, context: RuleContext): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    node.callee.optional ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== "register" ||
    !isNamedValueProvider(node.callee.object, "chart.js", "Chart", context) ||
    !isNodeOfType(node.parent, "ExpressionStatement") ||
    !isNodeOfType(node.parent.parent, "Program")
  )
    return false;
  return node.arguments.every((argument) => {
    if (!isNodeOfType(argument, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(argument);
    return Boolean(
      symbol &&
      getValueImportSource(symbol) === "chart.js" &&
      isNodeOfType(symbol.declarationNode, "ImportSpecifier"),
    );
  });
};

const hasClosedProviders = (
  program: EsTreeNode,
  constructor: EsTreeNode,
  context: RuleContext,
): boolean => {
  let supported = true;
  const providerReads = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  const allow = (symbol: SymbolDescriptor, node: EsTreeNode): void => {
    const reads = providerReads.get(symbol) ?? new Set<EsTreeNode>();
    reads.add(node);
    providerReads.set(symbol, reads);
  };
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      CHART_UNSUPPORTED_NODE_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier") && CHART_UNSUPPORTED_GLOBAL_NAMES.has(node.name)) {
      const reference = context.scopes.referenceFor(node);
      if (
        reference &&
        (!reference.resolvedSymbol || !hasRuntimeValueBinding(reference.resolvedSymbol))
      ) {
        supported = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration") || isTypeOnlyImport(node)) return;
    if (CHART_UNSUPPORTED_PROVIDER_MODULES.has(String(node.source.value))) {
      supported = false;
      return false;
    }
    if (node.source.value !== "react" && node.source.value !== "chart.js") return;
    for (const specifier of node.specifiers) {
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol || getValueImportSource(symbol) !== node.source.value) {
        supported = false;
        return false;
      }
      providerReads.set(symbol, new Set());
      for (const reference of symbol.references) {
        const identifier = reference.identifier;
        const parent = identifier.parent;
        if (node.source.value === "react") {
          if (
            isNodeOfType(specifier, "ImportSpecifier") &&
            isNodeOfType(parent, "CallExpression") &&
            parent.callee === identifier &&
            !parent.optional
          )
            allow(symbol, identifier);
          else if (
            (isNodeOfType(specifier, "ImportDefaultSpecifier") ||
              isNodeOfType(specifier, "ImportNamespaceSpecifier")) &&
            isNodeOfType(parent, "JSXMemberExpression") &&
            parent.object === identifier &&
            parent.property.name === "Fragment" &&
            (isNodeOfType(parent.parent, "JSXOpeningElement") ||
              isNodeOfType(parent.parent, "JSXClosingElement")) &&
            parent.parent.name === parent
          )
            allow(symbol, identifier);
        } else if (getImportedName(specifier) === "Chart") {
          if (identifier === constructor) allow(symbol, identifier);
          else if (
            isNodeOfType(parent, "MemberExpression") &&
            parent.object === identifier &&
            parent.parent &&
            isChartRegistration(parent.parent, context)
          ) {
            allow(symbol, identifier);
          }
        } else if (
          isNodeOfType(parent, "CallExpression") &&
          parent.arguments.some((argument) => argument === identifier) &&
          isChartRegistration(parent, context)
        )
          allow(symbol, identifier);
      }
    }
  });
  return supported && [...providerReads].every(([symbol, reads]) => hasOnlyReadsAt(symbol, reads));
};

interface ChartOptionsStateCertificate {
  readonly declarator: EsTreeNodeOfType<"VariableDeclarator">;
  readonly component: EsTreeNode;
  readonly assignments: ReadonlySet<EsTreeNode> | null;
}

const chartCertificatesByAnalysis = new WeakMap<
  ScopeAnalysis,
  WeakMap<SymbolDescriptor, WeakMap<EsTreeNode, ChartOptionsStateCertificate>>
>();

const collectChartOptionsStateAssignments = (
  state: SymbolDescriptor,
  setterIdentifier: EsTreeNodeOfType<"Identifier">,
  component: EsTreeNode,
  updateEffect: ChartEffect,
  context: RuleContext,
): ReadonlySet<EsTreeNode> | null => {
  const setter = context.scopes.symbolFor(setterIdentifier);
  if (!setter || setter.references.length !== CHART_SETTER_ARGUMENT_COUNT) return null;
  const setterReference = setter.references[0];
  const feed = setterReference?.identifier.parent;
  if (
    !setterReference ||
    setterReference.flag !== "read" ||
    !isNodeOfType(feed, "CallExpression") ||
    feed.optional ||
    feed.callee !== setterReference.identifier ||
    feed.arguments.length !== CHART_SETTER_ARGUMENT_COUNT ||
    !isNodeOfType(feed.arguments[0], "Identifier") ||
    !isNodeOfType(feed.parent, "ExpressionStatement")
  )
    return null;
  const construction = readEffect(findEnclosingFunction(feed), component, context);
  const instance = context.scopes.symbolFor(feed.arguments[0]);
  const creation = instance && getDirectConstInitializer(instance);
  const instanceDeclaration = instance?.declarationNode.parent;
  if (
    !construction ||
    !instance ||
    !isNodeOfType(creation, "NewExpression") ||
    creation.arguments.length !== CHART_CONSTRUCTOR_ARGUMENT_COUNT ||
    creation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNamedValueProvider(creation.callee, "chart.js", "Chart", context) ||
    !isNodeOfType(instanceDeclaration, "VariableDeclaration") ||
    instanceDeclaration.declarations.length !== CHART_SINGLE_DECLARATOR_COUNT ||
    instanceDeclaration.parent !== construction.body ||
    getNodeStartIndex(instance.declarationNode) < CHART_EMPTY_ARGUMENT_COUNT ||
    getNodeStartIndex(instance.declarationNode) >= getNodeStartIndex(feed)
  )
    return null;
  const configuration = creation.arguments[1];
  if (
    !isNodeOfType(configuration, "ObjectExpression") ||
    !creation.arguments[0] ||
    !isOrdinaryDataExpression(creation.arguments[0], context)
  )
    return null;
  const constructionStatements = construction.body.body.filter(
    (statement) =>
      statement.type !== "TSInterfaceDeclaration" && statement.type !== "TSTypeAliasDeclaration",
  );
  const tail = constructionStatements.slice(-CHART_CONSTRUCTION_TAIL_STATEMENT_COUNT);
  const [instanceStatement, feedStatement, returned] = tail;
  if (
    instanceStatement !== instanceDeclaration ||
    feedStatement !== feed.parent ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "ArrowFunctionExpression") ||
    returned.argument.async ||
    returned.argument.params.length !== CHART_EMPTY_ARGUMENT_COUNT
  )
    return null;
  const cleanup = readMethodCall(returned.argument.body, instance, "destroy", context);
  if (
    !cleanup ||
    cleanup.arguments.length !== CHART_EMPTY_ARGUMENT_COUNT ||
    !isNodeOfType(cleanup.callee, "MemberExpression") ||
    !hasOnlyReadsAt(instance, new Set([feed.arguments[0], cleanup.callee.object]))
  )
    return null;
  if (
    !constructionStatements
      .slice(0, -CHART_CONSTRUCTION_TAIL_STATEMENT_COUNT)
      .every(
        (statement) =>
          isNodeOfType(statement, "VariableDeclaration") &&
          statement.kind === "const" &&
          statement.declarations.length === CHART_SINGLE_DECLARATOR_COUNT &&
          statement.declarations.every(
            (binding) =>
              isNodeOfType(binding.id, "Identifier") &&
              binding.init &&
              isOrdinaryDataExpression(binding.init, context),
          ),
      )
  )
    return null;
  if (
    updateEffect.callback === construction.callback ||
    updateEffect.body.body.length < CHART_UPDATE_MIN_STATEMENT_COUNT
  )
    return null;
  const statements = updateEffect.body.body;
  const guard = statements[0];
  const last = statements.at(-1);
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "UnaryExpression") ||
    guard.test.operator !== "!" ||
    !isNodeOfType(guard.test.argument, "Identifier") ||
    context.scopes.symbolFor(guard.test.argument) !== state ||
    !isNodeOfType(guard.consequent, "ReturnStatement") ||
    guard.consequent.argument ||
    !isNodeOfType(last, "ExpressionStatement")
  )
    return null;
  const update = readMethodCall(last.expression, state, "update", context);
  if (
    !update ||
    update.arguments.length !== CHART_SETTER_ARGUMENT_COUNT ||
    !isNodeOfType(update.arguments[0], "Literal") ||
    update.arguments[0].value !== "none" ||
    !isNodeOfType(update.callee, "MemberExpression")
  )
    return null;
  const allowedStateReads = new Set<EsTreeNode>([guard.test.argument, update.callee.object]);
  const assignments = new Set<EsTreeNode>();
  const checkStatement = (statement: EsTreeNode): boolean => {
    if (isNodeOfType(statement, "BlockStatement")) return statement.body.every(checkStatement);
    if (isNodeOfType(statement, "IfStatement"))
      return (
        isOrdinaryDataExpression(statement.test, context) &&
        checkStatement(statement.consequent) &&
        (!statement.alternate || checkStatement(statement.alternate))
      );
    if (
      !isNodeOfType(statement, "ExpressionStatement") ||
      !isNodeOfType(statement.expression, "AssignmentExpression") ||
      statement.expression.operator !== "="
    )
      return false;
    const write = statement.expression;
    const path = readMemberPath(write.left);
    if (
      !path ||
      context.scopes.symbolFor(path.root) !== state ||
      !CHART_OPTIONS_COLOR_PATHS.has(path.names.join(".")) ||
      !hasOrdinaryConfigurationPath(configuration, path.names) ||
      !isOrdinaryDataExpression(write.right, context)
    )
      return false;
    allowedStateReads.add(path.root);
    assignments.add(write);
    return true;
  };
  if (
    !statements
      .slice(CHART_SETTER_ARGUMENT_COUNT, -CHART_SETTER_ARGUMENT_COUNT)
      .every(checkStatement)
  )
    return null;
  for (const effect of [construction, updateEffect])
    for (const element of effect.dependencies.elements)
      if (isNodeOfType(element, "Identifier") && context.scopes.symbolFor(element) === state)
        allowedStateReads.add(element);
  if (!hasOnlyReadsAt(state, allowedStateReads)) return null;
  const program = findProgramRoot(component);
  return program && hasClosedProviders(program, creation.callee, context) ? assignments : null;
};

export const isOwnedChartOptionsStateAssignment = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  state: SymbolDescriptor,
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const selectedPath = readMemberPath(assignment.left);
  if (
    assignment.operator !== "=" ||
    !selectedPath ||
    context.scopes.symbolFor(selectedPath.root) !== state ||
    !CHART_OPTIONS_COLOR_PATHS.has(selectedPath.names.join(".")) ||
    !hasCompatibleProfile(context)
  )
    return false;
  const declaration = declarator.parent;
  const initial = declarator.init;
  if (
    state.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== CHART_SINGLE_DECLARATOR_COUNT ||
    declaration.parent !== component ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== CHART_STATE_TUPLE_LENGTH ||
    declarator.id.elements[0] !== state.bindingIdentifier ||
    !isNodeOfType(declarator.id.elements[1], "Identifier") ||
    !isNodeOfType(initial, "CallExpression") ||
    initial.optional ||
    initial.arguments.length !== CHART_SETTER_ARGUMENT_COUNT ||
    !isNodeOfType(initial.arguments[0], "Literal") ||
    initial.arguments[0].value !== null ||
    !isNamedValueProvider(initial.callee, "react", "useState", context)
  )
    return false;
  const updateEffect = readEffect(findEnclosingFunction(assignment), component, context);
  if (!updateEffect) return false;
  let certificatesByState = chartCertificatesByAnalysis.get(context.scopes);
  if (!certificatesByState) {
    certificatesByState = new WeakMap();
    chartCertificatesByAnalysis.set(context.scopes, certificatesByState);
  }
  let certificatesByEffect = certificatesByState.get(state);
  if (!certificatesByEffect) {
    certificatesByEffect = new WeakMap();
    certificatesByState.set(state, certificatesByEffect);
  }
  let certificate = certificatesByEffect.get(updateEffect.callback);
  if (
    !certificate ||
    certificate.declarator !== declarator ||
    certificate.component !== component
  ) {
    certificate = {
      declarator,
      component,
      assignments: collectChartOptionsStateAssignments(
        state,
        declarator.id.elements[1],
        component,
        updateEffect,
        context,
      ),
    };
    certificatesByEffect.set(updateEffect.callback, certificate);
  }
  return certificate.assignments?.has(assignment) ?? false;
};
