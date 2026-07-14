import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { OBSERVATION_ONLY_HANDLER_MAX_CALL_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ObservationAnalysisContext {
  readonly filename: string;
  readonly scopes: ScopeAnalysis;
  readonly observationParameterSymbolIds: ReadonlySet<number>;
  readonly visitedFunctions: ReadonlySet<EsTreeNode>;
  readonly callDepth: number;
  readonly evidence: ObservationEvidence;
}

interface ObservationEvidence {
  didFindObservationCall: boolean;
}

interface ResolvedFunctionTarget {
  readonly filename: string;
  readonly functionNode: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

const OBSERVATION_MODULE_SEGMENTS: ReadonlySet<string> = new Set([
  "analytics",
  "instrumentation",
  "telemetry",
  "tracking",
]);

const OBSERVATION_PACKAGE_SOURCES: ReadonlySet<string> = new Set([
  "@amplitude/analytics-browser",
  "@segment/analytics-next",
  "@sentry/browser",
  "@sentry/nextjs",
  "@sentry/react",
  "firebase/analytics",
  "mixpanel-browser",
  "posthog-js",
]);

const OBSERVATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "capture",
  "captureEvent",
  "captureException",
  "captureMessage",
  "event",
  "logEvent",
  "record",
  "track",
]);

const crossFileScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();

const getCrossFileScopes = (programNode: EsTreeNode): ScopeAnalysis => {
  const cached = crossFileScopes.get(programNode);
  if (cached) return cached;
  const scopes = analyzeScopes(programNode);
  crossFileScopes.set(programNode, scopes);
  return scopes;
};

const isObservationModuleSource = (source: string): boolean => {
  if (OBSERVATION_PACKAGE_SOURCES.has(source)) return true;
  const sourceSegments = source.replaceAll("\\", "/").split("/").filter(Boolean);
  return sourceSegments.some((sourceSegment) => OBSERVATION_MODULE_SEGMENTS.has(sourceSegment));
};

const isObservationFactoryName = (name: string | null): boolean =>
  name === "useAnalytics" ||
  name === "useInstrumentation" ||
  name === "useTelemetry" ||
  name === "useTracking";

const getStableSymbol = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const symbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!symbol) return null;
  return symbol.references.some((reference) => reference.flag !== "read") ? null : symbol;
};

const getImportedBinding = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: ObservationAnalysisContext,
): ReturnType<typeof getImportBindingForName> => {
  const stableSymbol = getStableSymbol(identifier, context.scopes);
  if (!stableSymbol || stableSymbol.kind !== "import") return null;
  const importedIdentifier = stableSymbol.bindingIdentifier;
  if (!isNodeOfType(importedIdentifier, "Identifier")) return null;
  return getImportBindingForName(identifier, importedIdentifier.name);
};

const isObservationFactoryCall = (
  expression: EsTreeNode,
  context: ObservationAnalysisContext,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "CallExpression")) return false;
  const callee = stripParenExpression(unwrappedExpression.callee as EsTreeNode);
  if (isNodeOfType(callee, "Identifier")) {
    const importBinding = getImportedBinding(callee, context);
    return Boolean(
      importBinding &&
      isObservationModuleSource(importBinding.source) &&
      isObservationFactoryName(importBinding.exportedName),
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const importBinding = getImportedBinding(receiver, context);
  return Boolean(
    importBinding?.isNamespace &&
    isObservationModuleSource(importBinding.source) &&
    isObservationFactoryName(getStaticPropertyName(callee)),
  );
};

const isObservationReceiver = (
  expression: EsTreeNode,
  context: ObservationAnalysisContext,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isObservationFactoryCall(unwrappedExpression, context)) return true;
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return isObservationReceiver(unwrappedExpression.object as EsTreeNode, context);
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const importBinding = getImportedBinding(unwrappedExpression, context);
  if (importBinding && OBSERVATION_PACKAGE_SOURCES.has(importBinding.source)) return true;
  const stableSymbol = getStableSymbol(unwrappedExpression, context.scopes);
  return Boolean(
    stableSymbol?.initializer && isObservationFactoryCall(stableSymbol.initializer, context),
  );
};

