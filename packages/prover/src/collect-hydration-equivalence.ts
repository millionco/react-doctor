import ts from "typescript";
import {
  REACT_HYDRATABLE_SERVER_API_NAMES,
  REACT_STATIC_SERVER_API_NAMES,
  REACT_TRANSPARENT_COMPONENT_NAMES,
} from "./constants.js";
import { collectReachableFunctionGraph } from "./collect-reachable-functions.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getNodeLocation } from "./get-node-location.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { summarizeFunctionReturns } from "./summarize-function-returns.js";
import {
  ReactHydrationHazardKind,
  ReactHydrationPrefixStatus,
  ReactHydrationRootExecutionStatus,
  ReactHydrationRootKind,
  ReactHydrationStatus,
  ReactSemanticEdgeKind,
  ReactSemanticRenderKind,
} from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { collectSymbolWrites } from "./utils/collect-symbol-writes.js";
import { createSemanticId } from "./utils/create-semantic-id.js";
import { getExpressionSymbol } from "./utils/get-expression-symbol.js";
import { resolveAliasedSymbol } from "./utils/resolve-aliased-symbol.js";
import type {
  ReactAnalysisContext,
  ReactSemanticEdge,
  ReactSemanticHydration,
  ReactSemanticHydrationHazard,
  ReactSemanticHydrationRoot,
  ReactSemanticRender,
  ReactSemanticSlotFlow,
  ReactSemanticUnit,
  ReactUnitDescriptor,
} from "./types.js";

interface HydrationGraph {
  roots: ReadonlyArray<ReactSemanticHydrationRoot>;
  hazards: ReadonlyArray<ReactSemanticHydrationHazard>;
  hydrations: ReadonlyArray<ReactSemanticHydration>;
}

interface HydrationPrefix {
  status: ReactHydrationPrefixStatus;
  value: string | null;
}

interface HydrationSourceSet {
  rootIds: Set<string>;
  hasUnknownSource: boolean;
}

const BROWSER_GLOBAL_NAMES = new Set([
  "document",
  "localStorage",
  "location",
  "matchMedia",
  "navigator",
  "sessionStorage",
  "window",
]);

const LOCALE_METHOD_NAMES = new Set(["toLocaleDateString", "toLocaleString", "toLocaleTimeString"]);

const INTL_CONSTRUCTOR_NAMES = new Set([
  "Collator",
  "DateTimeFormat",
  "DisplayNames",
  "ListFormat",
  "NumberFormat",
  "PluralRules",
  "RelativeTimeFormat",
  "Segmenter",
]);

const getJsxChildren = (children: ts.NodeArray<ts.JsxChild>): ReadonlyArray<ts.JsxChild> =>
  children.filter((child) => !(ts.isJsxText(child) && child.getText().trim().length === 0));

const getCanonicalJsxApiName = (
  tagName: ts.JsxTagNameExpression,
  context: ReactAnalysisContext,
): string | null =>
  ts.isJsxNamespacedName(tagName) ? null : getCanonicalReactApiName(tagName, context.typeChecker);

