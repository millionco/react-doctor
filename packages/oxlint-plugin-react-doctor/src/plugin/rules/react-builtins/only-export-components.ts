import { defineRule } from "../../utils/define-rule.js";
import { exportAllAddsRuntimeValues } from "../../utils/export-all-adds-runtime-values.js";
import { getReactRouterFrameworkModuleKind } from "../../utils/get-react-router-framework-module-kind.js";
import { isFrameworkRouteOrSpecialFilename } from "../../utils/is-framework-route-or-special-filename.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { functionHasReactElementReturnType } from "../../utils/function-has-react-element-return-type.js";
import { functionReturnsOnlyNull } from "../../utils/function-returns-only-null.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getFastRefreshFileStatus } from "../../utils/get-fast-refresh-file-status.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { ControlFlowAnalysis } from "../../semantic/control-flow-graph.js";
import {
  NON_FAST_REFRESH_PATH_SEGMENTS,
  EXPO_ALLOWED_EXPORT_NAMES,
  NEXT_ALLOWED_EXPORT_NAMES,
  NOT_REACT_COMPONENT_EXPRESSION_TYPES,
  REACT_ROUTER_ALLOWED_EXPORT_NAMES,
  REACT_ROUTER_FACTORY_CALLEE_NAMES,
  TANSTACK_ROUTE_FACTORY_CALLEE_NAMES,
} from "./only-export-components-tables.js";

const NAMED_EXPORT_MESSAGE =
  "This file exports non-components, so Fast Refresh can't safely preserve component state.";
const ANONYMOUS_MESSAGE =
  "This component is unnamed, so Fast Refresh can't track it and falls back to a full reload.";
const EXPORT_ALL_MESSAGE =
  "`export *` hides what's exported, so Fast Refresh can't safely preserve component state.";
const REACT_CONTEXT_MESSAGE =
  "This file exports a context with components, so Fast Refresh can't safely preserve component state.";
const NAMESPACE_OBJECT_MESSAGE =
  "This export bundles components inside an object, so Fast Refresh can't track them and falls back to a full reload.";

interface OnlyExportComponentsSettings {
  allowExportNames?: ReadonlyArray<string>;
  allowConstantExport?: boolean;
  customHOCs?: ReadonlyArray<string>;
  checkJS?: boolean;
}

const DEFAULT_REACT_HOCS: ReadonlyArray<string> = ["memo", "forwardRef", "lazy"];
const EMPTY_NAME_SET: ReadonlySet<string> = new Set();
const TEST_SUPPORT_FILE_PATTERN =
  /(?:^|\/)(?:test|spec)(?:[-_.]?(?:utils?|helpers?|setup|fixtures?))?\.(?:jsx?|tsx?)$/i;

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<OnlyExportComponentsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { onlyExportComponents?: OnlyExportComponentsSettings })
          .onlyExportComponents ?? {})
      : {};
  return {
    allowExportNames: ruleSettings.allowExportNames ?? [],
    // Default `true` because exported constants are stable references —
    // Fast Refresh can hot-swap them without forcing a full reload.
    // Matches the recommended configuration in
    // `eslint-plugin-react-refresh` for Vite projects.
    allowConstantExport: ruleSettings.allowConstantExport ?? true,
    customHOCs: ruleSettings.customHOCs ?? [],
    checkJS: ruleSettings.checkJS ?? false,
  };
};

const skipTsExpression = (expression: EsTreeNode): EsTreeNode => {
  if (
    expression.type === "TSAsExpression" ||
    expression.type === "TSSatisfiesExpression" ||
    expression.type === "TSNonNullExpression"
  ) {
    return skipTsExpression((expression as { expression: EsTreeNode }).expression);
  }
  return expression;
};

type ExportType =
  | { kind: "react-component" }
  | { kind: "non-component"; reportNode: EsTreeNode }
  | { kind: "allowed" }
  | { kind: "react-context"; reportNode: EsTreeNode }
  | { kind: "namespace-object"; reportNode: EsTreeNode };

const isReactCreateContext = (initializer: EsTreeNode | null | undefined): boolean => {
  if (!initializer) return false;
  const expression = skipTsExpression(initializer);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = expression.callee;
  if (isNodeOfType(callee, "Identifier") && callee.name === "createContext") return true;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "createContext"
  ) {
    return true;
  }
  return false;
};

const isRouteFactoryCall = (expression: EsTreeNode, bindings: RouteFactoryBindings): boolean => {
  let currentCall: EsTreeNode = expression;
  while (isNodeOfType(currentCall, "CallExpression")) {
    const callee = currentCall.callee as EsTreeNode;
    if (isNodeOfType(callee, "Identifier") && bindings.localNames.has(callee.name)) return true;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.object, "Identifier") &&
      bindings.namespaceNames.has(callee.object.name) &&
      isNodeOfType(callee.property, "Identifier") &&
      bindings.memberNames.has(callee.property.name)
    ) {
      return true;
    }
    if (!isNodeOfType(callee, "CallExpression")) return false;
    currentCall = callee;
  }
  return false;
};