const isObservationFunctionExpression = (
  expression: EsTreeNode,
  context: ObservationAnalysisContext,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = context.scopes.symbolFor(unwrappedExpression);
    if (symbol && context.observationParameterSymbolIds.has(symbol.id)) return true;
    const importBinding = getImportedBinding(unwrappedExpression, context);
    if (
      importBinding &&
      OBSERVATION_PACKAGE_SOURCES.has(importBinding.source) &&
      importBinding.exportedName &&
      OBSERVATION_METHOD_NAMES.has(importBinding.exportedName)
    ) {
      return true;
    }
    const stableSymbol = getStableSymbol(unwrappedExpression, context.scopes);
    return Boolean(
      stableSymbol?.initializer &&
      stableSymbol.initializer !== unwrappedExpression &&
      isObservationFunctionExpression(stableSymbol.initializer, context),
    );
  }
  if (!isNodeOfType(unwrappedExpression, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(unwrappedExpression);
  return Boolean(
    propertyName &&
    OBSERVATION_METHOD_NAMES.has(propertyName) &&
    isObservationReceiver(unwrappedExpression.object as EsTreeNode, context),
  );
};

const resolveImportedFunction = (
  callee: EsTreeNode,
  context: ObservationAnalysisContext,
): ResolvedFunctionTarget | null => {
  const unwrappedCallee = stripParenExpression(callee);
  let source: string | null = null;
  let exportedName: string | null = null;

  if (isNodeOfType(unwrappedCallee, "Identifier")) {
    const importBinding = getImportedBinding(unwrappedCallee, context);
    source = importBinding?.source ?? null;
    exportedName = importBinding?.exportedName ?? null;
  } else if (isNodeOfType(unwrappedCallee, "MemberExpression")) {
    const receiver = stripParenExpression(unwrappedCallee.object as EsTreeNode);
    const propertyName = getStaticPropertyName(unwrappedCallee);
    if (!propertyName || !isNodeOfType(receiver, "Identifier")) return null;
    const importBinding = getImportedBinding(receiver, context);
    if (!importBinding?.isNamespace) return null;
    source = importBinding.source;
    exportedName = propertyName;
  }

  if (!source || !exportedName) return null;
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    source,
    exportedName,
  );
  if (!resolved) return null;
  return {
    filename: resolved.filePath,
    functionNode: resolved.functionNode,
    scopes: getCrossFileScopes(resolved.programNode),
  };
};

const resolveFunctionTarget = (
  callee: EsTreeNode,
  context: ObservationAnalysisContext,
): ResolvedFunctionTarget | null => {
  const localFunction = resolveExactLocalFunction(callee, context.scopes);
  if (localFunction) {
    return { filename: context.filename, functionNode: localFunction, scopes: context.scopes };
  }
  return resolveImportedFunction(callee, context);
};

const isObservationSafeExpression = (
  expression: EsTreeNode | null | undefined,
  context: ObservationAnalysisContext,
): boolean => {
  if (!expression) return true;
  const unwrappedExpression = stripParenExpression(expression);

  if (
    isNodeOfType(unwrappedExpression, "Identifier") ||
    isNodeOfType(unwrappedExpression, "Literal") ||
    isNodeOfType(unwrappedExpression, "ThisExpression")
  ) {
    return true;
  }
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    return isObservationSafeCall(unwrappedExpression, context);
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return (
      isObservationSafeExpression(unwrappedExpression.object as EsTreeNode, context) &&
      (!unwrappedExpression.computed ||
        isObservationSafeExpression(unwrappedExpression.property as EsTreeNode, context))
    );
  }
  if (
    isNodeOfType(unwrappedExpression, "BinaryExpression") ||
    isNodeOfType(unwrappedExpression, "LogicalExpression")
  ) {
    return (
      isObservationSafeExpression(unwrappedExpression.left as EsTreeNode, context) &&
      isObservationSafeExpression(unwrappedExpression.right as EsTreeNode, context)
    );
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    return (
      isObservationSafeExpression(unwrappedExpression.test as EsTreeNode, context) &&
      isObservationSafeExpression(unwrappedExpression.consequent as EsTreeNode, context) &&
      isObservationSafeExpression(unwrappedExpression.alternate as EsTreeNode, context)
    );
  }
  if (isNodeOfType(unwrappedExpression, "UnaryExpression")) {
    return (
      unwrappedExpression.operator !== "delete" &&
      isObservationSafeExpression(unwrappedExpression.argument as EsTreeNode, context)
    );
  }
  if (isNodeOfType(unwrappedExpression, "AwaitExpression")) {
    return isObservationSafeExpression(unwrappedExpression.argument as EsTreeNode, context);
  }
  if (isNodeOfType(unwrappedExpression, "SequenceExpression")) {
    return unwrappedExpression.expressions.every((innerExpression) =>
      isObservationSafeExpression(innerExpression as EsTreeNode, context),
    );
  }
  if (isNodeOfType(unwrappedExpression, "ArrayExpression")) {
    return unwrappedExpression.elements.every((element) => {
      if (!element) return true;
      if (isNodeOfType(element as EsTreeNode, "SpreadElement")) {
        return isObservationSafeExpression(
          (element as EsTreeNodeOfType<"SpreadElement">).argument,
          context,
        );
      }
      return isObservationSafeExpression(element as EsTreeNode, context);
    });
  }
  if (isNodeOfType(unwrappedExpression, "ObjectExpression")) {
    return unwrappedExpression.properties.every((property) => {
      if (isNodeOfType(property, "SpreadElement")) {
        return isObservationSafeExpression(property.argument, context);
      }
      if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method) {
        return false;
      }
      return (
        (!property.computed || isObservationSafeExpression(property.key as EsTreeNode, context)) &&
        isObservationSafeExpression(property.value as EsTreeNode, context)
      );
    });
  }
  if (isNodeOfType(unwrappedExpression, "TemplateLiteral")) {
    return unwrappedExpression.expressions.every((innerExpression) =>
      isObservationSafeExpression(innerExpression as EsTreeNode, context),
    );
  }
  return false;
};