const resolveHydrationTarget = (
  expression: ts.Expression,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  context: ReactAnalysisContext,
  visitedSymbols: Set<ts.Symbol>,
): string | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (ts.isJsxSelfClosingElement(unwrappedExpression)) {
    const reactApiName = getCanonicalJsxApiName(unwrappedExpression.tagName, context);
    if (reactApiName && REACT_TRANSPARENT_COMPONENT_NAMES.has(reactApiName)) return null;
    const symbol = getExpressionSymbol(unwrappedExpression.tagName, context.typeChecker);
    return symbol ? (unitIdsBySymbol.get(symbol) ?? null) : null;
  }
  if (ts.isJsxElement(unwrappedExpression)) {
    const reactApiName = getCanonicalJsxApiName(
      unwrappedExpression.openingElement.tagName,
      context,
    );
    if (reactApiName && REACT_TRANSPARENT_COMPONENT_NAMES.has(reactApiName)) {
      const children = getJsxChildren(unwrappedExpression.children);
      if (children.length !== 1) return null;
      const child = children[0];
      if (!child) return null;
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
        return resolveHydrationTarget(child, unitIdsBySymbol, context, visitedSymbols);
      }
      if (ts.isJsxExpression(child) && child.expression) {
        return resolveHydrationTarget(child.expression, unitIdsBySymbol, context, visitedSymbols);
      }
      return null;
    }
    const symbol = getExpressionSymbol(
      unwrappedExpression.openingElement.tagName,
      context.typeChecker,
    );
    return symbol ? (unitIdsBySymbol.get(symbol) ?? null) : null;
  }
  if (ts.isJsxFragment(unwrappedExpression)) {
    const children = getJsxChildren(unwrappedExpression.children);
    if (children.length !== 1) return null;
    const child = children[0];
    if (!child) return null;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      return resolveHydrationTarget(child, unitIdsBySymbol, context, visitedSymbols);
    }
    if (ts.isJsxExpression(child) && child.expression) {
      return resolveHydrationTarget(child.expression, unitIdsBySymbol, context, visitedSymbols);
    }
    return null;
  }
  if (
    ts.isCallExpression(unwrappedExpression) &&
    getCanonicalReactApiName(unwrappedExpression.expression, context.typeChecker) ===
      "createElement"
  ) {
    const componentExpression = unwrappedExpression.arguments[0];
    if (!componentExpression) return null;
    const reactApiName = getCanonicalReactApiName(componentExpression, context.typeChecker);
    if (reactApiName && REACT_TRANSPARENT_COMPONENT_NAMES.has(reactApiName)) {
      const childExpression = unwrappedExpression.arguments[2];
      return childExpression
        ? resolveHydrationTarget(childExpression, unitIdsBySymbol, context, visitedSymbols)
        : null;
    }
    const symbol = getExpressionSymbol(componentExpression, context.typeChecker);
    return symbol ? (unitIdsBySymbol.get(symbol) ?? null) : null;
  }
  if (!ts.isIdentifier(unwrappedExpression)) return null;
  const unresolvedSymbol = context.typeChecker.getSymbolAtLocation(unwrappedExpression);
  if (!unresolvedSymbol) return null;
  const symbol = resolveAliasedSymbol(unresolvedSymbol, context.typeChecker);
  const directTarget = unitIdsBySymbol.get(symbol);
  if (directTarget) return directTarget;
  if (visitedSymbols.has(symbol)) return null;
  visitedSymbols.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      collectSymbolWrites(symbol, declaration.getSourceFile(), context.typeChecker).length === 0
    ) {
      const targetId = resolveHydrationTarget(
        declaration.initializer,
        unitIdsBySymbol,
        context,
        visitedSymbols,
      );
      if (targetId) return targetId;
    }
  }
  return null;
};

const getPropertyName = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
    return name.expression.text;
  }
  return null;
};

const readIdentifierPrefix = (optionsExpression: ts.Expression | undefined): HydrationPrefix => {
  if (!optionsExpression) {
    return { status: ReactHydrationPrefixStatus.Known, value: "" };
  }
  const options = unwrapTypescriptExpression(optionsExpression);
  if (!ts.isObjectLiteralExpression(options)) {
    return { status: ReactHydrationPrefixStatus.Unknown, value: null };
  }
  let prefix: HydrationPrefix = {
    status: ReactHydrationPrefixStatus.Known,
    value: "",
  };
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      prefix = { status: ReactHydrationPrefixStatus.Unknown, value: null };
      continue;
    }
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property) &&
      !ts.isMethodDeclaration(property)
    ) {
      continue;
    }
    if (getPropertyName(property.name) !== "identifierPrefix") continue;
    const initializer = ts.isPropertyAssignment(property)
      ? unwrapTypescriptExpression(property.initializer)
      : null;
    if (initializer && ts.isStringLiteralLike(initializer)) {
      prefix = {
        status: ReactHydrationPrefixStatus.Known,
        value: initializer.text,
      };
    } else {
      prefix = { status: ReactHydrationPrefixStatus.Unknown, value: null };
    }
  }
  return prefix;
};

