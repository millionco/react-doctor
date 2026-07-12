import { defineRule } from "../../utils/define-rule.js";
import { isFrameworkRouteOrSpecialFilename } from "../../utils/is-framework-route-or-special-filename.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import {
  ENTRY_POINT_BASENAMES,
  NON_FAST_REFRESH_PATH_SEGMENTS,
  NOT_REACT_COMPONENT_EXPRESSION_TYPES,
  ROUTE_FACTORY_CALLEE_NAMES,
  ROUTE_MODULE_ALLOWED_EXPORT_NAMES,
  UTILITY_FILE_BASENAMES,
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

const isRouteFactoryName = (name: string): boolean => ROUTE_FACTORY_CALLEE_NAMES.has(name);

const isRouteFactoryCall = (expression: EsTreeNode): boolean => {
  let currentCall: EsTreeNode = expression;
  while (isNodeOfType(currentCall, "CallExpression")) {
    const callee = currentCall.callee as EsTreeNode;
    if (isNodeOfType(callee, "Identifier") && isRouteFactoryName(callee.name)) return true;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier") &&
      isRouteFactoryName(callee.property.name)
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
  // Module-scope component binding names — used to spot a component
  // reference smuggled inside a namespace-object export.
  localComponentNames: ReadonlySet<string>;
  scopes: ScopeAnalysis;
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
    return true;
  }
  if (isNodeOfType(expression, "CallExpression")) {
    return isHocCallee(expression.callee as EsTreeNode, state);
  }
  return false;
};

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
      functionContainsReactRenderOutput(value, state.scopes)
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
  // HoC-wrapped: `export const Foo = memo(...)` — treat as component.
  if (initializer) {
    const expression = skipTsExpression(initializer);
    // File-based-router route objects (`export const Route =
    // createFileRoute("/profile")({ component: ProfilePage })`) — the
    // router's bundler plugin owns HMR for these modules, so the route
    // export and any local components it references are conventional.
    if (isRouteFactoryCall(expression)) {
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
  if (ROUTE_MODULE_ALLOWED_EXPORT_NAMES.has(name)) return { kind: "allowed" };
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
    if (NOT_REACT_COMPONENT_EXPRESSION_TYPES.has(stripped.type)) {
      return { kind: "non-component", reportNode };
    }
  }
  return isReactComponentName(name)
    ? { kind: "react-component" }
    : { kind: "non-component", reportNode };
};

const isEntryPointFile = (filename: string): boolean => {
  // Match the last path segment regardless of separator (`/` on POSIX,
  // `\\` on Windows — `path.basename`-style logic without depending on
  // node:path in the rule body).
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const basename = lastSlash === -1 ? filename : filename.slice(lastSlash + 1);
  return ENTRY_POINT_BASENAMES.has(basename);
};

// Files that conventionally hold icon / asset / glyph exports —
// `icons.tsx`, `Icons.tsx`, `*Icon.tsx`, `*Logo.tsx`, `sprite.tsx`,
// `svgs.tsx`, `flags.tsx`, etc. These tend to mix component-style
// exports (`const HomeIcon = () => <svg.../>`) with constants by
// design; Fast Refresh isn't useful for icons (no component state
// worth preserving). Pattern is anchored to the basename so a file
// named `MyCardicons.tsx` doesn't accidentally match `icon`.
const ASSET_FILE_BASENAME_PATTERN =
  /^([A-Za-z][\w-]*[-._])?(icons?|svgs?|svg[-_]?sprites?|sprites?|emojis?|flags?|logos?|lockups?|illustrations?|glyphs?|stickers?|emotes?|avatars?|backgrounds?|patterns?|assets?|gradients?|countryVectors?|paymentVectors?|brandVectors?|brandLogos?)\.(t|j)sx?$/;

// Suffix patterns for files conventionally holding MIXED exports
// (component + constants/types/registry data). The list is
// deliberately scoped to utility / registry / framework-specific
// conventions — NOT general component suffixes like `Modal` /
// `Dialog` / `Card` (those routinely ARE the single-component file
// only-export-components correctly wants to protect).
const UTILITY_BASENAME_SUFFIX_PATTERN =
  /^[A-Za-z][\w-]*(Utils|Util|Helpers|Helper|Shared|Constants|Constant|Types|Type|Mappings|Mapping|Lookups|Lookup|Registry|Renderers|Renderer|NodeTypes|EdgeTypes|CellTypes|ColumnDefs|ColumnTypes|ColumnRenderers|Schemas|Schema|Definitions|Definition|Config|Configuration|Defaults|Default|Tokens|Palette|Context|Provider|Providers|Logic|Scene|Page|Layout)\.(t|j)sx?$/;