// At least one argument, and every argument is a config shape (object /
// literal / template) — the call defines something from data rather than
// wrapping a component, so there is no component (named or not) to track.
// Function or identifier arguments keep the anonymous-HOC treatment, and a
// ZERO-argument call (`export default makeHomePage()`) stays anonymous too:
// with no arguments there is no config evidence, and the factory may well
// return a component.
const isConfigOnlyFactoryCall = (call: EsTreeNodeOfType<"CallExpression">): boolean =>
  call.arguments.length > 0 &&
  call.arguments.every((argument) => {
    const expression = skipTsExpression(argument as EsTreeNode);
    return (
      isNodeOfType(expression, "ObjectExpression") ||
      isNodeOfType(expression, "Literal") ||
      isNodeOfType(expression, "TemplateLiteral")
    );
  });

interface AnalyzerState {
  customHocs: ReadonlySet<string>;
  allowExportNames: ReadonlySet<string>;
  allowConstantExport: boolean;
  allowedRouteExportNames: ReadonlySet<string>;
  routeFactoryBindings: RouteFactoryBindings;
  componentFactorySymbolIds: ReadonlySet<number>;
  importSymbolIds: ReadonlySet<number>;
  // Module-scope component binding names — used to spot a component
  // reference smuggled inside a namespace-object export.
  localComponentNames: ReadonlySet<string>;
  scopes: ScopeAnalysis;
  controlFlow: ControlFlowAnalysis;
}

interface RouteFactoryBindings {
  localNames: ReadonlySet<string>;
  memberNames: ReadonlySet<string>;
  namespaceNames: ReadonlySet<string>;
}

const isReactHocName = (name: string, state: AnalyzerState): boolean => state.customHocs.has(name);

const isHocCallee = (callee: EsTreeNode, state: AnalyzerState): boolean => {
  if (isNodeOfType(callee, "Identifier")) return isReactHocName(callee.name, state);
  if (isNodeOfType(callee, "MemberExpression")) {
    if (
      isNodeOfType(callee.property, "Identifier") &&
      isReactHocName(callee.property.name, state)
    ) {
      return true;
    }
    if (isNodeOfType(callee.object, "Identifier") && isReactHocName(callee.object.name, state)) {
      return true;
    }
    if (
      isNodeOfType(callee.object, "CallExpression") &&
      isHocCallee(callee.object.callee as EsTreeNode, state)
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(callee, "CallExpression")) {
    // OXC special-cases `connect(...)(Component)` regardless of customHOCs.
    if (isNodeOfType(callee.callee, "Identifier") && callee.callee.name === "connect") {
      return true;
    }
    return isHocCallee(callee.callee as EsTreeNode, state);
  }
  return false;
};

const canBeReactFunctionComponent = (
  initializer: EsTreeNode | null | undefined,
  state: AnalyzerState,
): boolean => {
  if (!initializer) return false;
  const expression = skipTsExpression(initializer);
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression")
  ) {
    return functionHasReactRenderSemantics(expression, state);
  }
  if (isNodeOfType(expression, "CallExpression")) {
    return isHocCallee(expression.callee as EsTreeNode, state);
  }
  return false;
};

const functionHasReactRenderSemantics = (functionNode: EsTreeNode, state: AnalyzerState): boolean =>
  functionContainsReactRenderOutput(functionNode, state.scopes, state.controlFlow) ||
  functionHasReactElementReturnType(functionNode) ||
  functionReturnsOnlyNull(functionNode);

const isReactComponentInitializer = (expression: EsTreeNode, state: AnalyzerState): boolean => {
  const stripped = skipTsExpression(expression);
  if (isNodeOfType(stripped, "ArrowFunctionExpression")) return true;
  if (isNodeOfType(stripped, "FunctionExpression")) return Boolean(stripped.id);
  if (isNodeOfType(stripped, "Identifier")) return isReactComponentName(stripped.name);
  if (
    isNodeOfType(stripped, "CallExpression") &&
    isHocCallee(stripped.callee as EsTreeNode, state) &&
    stripped.arguments.length > 0
  ) {
    return true;
  }
  return false;
};

const isNextDynamicCall = (
  expression: EsTreeNode,
  nextDynamicImportSymbolIds: ReadonlySet<number>,
  scopes: ScopeAnalysis,
): boolean => {
  const stripped = skipTsExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  const callee = skipTsExpression(stripped.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  return symbol !== null && nextDynamicImportSymbolIds.has(symbol.id);
};

const functionReturnsNextDynamicComponent = (
  expression: EsTreeNode,
  nextDynamicImportSymbolIds: ReadonlySet<number>,
  scopes: ScopeAnalysis,
): boolean => {
  const stripped = skipTsExpression(expression);
  if (
    !isNodeOfType(stripped, "ArrowFunctionExpression") &&
    !isNodeOfType(stripped, "FunctionExpression") &&
    !isNodeOfType(stripped, "FunctionDeclaration")
  ) {
    return false;
  }
  const body = stripped.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) {
    return isNextDynamicCall(body, nextDynamicImportSymbolIds, scopes);
  }
  if (body.body.length !== 1) return false;
  const statement = body.body[0];
  return (
    Boolean(statement) &&
    isNodeOfType(statement, "ReturnStatement") &&
    Boolean(statement.argument) &&
    isNextDynamicCall(statement.argument as EsTreeNode, nextDynamicImportSymbolIds, scopes)
  );
};