const buildObservationParameterSymbolIds = (
  functionNode: ResolvedFunctionTarget["functionNode"],
  functionScopes: ScopeAnalysis,
  argumentsList: ReadonlyArray<EsTreeNode>,
  callerContext: ObservationAnalysisContext,
): ReadonlySet<number> => {
  const observationParameterSymbolIds = new Set<number>();
  if (!isFunctionLike(functionNode)) return observationParameterSymbolIds;
  for (let parameterIndex = 0; parameterIndex < functionNode.params.length; parameterIndex += 1) {
    const parameter = functionNode.params[parameterIndex] as EsTreeNode;
    const argument = argumentsList[parameterIndex];
    if (
      !argument ||
      !isNodeOfType(parameter, "Identifier") ||
      !isObservationFunctionExpression(argument, callerContext)
    ) {
      continue;
    }
    const parameterSymbol = functionScopes.symbolFor(parameter);
    if (parameterSymbol) observationParameterSymbolIds.add(parameterSymbol.id);
  }
  return observationParameterSymbolIds;
};

const isObservationSafePattern = (
  pattern: EsTreeNode | null | undefined,
  context: ObservationAnalysisContext,
): boolean => {
  if (!pattern || isNodeOfType(pattern, "Identifier")) return true;
  if (isNodeOfType(pattern, "RestElement")) {
    return isObservationSafePattern(pattern.argument, context);
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return (
      isObservationSafePattern(pattern.left as EsTreeNode, context) &&
      isObservationSafeExpression(pattern.right as EsTreeNode, context)
    );
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    return pattern.elements.every((element) =>
      isObservationSafePattern(element as EsTreeNode | null, context),
    );
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    return pattern.properties.every((property) => {
      if (isNodeOfType(property, "RestElement")) {
        return isObservationSafePattern(property.argument, context);
      }
      if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method) {
        return false;
      }
      return (
        (!property.computed || isObservationSafeExpression(property.key as EsTreeNode, context)) &&
        isObservationSafePattern(property.value as EsTreeNode, context)
      );
    });
  }
  return false;
};