// Custom hook files: `useCreateRouter.tsx`, `useTranslation.tsx`,
// `useSafeId.tsx`. Hook files conventionally co-export helper types
// + constants + sometimes a small helper component alongside the hook.
// Fast Refresh doesn't preserve hook state across edits anyway.
const HOOK_FILE_BASENAME_PATTERN = /^use[A-Z][\w-]*\.(t|j)sx?$/;

// Plugin-style node-definition files for editor / notebook / flowchart
// ecosystems (tldraw `*ShapeUtil`, xyflow `*Node` plugin registrations,
// Lexical `*Node` declarations). These conventionally export the node
// component + types + handlers from one file. We anchor on the
// distinctive `*Util` / `*Node` plugin-registration shapes; bare
// `Component.tsx` / `Block.tsx` are too generic and would over-match
// ordinary single-component files.
const NODE_DEFINITION_BASENAME_PATTERN =
  /^[A-Z][\w-]*(NodeUtil|ShapeUtil|EdgeUtil|BindingUtil|InlineNode|BlockNode|NotebookNode)\.(t|j)sx?$/;

const isAssetOrUtilityFile = (filename: string): boolean => {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const basename = lastSlash === -1 ? filename : filename.slice(lastSlash + 1);
  if (ASSET_FILE_BASENAME_PATTERN.test(basename)) return true;
  if (UTILITY_FILE_BASENAMES.has(basename)) return true;
  if (UTILITY_BASENAME_SUFFIX_PATTERN.test(basename)) return true;
  if (HOOK_FILE_BASENAME_PATTERN.test(basename)) return true;
  if (NODE_DEFINITION_BASENAME_PATTERN.test(basename)) return true;
  return false;
};