const isComponentFactoryCall = (expression: EsTreeNode, state: AnalyzerState): boolean => {
  const stripped = skipTsExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  const callee = skipTsExpression(stripped.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = state.scopes.symbolFor(callee);
  return symbol !== null && state.componentFactorySymbolIds.has(symbol.id);
};

const isProvenComponentValue = (
  expression: EsTreeNode,
  state: AnalyzerState,
  inspectedSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  const stripped = skipTsExpression(expression);
  if (isNodeOfType(stripped, "Identifier")) {
    const symbol = state.scopes.symbolFor(stripped);
    if (!symbol) return false;
    if (state.localComponentNames.has(stripped.name)) {
      return symbol.references.every((reference) => reference.flag === "read");
    }
    if (isReactComponentName(stripped.name) && symbol.kind === "import") return true;
    if (inspectedSymbolIds.has(symbol.id)) return false;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return false;
    const strippedInitializer = skipTsExpression(initializer);
    if (
      isNodeOfType(strippedInitializer, "ArrowFunctionExpression") ||
      isNodeOfType(strippedInitializer, "FunctionExpression")
    ) {
      return false;
    }
    return isProvenComponentValue(initializer, state, new Set([...inspectedSymbolIds, symbol.id]));
  }
  if (
    isNodeOfType(stripped, "MemberExpression") &&
    !stripped.computed &&
    isNodeOfType(stripped.object, "Identifier") &&
    isNodeOfType(stripped.property, "Identifier") &&
    isReactComponentName(stripped.property.name)
  ) {
    const objectSymbol = state.scopes.symbolFor(stripped.object);
    return objectSymbol !== null && state.importSymbolIds.has(objectSymbol.id);
  }
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    return functionHasReactRenderSemantics(stripped, state);
  }
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  if (!isHocCallee(stripped.callee as EsTreeNode, state)) return false;
  return stripped.arguments.some((argument) =>
    isProvenComponentValue(argument as EsTreeNode, state),
  );
};

const isDirectRefreshWrapperCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  state: AnalyzerState,
): boolean => {
  const callee = skipTsExpression(call.callee as EsTreeNode);
  if (isHocCallee(callee, state)) return call.arguments.length > 0;
  if (!isNodeOfType(callee, "Identifier") && !isNodeOfType(callee, "MemberExpression")) {
    return false;
  }
  return call.arguments.some((argument) => isProvenComponentValue(argument as EsTreeNode, state));
};

// The real Fast-Refresh breaker react-refresh checks for: a module whose
// export is a plain OBJECT that carries components among its properties
// (`export const Pages = { Home, sidebarWidth: 240 }` / `export default
// { Home, helpers }`). The export itself is not a component function, so
// `isReactRefreshBoundary` rejects the whole module and every component
// reached through the object full-reloads on edit.
const objectExpressionBundlesComponents = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  state: AnalyzerState,
): boolean => {
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const value = skipTsExpression(property.value as EsTreeNode);
    if (isNodeOfType(value, "Identifier")) {
      if (state.localComponentNames.has(value.name)) return true;
      continue;
    }
    const hasComponentNamedKey =
      !property.computed &&
      isNodeOfType(property.key as EsTreeNode, "Identifier") &&
      isReactComponentName((property.key as EsTreeNodeOfType<"Identifier">).name);
    if (!hasComponentNamedKey) continue;
    // The PascalCase key alone is a name heuristic — `{ FormatDate:
    // (d) => d.toISOString() }` is a formatter map, not a component
    // bundle — so the inline function must actually render.
    if (
      (isNodeOfType(value, "ArrowFunctionExpression") ||
        isNodeOfType(value, "FunctionExpression")) &&
      functionHasReactRenderSemantics(value, state)
    ) {
      return true;
    }
    if (
      isNodeOfType(value, "CallExpression") &&
      isHocCallee(value.callee as EsTreeNode, state) &&
      value.arguments.length > 0
    ) {
      return true;
    }
  }
  return false;
};