const getHydrationRootKind = (apiName: string): ReactHydrationRootKind | null => {
  if (apiName === "hydrateRoot") return ReactHydrationRootKind.Client;
  if (REACT_HYDRATABLE_SERVER_API_NAMES.has(apiName)) {
    return ReactHydrationRootKind.ServerInteractive;
  }
  return REACT_STATIC_SERVER_API_NAMES.has(apiName) ? ReactHydrationRootKind.ServerStatic : null;
};

const collectHydrationRoots = (
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  context: ReactAnalysisContext,
): ReadonlyArray<ReactSemanticHydrationRoot> => {
  const roots: ReactSemanticHydrationRoot[] = [];
  for (const sourceFile of sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const apiName = getCanonicalReactApiName(node.expression, context.typeChecker);
        const kind = apiName ? getHydrationRootKind(apiName) : null;
        if (apiName && kind) {
          const rootExpression =
            kind === ReactHydrationRootKind.Client ? node.arguments[1] : node.arguments[0];
          const optionsExpression =
            kind === ReactHydrationRootKind.Client ? node.arguments[2] : node.arguments[1];
          const targetId = rootExpression
            ? resolveHydrationTarget(rootExpression, unitIdsBySymbol, context, new Set())
            : null;
          const prefix = readIdentifierPrefix(optionsExpression);
          let currentParent: ts.Node | undefined = node.parent;
          while (currentParent && !ts.isSourceFile(currentParent)) {
            if (isFunctionBoundary(currentParent)) break;
            currentParent = currentParent.parent;
          }
          const executionStatus = ts.isSourceFile(currentParent)
            ? ReactHydrationRootExecutionStatus.Module
            : ReactHydrationRootExecutionStatus.Unknown;
          const sourceComplete =
            targetId !== null &&
            prefix.status === ReactHydrationPrefixStatus.Known &&
            executionStatus === ReactHydrationRootExecutionStatus.Module;
          roots.push({
            id: createSemanticId("hydration-root", apiName, node, context),
            apiName,
            kind,
            targetId,
            identifierPrefix: prefix.value,
            prefixStatus: prefix.status,
            executionStatus,
            location: getNodeLocation(node, context.rootDirectory),
            sourceComplete,
            complete: sourceComplete,
          });
        }
      }
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
  }
  return roots;
};

const isDefaultLibrarySymbol = (
  symbol: ts.Symbol | undefined,
  context: ReactAnalysisContext,
): boolean =>
  Boolean(
    symbol?.declarations?.length &&
    symbol.declarations.every((declaration) =>
      context.program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    ),
  );

const hasReturnDescendant = (node: ts.Node): boolean => {
  let hasReturn = false;
  const visit = (child: ts.Node): void => {
    if (child !== node && isFunctionBoundary(child)) return;
    if (ts.isReturnStatement(child)) {
      hasReturn = true;
      return;
    }
    child.forEachChild(visit);
  };
  node.forEachChild(visit);
  return hasReturn;
};

const collectOutputExpressions = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReadonlyArray<ts.Expression> => {
  const returnSummary = summarizeFunctionReturns(functionNode, context.typeChecker);
  const expressions = returnSummary.expressions.map((returned) => returned.expression);
  if (!functionNode.body || !ts.isBlock(functionNode.body)) return expressions;
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (
      ts.isIfStatement(node) &&
      (hasReturnDescendant(node.thenStatement) ||
        Boolean(node.elseStatement && hasReturnDescendant(node.elseStatement)))
    ) {
      expressions.push(node.expression);
    }
    if (ts.isSwitchStatement(node) && hasReturnDescendant(node.caseBlock)) {
      expressions.push(node.expression);
    }
    node.forEachChild(visit);
  };
  functionNode.body.forEachChild(visit);
  return expressions;
};