const isFileNameAllowed = (filename: string | undefined, checkJS: boolean): boolean => {
  // No filename means we're in a unit-test runner — keep the rule active
  // so the test suite still exercises the analyzer.
  if (!filename) return true;
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
  // Application entry points (`main.tsx`, `index.tsx`, `bootstrap.tsx`,
  // etc.) call `createRoot(...).render(...)` once and don't participate
  // in HMR — they get full reloaded when changed. Local-component and
  // mixed-export warnings are unactionable here.
  if (isEntryPointFile(filename)) return false;
  // Framework route / special files (Next.js App + Pages Router and
  // metadata image routes, Expo Router layouts, TanStack Router root /
  // lazy routes, Remix / React Router root + entry modules). Their
  // bundler plugins own HMR for these modules, and by framework contract
  // they co-export route segment config / `metadata` / `alt` / `size` /
  // loaders / actions alongside the default component — the documented
  // shape, not a Fast Refresh hazard.
  if (isFrameworkRouteOrSpecialFilename(filename)) return false;
  // Icon / asset / utility collection files (`icons.tsx`, `*Icon.tsx`,
  // `*Logo.tsx`, `sprite.tsx`, `assets.tsx`, `utils.tsx`, `tokens.tsx`,
  // `theme.tsx`, `constants.tsx`, etc.) hold non-state-bearing exports
  // by design. Fast Refresh isn't useful for preserving icon / token
  // instances across edits — the file gets full reloaded and no
  // component state is lost (the file doesn't define one).
  if (isAssetOrUtilityFile(filename)) return false;
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
    if (!isFileNameAllowed(filename, settings.checkJS)) return {};
    const exportNodes: EsTreeNode[] = [];
    const componentCandidates: EsTreeNode[] = [];
    const pushExportNode = (node: EsTreeNode): void => {
      exportNodes.push(node);
    };
    const pushComponentCandidate = (node: EsTreeNode): void => {
      componentCandidates.push(node);
    };
    return {
      ExportAllDeclaration: pushExportNode,
      ExportDefaultDeclaration: pushExportNode,
      ExportNamedDeclaration: pushExportNode,
      FunctionDeclaration: pushComponentCandidate,
      VariableDeclarator: pushComponentCandidate,
      ClassDeclaration: pushComponentCandidate,
      "Program:exit"() {
        // Module-scope component bindings (exported or not) — a component
        // declared inside another function is never a Fast Refresh
        // boundary, so only top-level names participate.
        const localComponentNames = new Set<string>();
        const state: AnalyzerState = {
          customHocs: new Set([...DEFAULT_REACT_HOCS, ...settings.customHOCs]),
          allowExportNames: new Set(settings.allowExportNames),
          allowConstantExport: settings.allowConstantExport,
          localComponentNames,
          scopes: context.scopes,
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
              functionContainsReactRenderOutput(child, context.scopes)
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
            if (
              isReactComponentName(child.id.name) &&
              (canBeReactFunctionComponent(initializer, state) ||
                (initializer ? isEs6Component(skipTsExpression(initializer)) : false)) &&
              !isInsideFunctionScope(child)
            ) {
              const expression = initializer ? skipTsExpression(initializer) : null;
              const isDirectFunction =
                expression !== null &&
                (isNodeOfType(expression, "ArrowFunctionExpression") ||
                  isNodeOfType(expression, "FunctionExpression"));
              if (
                !isDirectFunction ||
                functionContainsReactRenderOutput(expression, context.scopes)
              ) {
                localComponentNames.add(child.id.name);
              }
            }
          }
        }

        const exports: ExportType[] = [];
        let hasReactExport = false;
        let hasAnyExports = false;
        const isExportedNodeIds = new WeakSet<object>();

        // First pass: collect exports.
        for (const child of exportNodes) {
          if (isNodeOfType(child, "ExportAllDeclaration")) {
            // `export type * from '…'` is TS-type-only; skip.
            if ((child as { exportKind?: string }).exportKind === "type") continue;
            hasAnyExports = true;
            context.report({ node: child, message: EXPORT_ALL_MESSAGE });
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
              if ((stripped as EsTreeNodeOfType<"FunctionDeclaration">).id) {
                const idNode = (stripped as EsTreeNodeOfType<"FunctionDeclaration">).id!;
                isExportedNodeIds.add(stripped);
                exports.push(classifyExport(idNode.name, idNode, true, null, state));
              } else {
                context.report({ node: stripped, message: ANONYMOUS_MESSAGE });
                hasReactExport = true; // anonymous default counts as a react export attempt
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
              exports.push(classifyExport(stripped.name, stripped, false, null, state));
              continue;
            }
            if (isNodeOfType(stripped, "CallExpression")) {
              if (isRouteFactoryCall(stripped)) {
                hasReactExport = true;
                continue;
              }
              // is_hoc_call_expression: callee must be HoC AND first
              // arg must be a named/identifier-like value (else
              // anonymous).
              const isHoc = isHocCallee(stripped.callee as EsTreeNode, state);
              const firstArg = stripped.arguments[0] as EsTreeNode | undefined;
              const firstArgIsValid =
                Boolean(firstArg) &&
                ((): boolean => {
                  if (!firstArg) return false;
                  const expression = skipTsExpression(firstArg);
                  if (isNodeOfType(expression, "Identifier")) return true;
                  if (isNodeOfType(expression, "FunctionExpression") && expression.id) return true;
                  if (
                    isNodeOfType(expression, "CallExpression") &&
                    isHocCallee(expression.callee as EsTreeNode, state)
                  )
                    return true;
                  return false;
                })();
              if (isHoc && firstArgIsValid) {
                hasReactExport = true;
              } else if (!isHoc && isConfigOnlyFactoryCall(stripped)) {
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
              context.report({
                node: stripped,
                message: objectExpressionBundlesComponents(stripped, state)
                  ? NAMESPACE_OBJECT_MESSAGE
                  : ANONYMOUS_MESSAGE,
              });
              continue;
            }
            if (
              isNodeOfType(stripped, "ArrowFunctionExpression") ||
              isNodeOfType(stripped, "Literal")
            ) {
              context.report({ node: stripped, message: ANONYMOUS_MESSAGE });
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
                exports.push(
                  classifyExport(declaration.id.name, declaration.id, true, null, state),
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
              if (exportedName === "default" && localName) {
                entry = classifyExport(localName, reportNode, false, null, state);
              } else if (exportedName) {
                entry = classifyExport(exportedName, reportNode, false, null, state);
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