const isObservationSafeStatement = (
  statement: EsTreeNode,
  context: ObservationAnalysisContext,
): boolean => {
  if (isNodeOfType(statement, "BlockStatement")) {
    return statement.body.every((innerStatement) =>
      isObservationSafeStatement(innerStatement as EsTreeNode, context),
    );
  }
  if (isNodeOfType(statement, "ExpressionStatement")) {
    return isObservationSafeExpression(statement.expression as EsTreeNode, context);
  }
  if (isNodeOfType(statement, "ReturnStatement")) {
    return isObservationSafeExpression(statement.argument as EsTreeNode | null, context);
  }
  if (isNodeOfType(statement, "VariableDeclaration")) {
    return statement.declarations.every(
      (declaration) =>
        isObservationSafePattern(declaration.id as EsTreeNode, context) &&
        isObservationSafeExpression(declaration.init as EsTreeNode | null, context),
    );
  }
  if (isNodeOfType(statement, "IfStatement")) {
    return (
      isObservationSafeExpression(statement.test as EsTreeNode, context) &&
      isObservationSafeStatement(statement.consequent as EsTreeNode, context) &&
      (!statement.alternate ||
        isObservationSafeStatement(statement.alternate as EsTreeNode, context))
    );
  }
  if (isNodeOfType(statement, "SwitchStatement")) {
    return (
      isObservationSafeExpression(statement.discriminant as EsTreeNode, context) &&
      statement.cases.every((switchCase) =>
        Boolean(
          isObservationSafeExpression(switchCase.test as EsTreeNode | null, context) &&
          switchCase.consequent.every((innerStatement) =>
            isObservationSafeStatement(innerStatement as EsTreeNode, context),
          ),
        ),
      )
    );
  }
  return (
    isNodeOfType(statement, "EmptyStatement") || isNodeOfType(statement, "FunctionDeclaration")
  );
};

const isObservationSafeFunction = (
  target: ResolvedFunctionTarget,
  argumentsList: ReadonlyArray<EsTreeNode>,
  callerContext: ObservationAnalysisContext,
): boolean => {
  if (!isFunctionLike(target.functionNode)) return false;
  if (callerContext.callDepth >= OBSERVATION_ONLY_HANDLER_MAX_CALL_DEPTH) return false;
  if (callerContext.visitedFunctions.has(target.functionNode)) return false;
  const visitedFunctions = new Set(callerContext.visitedFunctions);
  visitedFunctions.add(target.functionNode);
  const context: ObservationAnalysisContext = {
    filename: target.filename,
    scopes: target.scopes,
    observationParameterSymbolIds: buildObservationParameterSymbolIds(
      target.functionNode,
      target.scopes,
      argumentsList,
      callerContext,
    ),
    visitedFunctions,
    callDepth: callerContext.callDepth + 1,
    evidence: callerContext.evidence,
  };
  return (
    target.functionNode.params.every((parameter) =>
      isObservationSafePattern(parameter as EsTreeNode, context),
    ) &&
    (isObservationSafeExpression(target.functionNode.body as EsTreeNode, context) ||
      isObservationSafeStatement(target.functionNode.body as EsTreeNode, context))
  );
};

const isObservationSafeCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: ObservationAnalysisContext,
): boolean => {
  const argumentsList: EsTreeNode[] = [];
  for (const argument of callExpression.arguments) {
    const argumentNode = argument as EsTreeNode;
    if (isNodeOfType(argumentNode, "SpreadElement")) {
      if (!isObservationSafeExpression(argumentNode.argument, context)) return false;
      argumentsList.push(argumentNode.argument);
      continue;
    }
    if (!isObservationSafeExpression(argumentNode, context)) return false;
    argumentsList.push(argumentNode);
  }

  const callee = callExpression.callee as EsTreeNode;
  if (isObservationFunctionExpression(callee, context)) {
    context.evidence.didFindObservationCall = true;
    return true;
  }
  const target = resolveFunctionTarget(callee, context);
  return Boolean(target && isObservationSafeFunction(target, argumentsList, context));
};

export const isProvenObservationOnlyJsxHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): boolean => {
  if (!context.filename || !attribute.value) return false;
  const attributeValue = attribute.value as EsTreeNode;
  if (!isNodeOfType(attributeValue, "JSXExpressionContainer")) return false;
  const handlerExpression = stripParenExpression(attributeValue.expression as EsTreeNode);
  const handlerFunction = resolveExactLocalFunction(handlerExpression, context.scopes);
  if (!handlerFunction) return false;
  const analysisContext: ObservationAnalysisContext = {
    filename: context.filename,
    scopes: context.scopes,
    observationParameterSymbolIds: new Set<number>(),
    visitedFunctions: new Set<EsTreeNode>(),
    callDepth: 0,
    evidence: { didFindObservationCall: false },
  };
  const isSafe = isObservationSafeFunction(
    { filename: context.filename, functionNode: handlerFunction, scopes: context.scopes },
    [],
    analysisContext,
  );
  return isSafe && analysisContext.evidence.didFindObservationCall;
};