const collectHydrationHazardsForUnit = (
  descriptor: ReactUnitDescriptor,
  ownerId: string,
  context: ReactAnalysisContext,
): ReadonlyArray<ReactSemanticHydrationHazard> => {
  const functionNode = descriptor.functionNode;
  if (!functionNode) return [];
  const hazards = new Map<string, ReactSemanticHydrationHazard>();
  const visitedExpressions = new Set<ts.Expression>();
  const reachableFunctionGraph = collectReachableFunctionGraph(functionNode, context.typeChecker);
  const addHazard = (node: ts.Node, kind: ReactHydrationHazardKind, description: string): void => {
    const id = createSemanticId("hydration-hazard", `${ownerId}:${kind}`, node, context);
    if (hazards.has(id)) return;
    hazards.set(id, {
      id,
      ownerId,
      kind,
      description,
      location: getNodeLocation(node, context.rootDirectory),
    });
  };
  const visitExpression = (expression: ts.Expression): void => {
    const unwrappedExpression = unwrapTypescriptExpression(expression);
    if (visitedExpressions.has(unwrappedExpression)) return;
    visitedExpressions.add(unwrappedExpression);
    const visit = (node: ts.Node): void => {
      if (node !== unwrappedExpression && isFunctionBoundary(node)) return;
      if (ts.isIdentifier(node) && BROWSER_GLOBAL_NAMES.has(node.text)) {
        const symbol = context.typeChecker.getSymbolAtLocation(node);
        if (isDefaultLibrarySymbol(symbol, context)) {
          if (ts.isTypeOfExpression(node.parent) && node.parent.expression === node) {
            addHazard(
              node.parent,
              ReactHydrationHazardKind.EnvironmentBranch,
              `${node.parent.getText()} can select different server and client output`,
            );
          } else {
            addHazard(
              node,
              ReactHydrationHazardKind.BrowserGlobal,
              `${node.text} is unavailable or different during server rendering`,
            );
          }
        }
      }
      if (
        ts.isCallExpression(node) &&
        node.arguments.length === 0 &&
        ts.isPropertyAccessExpression(node.expression) &&
        LOCALE_METHOD_NAMES.has(node.expression.name.text) &&
        isDefaultLibrarySymbol(
          context.typeChecker.getSymbolAtLocation(node.expression.name),
          context,
        )
      ) {
        addHazard(
          node,
          ReactHydrationHazardKind.LocaleFormatting,
          `${node.expression.name.text}() depends on the host locale or time zone`,
        );
      }
      if (
        ts.isNewExpression(node) &&
        (!node.arguments || node.arguments.length === 0) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Intl" &&
        INTL_CONSTRUCTOR_NAMES.has(node.expression.name.text) &&
        isDefaultLibrarySymbol(
          context.typeChecker.getSymbolAtLocation(node.expression.expression),
          context,
        )
      ) {
        addHazard(
          node,
          ReactHydrationHazardKind.LocaleFormatting,
          `${node.expression.getText()} uses host-default internationalization settings`,
        );
      }
      if (ts.isIdentifier(node)) {
        const symbol = context.typeChecker.getSymbolAtLocation(node);
        for (const declaration of symbol?.declarations ?? []) {
          if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
            const initializer = unwrapTypescriptExpression(declaration.initializer);
            if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) {
              visitExpression(initializer);
            }
          }
          if (
            ts.isBindingElement(declaration) &&
            ts.isArrayBindingPattern(declaration.parent) &&
            ts.isVariableDeclaration(declaration.parent.parent) &&
            declaration.parent.parent.initializer &&
            ts.isCallExpression(unwrapTypescriptExpression(declaration.parent.parent.initializer))
          ) {
            const hookCall = unwrapTypescriptExpression(declaration.parent.parent.initializer);
            if (!ts.isCallExpression(hookCall)) continue;
            const hookName = getCanonicalReactApiName(hookCall.expression, context.typeChecker);
            if (hookName !== "useState") continue;
            const stateIndex = declaration.parent.elements.indexOf(declaration);
            if (stateIndex !== 0) continue;
            const initializer = hookCall.arguments[0];
            if (!initializer) continue;
            if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
              for (const outputExpression of collectOutputExpressions(initializer, context)) {
                visitExpression(outputExpression);
              }
            } else {
              visitExpression(initializer);
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(unwrappedExpression);
  };
  for (const reachableFunction of reachableFunctionGraph.functions) {
    for (const outputExpression of collectOutputExpressions(
      reachableFunction.functionNode,
      context,
    )) {
      visitExpression(outputExpression);
    }
  }
  return [...hazards.values()];
};

const addHydrationSource = (
  sourcesByUnit: Map<string, HydrationSourceSet>,
  unitId: string,
  rootId: string,
): boolean => {
  let sources = sourcesByUnit.get(unitId);
  if (!sources) {
    sources = { rootIds: new Set(), hasUnknownSource: false };
    sourcesByUnit.set(unitId, sources);
  }
  const previousSize = sources.rootIds.size;
  sources.rootIds.add(rootId);
  return sources.rootIds.size !== previousSize;
};

const addUnknownHydrationSource = (
  sourcesByUnit: Map<string, HydrationSourceSet>,
  unitId: string,
): boolean => {
  let sources = sourcesByUnit.get(unitId);
  if (!sources) {
    sources = { rootIds: new Set(), hasUnknownSource: false };
    sourcesByUnit.set(unitId, sources);
  }
  if (sources.hasUnknownSource) return false;
  sources.hasUnknownSource = true;
  return true;
};

const deriveHydrationSourcesByUnit = (
  units: ReadonlyArray<ReactSemanticUnit>,
  roots: ReadonlyArray<ReactSemanticHydrationRoot>,
  edges: ReadonlyArray<ReactSemanticEdge>,
  renders: ReadonlyArray<ReactSemanticRender>,
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
): ReadonlyMap<string, HydrationSourceSet> => {
  const unitIds = new Set(units.map((unit) => unit.id));
  const sourcesByUnit = new Map<string, HydrationSourceSet>();
  const rendersById = new Map(renders.map((render) => [render.id, render]));
  for (const root of roots) {
    if (root.targetId) addHydrationSource(sourcesByUnit, root.targetId, root.id);
  }
  let didSourcesChange = true;
  while (didSourcesChange) {
    didSourcesChange = false;
    for (const render of renders) {
      if (render.kind === ReactSemanticRenderKind.SlotInput) continue;
      const ownerSources = sourcesByUnit.get(render.ownerId);
      if (!ownerSources) continue;
      for (const rootId of ownerSources.rootIds) {
        didSourcesChange =
          addHydrationSource(sourcesByUnit, render.targetId, rootId) || didSourcesChange;
      }
      if (ownerSources.hasUnknownSource) {
        didSourcesChange =
          addUnknownHydrationSource(sourcesByUnit, render.targetId) || didSourcesChange;
      }
    }
    for (const edge of edges) {
      if (edge.kind !== ReactSemanticEdgeKind.CallsHook || !unitIds.has(edge.targetId)) continue;
      const ownerSources = sourcesByUnit.get(edge.sourceId);
      if (!ownerSources) continue;
      for (const rootId of ownerSources.rootIds) {
        didSourcesChange =
          addHydrationSource(sourcesByUnit, edge.targetId, rootId) || didSourcesChange;
      }
      if (ownerSources.hasUnknownSource) {
        didSourcesChange =
          addUnknownHydrationSource(sourcesByUnit, edge.targetId) || didSourcesChange;
      }
    }
    for (const slotFlow of slotFlows) {
      if (slotFlow.complete) continue;
      const sourceRender = rendersById.get(slotFlow.sourceRenderId);
      if (!sourceRender || !sourcesByUnit.has(sourceRender.ownerId)) continue;
      didSourcesChange =
        addUnknownHydrationSource(sourcesByUnit, sourceRender.targetId) || didSourcesChange;
    }
  }
  return sourcesByUnit;
};

const collectHydrations = (
  units: ReadonlyArray<ReactSemanticUnit>,
  roots: ReadonlyArray<ReactSemanticHydrationRoot>,
  hazards: ReadonlyArray<ReactSemanticHydrationHazard>,
  edges: ReadonlyArray<ReactSemanticEdge>,
  renders: ReadonlyArray<ReactSemanticRender>,
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
): ReadonlyArray<ReactSemanticHydration> => {
  const rootsById = new Map(roots.map((root) => [root.id, root]));
  const sourcesByUnit = deriveHydrationSourcesByUnit(units, roots, edges, renders, slotFlows);
  const hasIncompleteRoot = roots.some((root) => !root.sourceComplete);
  const hasClientRoot = roots.some((root) => root.kind === ReactHydrationRootKind.Client);
  return units.map((unit) => {
    const sources = sourcesByUnit.get(unit.id);
    const sourceRoots = [...(sources?.rootIds ?? [])]
      .map((rootId) => rootsById.get(rootId))
      .filter((root): root is ReactSemanticHydrationRoot => Boolean(root));
    const clientRoots = sourceRoots.filter((root) => root.kind === ReactHydrationRootKind.Client);
    const interactiveServerRoots = sourceRoots.filter(
      (root) => root.kind === ReactHydrationRootKind.ServerInteractive,
    );
    const staticServerRoots = sourceRoots.filter(
      (root) => root.kind === ReactHydrationRootKind.ServerStatic,
    );
    const unitHazards = hazards.filter((hazard) => hazard.ownerId === unit.id);
    let status = ReactHydrationStatus.Unknown;
    if (!hasClientRoot) {
      status = ReactHydrationStatus.NotHydrated;
    } else if (hasIncompleteRoot) {
      status = ReactHydrationStatus.Unknown;
    } else if (sourceRoots.length === 0) {
      status = ReactHydrationStatus.NotHydrated;
    } else if (
      !hasIncompleteRoot &&
      !sources?.hasUnknownSource &&
      clientRoots.length === 1 &&
      interactiveServerRoots.length === 1 &&
      staticServerRoots.length === 0
    ) {
      const clientPrefix = clientRoots[0]?.identifierPrefix;
      const serverPrefix = interactiveServerRoots[0]?.identifierPrefix;
      status =
        clientPrefix === serverPrefix && unitHazards.length === 0
          ? ReactHydrationStatus.Equivalent
          : ReactHydrationStatus.Mismatched;
    } else if (
      !hasIncompleteRoot &&
      !sources?.hasUnknownSource &&
      clientRoots.length === 1 &&
      interactiveServerRoots.length === 0 &&
      staticServerRoots.length === 1
    ) {
      status = ReactHydrationStatus.Mismatched;
    }
    const sourceComplete =
      status === ReactHydrationStatus.NotHydrated ||
      (!hasIncompleteRoot && !sources?.hasUnknownSource && status !== ReactHydrationStatus.Unknown);
    return {
      id: `${unit.id}:hydration`,
      ownerId: unit.id,
      clientRootIds: clientRoots.map((root) => root.id),
      interactiveServerRootIds: interactiveServerRoots.map((root) => root.id),
      staticServerRootIds: staticServerRoots.map((root) => root.id),
      hazardIds: unitHazards.map((hazard) => hazard.id),
      status,
      sourceComplete,
      complete:
        sourceComplete &&
        (status === ReactHydrationStatus.Equivalent || status === ReactHydrationStatus.NotHydrated),
    };
  });
};

export const collectHydrationEquivalence = (
  descriptors: ReadonlyArray<ReactUnitDescriptor>,
  units: ReadonlyArray<ReactSemanticUnit>,
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  unitIdsBySymbol: ReadonlyMap<ts.Symbol, string>,
  edges: ReadonlyArray<ReactSemanticEdge>,
  renders: ReadonlyArray<ReactSemanticRender>,
  slotFlows: ReadonlyArray<ReactSemanticSlotFlow>,
  context: ReactAnalysisContext,
): HydrationGraph => {
  const roots = collectHydrationRoots(sourceFiles, unitIdsBySymbol, context);
  const unitIdsByDescriptor = new Map(
    descriptors.map((descriptor, descriptorIndex) => [descriptor, units[descriptorIndex]?.id]),
  );
  const hasClientRoot = roots.some((root) => root.kind === ReactHydrationRootKind.Client);
  const hazards = hasClientRoot
    ? descriptors.flatMap((descriptor) => {
        const ownerId = unitIdsByDescriptor.get(descriptor);
        return ownerId ? collectHydrationHazardsForUnit(descriptor, ownerId, context) : [];
      })
    : [];
  return {
    roots,
    hazards,
    hydrations: collectHydrations(units, roots, hazards, edges, renders, slotFlows),
  };
};