const classifyExport = (
  name: string,
  reportNode: EsTreeNode,
  isFunction: boolean,
  initializer: EsTreeNode | null | undefined,
  state: AnalyzerState,
): ExportType => {
  if (isNodeOfType(reportNode, "Identifier") && isProvenComponentValue(reportNode, state)) {
    return { kind: "react-component" };
  }
  // HoC-wrapped: `export const Foo = memo(...)` — treat as component.
  if (initializer) {
    const expression = skipTsExpression(initializer);
    if (
      isNodeOfType(expression, "CallExpression") &&
      isReactComponentName(name) &&
      isComponentFactoryCall(expression, state)
    ) {
      return { kind: "react-component" };
    }
    // File-based-router route objects (`export const Route =
    // createFileRoute("/profile")({ component: ProfilePage })`) — the
    // router's bundler plugin owns HMR for these modules, so the route
    // export and any local components it references are conventional.
    if (isRouteFactoryCall(expression, state.routeFactoryBindings)) {
      return { kind: "react-component" };
    }
    if (
      isNodeOfType(expression, "CallExpression") &&
      isHocCallee(expression.callee as EsTreeNode, state) &&
      expression.arguments.length > 0 &&
      isReactComponentName(name)
    ) {
      return { kind: "react-component" };
    }
    // Conditional with both branches react-component-like.
    if (
      isNodeOfType(expression, "ConditionalExpression") &&
      isReactComponentName(name) &&
      isReactComponentInitializer(expression.consequent as EsTreeNode, state) &&
      isReactComponentInitializer(expression.alternate as EsTreeNode, state)
    ) {
      return { kind: "react-component" };
    }
  }
  if (state.allowExportNames.has(name)) return { kind: "allowed" };
  // Framework route-module contract exports (`loader`, `meta`,
  // `getStaticProps`, `metadata`, …) — Remix / React Router / Next.js /
  // Expo Router bundler plugins special-case these during Fast Refresh,
  // so co-exporting them with the route component is the documented
  // shape, not a hazard.
  if (state.allowedRouteExportNames.has(name)) return { kind: "allowed" };
  // Custom hook exports — `useFoo`, `useBar`. Modern Vite Fast
  // Refresh (>= 4.x via @vitejs/plugin-react-swc + react-refresh)
  // already handles `use[A-Z]*` exports alongside components: the
  // hook is treated as a refresh boundary and the consuming
  // component re-renders cleanly. Flagging these is unactionable
  // noise in current toolchains. The user can still opt out by
  // listing the hook in `allowExportNames` if their setup is older.
  if (/^use[A-Z]/.test(name)) return { kind: "allowed" };
  if (state.allowConstantExport && initializer) {
    const expression = skipTsExpression(initializer);
    if (
      isNodeOfType(expression, "Literal") ||
      isNodeOfType(expression, "TemplateLiteral") ||
      (isNodeOfType(expression, "UnaryExpression") &&
        isNodeOfType(expression.argument as EsTreeNode, "Literal")) ||
      isNodeOfType(expression, "BinaryExpression")
    ) {
      return { kind: "allowed" };
    }
  }
  if (isFunction) {
    return isReactComponentName(name)
      ? { kind: "react-component" }
      : { kind: "non-component", reportNode };
  }
  if (initializer) {
    const stripped = skipTsExpression(initializer);
    if (isNodeOfType(stripped, "CallExpression")) {
      if (isReactCreateContext(stripped)) {
        return { kind: "react-context", reportNode };
      }
      return { kind: "non-component", reportNode };
    }
    if (
      isNodeOfType(stripped, "ObjectExpression") &&
      objectExpressionBundlesComponents(stripped, state)
    ) {
      return { kind: "namespace-object", reportNode };
    }
    if (isNodeOfType(stripped, "MemberExpression")) {
      return isProvenComponentValue(stripped, state)
        ? { kind: "react-component" }
        : { kind: "non-component", reportNode };
    }
    if (isNodeOfType(stripped, "Identifier")) {
      return isProvenComponentValue(stripped, state)
        ? { kind: "react-component" }
        : { kind: "non-component", reportNode };
    }
    if (NOT_REACT_COMPONENT_EXPRESSION_TYPES.has(stripped.type)) {
      return { kind: "non-component", reportNode };
    }
    if (
      isNodeOfType(stripped, "ArrowFunctionExpression") ||
      isNodeOfType(stripped, "FunctionExpression")
    ) {
      return { kind: "non-component", reportNode };
    }
  }
  return isReactComponentName(name)
    ? { kind: "react-component" }
    : { kind: "non-component", reportNode };
};

const isFileNameAllowed = (filename: string | undefined, checkJS: boolean): boolean => {
  // No filename means we're in a unit-test runner — keep the rule active
  // so the test suite still exercises the analyzer.
  if (!filename) return true;
  if (TEST_SUPPORT_FILE_PATTERN.test(filename)) return false;
  // Test / Storybook / Cypress files don't participate in Fast Refresh,
  // so a mixed-export shape there can't break it.
  if (
    filename.includes(".test.") ||
    filename.includes(".spec.") ||
    filename.includes(".cy.") ||
    filename.includes(".stories.")
  ) {
    return false;
  }
  // Directories that host non-Fast-Refresh code (test fixtures, mocks,
  // Cypress specs without `.cy.` suffix, etc.).
  for (const segment of NON_FAST_REFRESH_PATH_SEGMENTS) {
    if (filename.includes(segment)) return false;
  }
  // Only `.tsx` / `.jsx` (and `.js` when `checkJS` is on) modules run
  // through Fast Refresh. Pure `.ts` files — barrels, utility modules,
  // server code — can't break it no matter what they export, so the
  // rule has nothing to enforce there.
  if (filename.endsWith(".tsx") || filename.endsWith(".jsx")) return true;
  if (checkJS && filename.endsWith(".js")) return true;
  return false;
};

// Port of `oxc_linter::rules::react::only_export_components`. Defaults
// are tuned for Fast Refresh: only fires in `.tsx`/`.jsx` (and `.js`
// when `checkJS` is on) — pure `.ts` files don't participate in HMR
// and can't break it. `allowConstantExport: true` by default because
// stable constants alongside components don't break Fast Refresh.
export const onlyExportComponents = defineRule({
  id: "only-export-components",
  title: "Non-component export in component file",
  severity: "warn",
  recommendation:
    "Move non-component exports out of component files so Fast Refresh can preserve component state instead of full-reloading.",
  category: "Architecture",
  create: (context): RuleVisitors => {
    const settings = resolveSettings(context.settings);
    const filename = normalizeFilename(context.filename ?? "");
    const fastRefreshStatus = getFastRefreshFileStatus(context);
    if (!fastRefreshStatus.isActive) return {};
    const reactRouterModuleKind =
      fastRefreshStatus.runtime === "react-router" || fastRefreshStatus.runtime === "remix"
        ? getReactRouterFrameworkModuleKind(context)
        : null;
    const isReactRouterRouteModule =
      reactRouterModuleKind === "route" || reactRouterModuleKind === "root";
    const isFrameworkFileExempt =
      !isReactRouterRouteModule &&
      isFrameworkRouteOrSpecialFilename(context, fastRefreshStatus.runtime);
    if (isFrameworkFileExempt) return {};
    if (!isFileNameAllowed(filename, settings.checkJS)) return {};
    const allowedRouteExportNames =
      fastRefreshStatus.runtime === "next"
        ? NEXT_ALLOWED_EXPORT_NAMES
        : fastRefreshStatus.runtime === "expo"
          ? EXPO_ALLOWED_EXPORT_NAMES
          : isReactRouterRouteModule
            ? REACT_ROUTER_ALLOWED_EXPORT_NAMES
            : EMPTY_NAME_SET;
    const routeFactoryMemberNames =
      fastRefreshStatus.runtime === "tanstack"
        ? TANSTACK_ROUTE_FACTORY_CALLEE_NAMES
        : fastRefreshStatus.runtime === "react-router" || fastRefreshStatus.runtime === "remix"
          ? REACT_ROUTER_FACTORY_CALLEE_NAMES
          : EMPTY_NAME_SET;
    const routeFactoryLocalNames = new Set<string>();
    const routeFactoryNamespaceNames = new Set<string>();
    const nextDynamicImportSymbolIds = new Set<number>();
    const importSymbolIds = new Set<number>();
    const routeFactoryBindings: RouteFactoryBindings = {
      localNames: routeFactoryLocalNames,
      memberNames: routeFactoryMemberNames,
      namespaceNames: routeFactoryNamespaceNames,
    };
    const exportNodes: EsTreeNode[] = [];
    const componentCandidates: EsTreeNode[] = [];
    const createRootNames = new Set<string>();
    const hydrateRootNames = new Set<string>();
    const legacyRenderNames = new Set<string>();
    const reactDomNamespaceNames = new Set<string>();
    const rootNames = new Set<string>();
    let hasRootMount = false;
    const isCreateRootCall = (node: EsTreeNode): boolean => {
      if (!isNodeOfType(node, "CallExpression")) return false;
      if (isNodeOfType(node.callee, "Identifier")) {
        return createRootNames.has(node.callee.name);
      }
      return (
        isNodeOfType(node.callee, "MemberExpression") &&
        isNodeOfType(node.callee.object, "Identifier") &&
        reactDomNamespaceNames.has(node.callee.object.name) &&
        isNodeOfType(node.callee.property, "Identifier") &&
        node.callee.property.name === "createRoot"
      );
    };
    const visitImportDeclaration = (node: EsTreeNode): void => {
      if (!isNodeOfType(node, "ImportDeclaration")) return;
      const source = node.source.value;
      for (const specifier of node.specifiers) {
        const symbol = context.scopes.symbolFor(specifier.local);
        if (symbol) importSymbolIds.add(symbol.id);
      }
      const isRouteFactorySource =
        typeof source === "string" &&
        ((fastRefreshStatus.runtime === "tanstack" &&
          (source.startsWith("@tanstack/react-router") ||
            source.startsWith("@tanstack/react-start"))) ||
          ((fastRefreshStatus.runtime === "react-router" ||
            fastRefreshStatus.runtime === "remix") &&
            (source === "react-router" ||
              source === "react-router-dom" ||
              source === "@remix-run/react")));
      if (isRouteFactorySource) {
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            routeFactoryNamespaceNames.add(specifier.local.name);
            continue;
          }
          const importedName = getImportedName(specifier);
          if (importedName && routeFactoryMemberNames.has(importedName)) {
            routeFactoryLocalNames.add(specifier.local.name);
          }
        }
      }
      if (source === "next/dynamic") {
        for (const specifier of node.specifiers) {
          if (!isNodeOfType(specifier, "ImportDefaultSpecifier")) continue;
          const symbol = context.scopes.symbolFor(specifier.local);
          if (symbol) nextDynamicImportSymbolIds.add(symbol.id);
        }
      }
      if (source !== "react-dom" && source !== "react-dom/client") return;
      for (const specifier of node.specifiers) {
        if (
          isNodeOfType(specifier, "ImportDefaultSpecifier") ||
          isNodeOfType(specifier, "ImportNamespaceSpecifier")
        ) {
          reactDomNamespaceNames.add(specifier.local.name);
          continue;
        }
        const importedName = getImportedName(specifier);
        if (importedName === "createRoot") createRootNames.add(specifier.local.name);
        if (importedName === "hydrateRoot") hydrateRootNames.add(specifier.local.name);
        if (source === "react-dom" && (importedName === "render" || importedName === "hydrate")) {
          legacyRenderNames.add(specifier.local.name);
        }
      }
    };
    const visitCallExpression = (node: EsTreeNode): void => {
      if (!isNodeOfType(node, "CallExpression")) return;
      if (isInsideFunctionScope(node)) return;
      if (isNodeOfType(node.callee, "Identifier")) {
        if (hydrateRootNames.has(node.callee.name) || legacyRenderNames.has(node.callee.name)) {
          hasRootMount = true;
        }
        return;
      }
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        !isNodeOfType(node.callee.property, "Identifier")
      ) {
        return;
      }
      const methodName = node.callee.property.name;
      if (
        isNodeOfType(node.callee.object, "Identifier") &&
        reactDomNamespaceNames.has(node.callee.object.name) &&
        (methodName === "render" || methodName === "hydrate" || methodName === "hydrateRoot")
      ) {
        hasRootMount = true;
        return;
      }
      if (methodName !== "render") return;
      if (isCreateRootCall(node.callee.object)) {
        hasRootMount = true;
        return;
      }
      if (
        isNodeOfType(node.callee.object, "Identifier") &&
        rootNames.has(node.callee.object.name)
      ) {
        hasRootMount = true;
      }
    };
    const pushExportNode = (node: EsTreeNode): void => {
      exportNodes.push(node);
    };
    const pushComponentCandidate = (node: EsTreeNode): void => {
      componentCandidates.push(node);
      if (
        isNodeOfType(node, "VariableDeclarator") &&
        isNodeOfType(node.id, "Identifier") &&
        node.init &&
        isCreateRootCall(node.init) &&
        !isInsideFunctionScope(node)
      ) {
        rootNames.add(node.id.name);
      }
    };
    return {
      ImportDeclaration: visitImportDeclaration,
      CallExpression: visitCallExpression,
      AssignmentExpression(node) {
        if (isNodeOfType(node.left, "Identifier") && rootNames.has(node.left.name)) {
          rootNames.delete(node.left.name);
        }
      },
      ExportAllDeclaration: pushExportNode,
      ExportDefaultDeclaration: pushExportNode,
      ExportNamedDeclaration: pushExportNode,
      FunctionDeclaration: pushComponentCandidate,
      VariableDeclarator: pushComponentCandidate,
      ClassDeclaration: pushComponentCandidate,
      "Program:exit"() {
        if (hasRootMount) return;
        // Module-scope component bindings (exported or not) — a component
        // declared inside another function is never a Fast Refresh
        // boundary, so only top-level names participate.
        const localComponentNames = new Set<string>();
        const componentFactorySymbolIds = new Set<number>();
        for (const child of componentCandidates) {
          if (isInsideFunctionScope(child)) continue;
          if (isNodeOfType(child, "FunctionDeclaration") && child.id) {
            if (
              functionReturnsNextDynamicComponent(child, nextDynamicImportSymbolIds, context.scopes)
            ) {
              const symbol = context.scopes.symbolFor(child.id);
              if (symbol?.references.every((reference) => reference.flag === "read")) {
                componentFactorySymbolIds.add(symbol.id);
              }
            }
            continue;
          }
          if (
            isNodeOfType(child, "VariableDeclarator") &&
            isNodeOfType(child.id, "Identifier") &&
            child.init &&
            functionReturnsNextDynamicComponent(
              child.init as EsTreeNode,
              nextDynamicImportSymbolIds,
              context.scopes,
            )
          ) {
            const symbol = context.scopes.symbolFor(child.id);
            if (symbol?.references.every((reference) => reference.flag === "read")) {
              componentFactorySymbolIds.add(symbol.id);
            }
          }
        }
        const state: AnalyzerState = {
          customHocs: new Set([...DEFAULT_REACT_HOCS, ...settings.customHOCs]),
          allowExportNames: new Set(settings.allowExportNames),
          allowConstantExport: settings.allowConstantExport,
          allowedRouteExportNames,
          routeFactoryBindings,
          componentFactorySymbolIds,
          importSymbolIds,
          localComponentNames,
          scopes: context.scopes,
          controlFlow: context.cfg,
        };
        // A PascalCase name alone is a heuristic (`const FormatDate =
        // (d) => d.toISOString()` is a formatter, not a component), so a
        // directly-inspectable function body must show render output
        // before its name can match inside a namespace-object export.
        // HOC-wrapped initializers (`memo(...)`) stay trusted — the
        // component body isn't inspectable through the wrapper.
        for (const child of componentCandidates) {
          if (isNodeOfType(child, "FunctionDeclaration") && child.id) {
            if (
              isReactComponentName(child.id.name) &&
              !isInsideFunctionScope(child) &&
              functionHasReactRenderSemantics(child, state)
            ) {
              localComponentNames.add(child.id.name);
            }
          }
          if (isNodeOfType(child, "ClassDeclaration") && child.id) {
            if (
              isReactComponentName(child.id.name) &&
              isEs6Component(child) &&
              !isInsideFunctionScope(child)
            ) {
              localComponentNames.add(child.id.name);
            }
          }
          if (isNodeOfType(child, "VariableDeclarator") && isNodeOfType(child.id, "Identifier")) {
            const initializer = child.init as EsTreeNode | null | undefined;
            const expression = initializer ? skipTsExpression(initializer) : null;
            const isDirectFunction =
              expression !== null &&
              (isNodeOfType(expression, "ArrowFunctionExpression") ||
                isNodeOfType(expression, "FunctionExpression"));
            if (
              isReactComponentName(child.id.name) &&
              (canBeReactFunctionComponent(initializer, state) ||
                (expression ? isEs6Component(expression) : false)) &&
              !isInsideFunctionScope(child)
            ) {
              if (!isDirectFunction || functionHasReactRenderSemantics(expression, state)) {
                localComponentNames.add(child.id.name);
              }
            }
          }
        }

        const exports: ExportType[] = [];
        const exportAllNodes: EsTreeNode[] = [];
        let hasReactExport = false;
        let hasAnyExports = false;
        const isExportedNodeIds = new WeakSet<object>();

        // First pass: collect exports.
        for (const child of exportNodes) {
          if (isNodeOfType(child, "ExportAllDeclaration")) {
            // `export type * from '…'` is TS-type-only; skip.
            if ((child as { exportKind?: string }).exportKind === "type") continue;
            hasAnyExports = true;
            const source = child.source.value;
            if (typeof source !== "string" || exportAllAddsRuntimeValues(filename, source)) {
              exportAllNodes.push(child);
            }
            continue;
          }
          if (isNodeOfType(child, "ExportDefaultDeclaration")) {
            hasAnyExports = true;
            const declaration = child.declaration as EsTreeNode;
            const stripped = skipTsExpression(declaration);
            if (
              isNodeOfType(stripped, "FunctionDeclaration") ||
              isNodeOfType(stripped, "FunctionExpression")
            ) {
              const hasRenderOutput = functionHasReactRenderSemantics(stripped, state);
              if ((stripped as EsTreeNodeOfType<"FunctionDeclaration">).id) {
                const idNode = (stripped as EsTreeNodeOfType<"FunctionDeclaration">).id!;
                isExportedNodeIds.add(stripped);
                exports.push(
                  hasRenderOutput
                    ? classifyExport(idNode.name, idNode, true, null, state)
                    : { kind: "non-component", reportNode: idNode },
                );
              } else if (hasRenderOutput) {
                context.report({ node: stripped, message: ANONYMOUS_MESSAGE });
                hasReactExport = true; // anonymous default counts as a react export attempt
              } else {
                exports.push({ kind: "non-component", reportNode: stripped });
              }
              continue;
            }
            if (
              isNodeOfType(stripped, "ClassDeclaration") ||
              isNodeOfType(stripped, "ClassExpression")
            ) {
              if ((stripped as EsTreeNodeOfType<"ClassDeclaration">).id) {
                const idNode = (stripped as EsTreeNodeOfType<"ClassDeclaration">).id!;
                isExportedNodeIds.add(stripped);
                if (isReactComponentName(idNode.name) && isEs6Component(stripped)) {
                  hasReactExport = true;
                } else {
                  exports.push({ kind: "non-component", reportNode: idNode });
                }
              } else {
                context.report({ node: stripped, message: ANONYMOUS_MESSAGE });
              }
              continue;
            }
            if (isNodeOfType(stripped, "Identifier")) {
              exports.push(
                isProvenComponentValue(stripped, state)
                  ? { kind: "react-component" }
                  : { kind: "non-component", reportNode: stripped },
              );
              continue;
            }
            if (isNodeOfType(stripped, "MemberExpression")) {
              if (isProvenComponentValue(stripped, state)) hasReactExport = true;
              else exports.push({ kind: "non-component", reportNode: stripped });
              continue;
            }
            if (isNodeOfType(stripped, "CallExpression")) {
              if (isRouteFactoryCall(stripped, state.routeFactoryBindings)) {
                hasReactExport = true;
                continue;
              }
              if (isReactCreateContext(stripped)) {
                exports.push({ kind: "react-context", reportNode: stripped });
                continue;
              }
              if (isDirectRefreshWrapperCall(stripped, state)) {
                hasReactExport = true;
              } else if (isConfigOnlyFactoryCall(stripped)) {
                // `export default defineFrontComponent({ … })` — an unknown
                // factory fed only config objects/literals is a library
                // definition (SDK registrations, plugin manifests), not an
                // unnamed component. It still counts as a non-component
                // export so a module that ALSO exports components reports
                // the mixed boundary.
                exports.push({ kind: "non-component", reportNode: stripped });
              } else {
                context.report({ node: stripped, message: ANONYMOUS_MESSAGE });
              }
              continue;
            }
            if (isNodeOfType(stripped, "ObjectExpression")) {
              exports.push(
                objectExpressionBundlesComponents(stripped, state)
                  ? { kind: "namespace-object", reportNode: stripped }
                  : { kind: "non-component", reportNode: stripped },
              );
              continue;
            }
            if (isNodeOfType(stripped, "ArrowFunctionExpression")) {
              if (functionHasReactRenderSemantics(stripped, state)) {
                context.report({ node: stripped, message: ANONYMOUS_MESSAGE });
                hasReactExport = true;
              } else {
                exports.push({ kind: "non-component", reportNode: stripped });
              }
              continue;
            }
            if (isNodeOfType(stripped, "Literal") || isNodeOfType(stripped, "NewExpression")) {
              exports.push({ kind: "non-component", reportNode: stripped });
              continue;
            }
            // Other shapes — flag anonymous.
            context.report({ node: child, message: ANONYMOUS_MESSAGE });
            continue;
          }
          if (isNodeOfType(child, "ExportNamedDeclaration")) {
            // `export type { foo }` / `export type { foo } from '…'` is TS-type-only; skip.
            if ((child as { exportKind?: string }).exportKind === "type") continue;
            hasAnyExports = true;
            if (child.declaration) {
              const declaration = child.declaration;
              if (isNodeOfType(declaration, "FunctionDeclaration") && declaration.id) {
                isExportedNodeIds.add(declaration);
                const classifiedExport = classifyExport(
                  declaration.id.name,
                  declaration.id,
                  true,
                  null,
                  state,
                );
                exports.push(
                  functionHasReactRenderSemantics(declaration, state) ||
                    localComponentNames.has(declaration.id.name) ||
                    classifiedExport.kind === "allowed"
                    ? classifiedExport
                    : { kind: "non-component", reportNode: declaration.id },
                );
              } else if (isNodeOfType(declaration, "ClassDeclaration") && declaration.id) {
                isExportedNodeIds.add(declaration);
                if (
                  isReactComponentName(declaration.id.name) &&
                  isEs6Component(declaration as EsTreeNode)
                ) {
                  exports.push({ kind: "react-component" });
                } else {
                  exports.push({ kind: "non-component", reportNode: declaration.id });
                }
              } else if (isNodeOfType(declaration, "VariableDeclaration")) {
                for (const declarator of declaration.declarations) {
                  if (!isNodeOfType(declarator.id, "Identifier")) continue;
                  isExportedNodeIds.add(declarator);
                  const isFunction = canBeReactFunctionComponent(declarator.init ?? null, state);
                  exports.push(
                    classifyExport(
                      declarator.id.name,
                      declarator.id,
                      isFunction,
                      declarator.init as EsTreeNode | null | undefined,
                      state,
                    ),
                  );
                }
              } else if (
                (declaration as EsTreeNode).type === "TSEnumDeclaration" ||
                (declaration as EsTreeNode).type === "TSInterfaceDeclaration" ||
                (declaration as EsTreeNode).type === "TSTypeAliasDeclaration"
              ) {
                if ((declaration as EsTreeNode).type === "TSEnumDeclaration") {
                  exports.push({
                    kind: "non-component",
                    reportNode: declaration as EsTreeNode,
                  });
                }
              }
            }
            // Re-exports (`export { x } from './x'`) forward bindings
            // declared in ANOTHER module — this file holds no value to
            // move, so "move non-component exports out" is unactionable
            // here. Pure barrels (`export { default } from './FlexBasic'`)
            // and convenience re-exports (`export { styles as switchStyles }
            // from './style'`) were the dominant FP shape in production.
            // Component-named re-exports still count toward hasReactExport
            // so local-component analysis stays accurate.
            const isReExportFromSource = Boolean((child as { source?: unknown }).source);
            for (const specifier of child.specifiers ?? []) {
              if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
              if (specifier.exportKind === "type") continue;
              const exported = (specifier as { exported?: EsTreeNode }).exported;
              const local = (specifier as { local?: EsTreeNode }).local;
              let exportedName: string | null = null;
              if (exported && isNodeOfType(exported, "Identifier")) {
                exportedName = exported.name;
              }
              // OXC treats StringLiteral export-as names (`export {
              // Foo as "🍌" }`) as NonComponent regardless of local
              // identifier — match that semantics.
              const localName = local && isNodeOfType(local, "Identifier") ? local.name : null;
              const reportNode = specifier as EsTreeNode;
              let entry: ExportType;
              if (localName && localComponentNames.has(localName)) {
                entry = { kind: "react-component" };
              } else if (
                !isReExportFromSource &&
                localName === exportedName &&
                localName !== null &&
                isReactComponentName(localName)
              ) {
                entry = { kind: "react-component" };
              } else if (exportedName === "default" && localName && local) {
                entry = isProvenComponentValue(local, state)
                  ? { kind: "react-component" }
                  : { kind: "non-component", reportNode };
              } else if (exportedName) {
                entry = classifyExport(
                  exportedName,
                  reportNode,
                  false,
                  isReExportFromSource ? null : local,
                  state,
                );
              } else {
                entry = { kind: "non-component", reportNode };
                // `export { Foo as "🍌" }` still EXPORTS the component —
                // the module is a (broken) component boundary, so the
                // string-literal specifier must be reported as the
                // non-component shape it is.
                if (localName && isReactComponentName(localName)) {
                  exports.push({ kind: "react-component" });
                }
              }
              if (isReExportFromSource && entry.kind !== "react-component") continue;
              exports.push(entry);
            }
          }
        }

        // Tally exports.
        for (const entry of exports) {
          if (entry.kind === "react-component") hasReactExport = true;
        }

        // The react-refresh boundary constraint is about EXPORTS only: a
        // module that exports a component must export nothing but
        // components / allowed constants. Non-exported internal components
        // are fine (react-refresh registers them, and modules that don't
        // export components were never refresh boundaries), so they are
        // deliberately NOT reported. A namespace-object export that
        // carries components is the real breaker — the export is an
        // object, not a component function, so the whole module fails the
        // boundary check — and reports regardless of what else the module
        // exports.
        for (const entry of exports) {
          if (entry.kind === "namespace-object") {
            context.report({ node: entry.reportNode, message: NAMESPACE_OBJECT_MESSAGE });
          }
        }
        if (hasAnyExports && hasReactExport) {
          for (const exportAllNode of exportAllNodes) {
            context.report({ node: exportAllNode, message: EXPORT_ALL_MESSAGE });
          }
          for (const entry of exports) {
            if (entry.kind === "non-component") {
              context.report({ node: entry.reportNode, message: NAMED_EXPORT_MESSAGE });
            }
            if (entry.kind === "react-context") {
              context.report({ node: entry.reportNode, message: REACT_CONTEXT_MESSAGE });
            }
          }
        }
      },
    };
  },
});
