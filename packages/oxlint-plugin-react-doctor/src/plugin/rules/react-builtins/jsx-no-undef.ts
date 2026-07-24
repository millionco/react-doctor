import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getProjectRelativeFilenameFromRoots } from "../../utils/get-project-relative-filename-from-roots.js";
import {
  getReactDoctorStringArraySetting,
  getReactDoctorStringSetting,
} from "../../utils/get-react-doctor-setting.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface UnpluginAutoImportGlobalScope {
  readonly directory: string;
  readonly names: ReadonlySet<string>;
}

const buildMessage = (name: string): string =>
  `\`${name}\` crashes at runtime because it isn't defined here.`;

const KNOWN_GLOBALS = new Set([
  "globalThis",
  "window",
  "document",
  "console",
  "React",
  "self",
  // `this` in JSX member-expression position resolves at runtime to
  // the enclosing component instance / context — not a binding the
  // rule needs to verify (e.g. `<this.props.tag />`).
  "this",
]);

const MODULE_SYNTAX_TYPES = new Set<string>([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "TSExportAssignment",
]);

const reactLiveScriptCache = new WeakMap<EsTreeNode, boolean>();

// react-live / playground snippets (react-datepicker docs, MDX playgrounds)
// are bare scripts — no imports or exports — that end in a top-level
// `render(<App />)` call, with every component injected into the runtime
// scope by the host (`LiveProvider scope={{ DatePicker, ... }}`). Module
// scope analysis is meaningless there: everything looks undefined but
// nothing crashes. Detect the convention (non-module file + bare top-level
// `render(...)` call that has no in-file binding) and stay silent.
const isReactLiveStyleScript = (programRoot: EsTreeNodeOfType<"Program">): boolean => {
  const cached = reactLiveScriptCache.get(programRoot);
  if (cached !== undefined) return cached;
  let bareRenderCallee: EsTreeNode | null = null;
  let hasModuleSyntax = false;
  for (const statement of programRoot.body) {
    if (MODULE_SYNTAX_TYPES.has(statement.type)) {
      hasModuleSyntax = true;
      break;
    }
    if (!isNodeOfType(statement, "ExpressionStatement")) continue;
    const expression = stripParenExpression(statement.expression);
    if (
      isNodeOfType(expression, "CallExpression") &&
      isNodeOfType(expression.callee, "Identifier") &&
      expression.callee.name === "render"
    ) {
      bareRenderCallee = expression.callee;
    }
  }
  const isReactLiveScript =
    !hasModuleSyntax &&
    bareRenderCallee !== null &&
    findVariableInitializer(bareRenderCallee, "render") === null;
  reactLiveScriptCache.set(programRoot, isReactLiveScript);
  return isReactLiveScript;
};

const getRootIdentifier = (elementName: EsTreeNode): string | null => {
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    const firstCharacter = elementName.name.charCodeAt(0);
    const isLowercase = firstCharacter >= 97 && firstCharacter <= 122;
    if (isLowercase) return null; // intrinsic HTML element
    return elementName.name;
  }
  if (isNodeOfType(elementName, "JSXMemberExpression")) {
    let current: EsTreeNode = elementName;
    while (isNodeOfType(current, "JSXMemberExpression")) {
      current = current.object;
    }
    if (isNodeOfType(current, "JSXIdentifier")) return current.name;
  }
  return null;
};

const resolveUnpluginAutoImportGlobalScopes = (
  settings: RuleContext["settings"],
): ReadonlyArray<UnpluginAutoImportGlobalScope> => {
  const reactDoctorSettings = settings?.["react-doctor"];
  if (
    typeof reactDoctorSettings !== "object" ||
    reactDoctorSettings === null ||
    Array.isArray(reactDoctorSettings)
  ) {
    return [];
  }

  const rawScopes = Object.getOwnPropertyDescriptor(
    reactDoctorSettings,
    "unpluginAutoImportGlobalScopes",
  )?.value;
  if (!Array.isArray(rawScopes)) return [];

  const scopes: UnpluginAutoImportGlobalScope[] = [];
  for (const rawScope of rawScopes) {
    if (typeof rawScope !== "object" || rawScope === null || Array.isArray(rawScope)) continue;
    const directory = Object.getOwnPropertyDescriptor(rawScope, "directory")?.value;
    const names = Object.getOwnPropertyDescriptor(rawScope, "names")?.value;
    if (typeof directory !== "string" || !Array.isArray(names)) continue;
    const validNames = names.filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
    scopes.push({ directory, names: new Set(validNames) });
  }
  return scopes;
};

const isInjectedRuntimeGlobal = (
  name: string,
  relativeFilename: string | null,
  configuredRuntimeGlobals: ReadonlySet<string>,
  scopes: ReadonlyArray<UnpluginAutoImportGlobalScope>,
): boolean => {
  if (configuredRuntimeGlobals.has(name)) return true;
  if (relativeFilename === null) return false;
  let nearestScope: UnpluginAutoImportGlobalScope | null = null;
  for (const scope of scopes) {
    const isInsideScope =
      scope.directory.length === 0 || relativeFilename.startsWith(`${scope.directory}/`);
    if (
      isInsideScope &&
      (!nearestScope || scope.directory.length > nearestScope.directory.length)
    ) {
      nearestScope = scope;
    }
  }
  return nearestScope?.names.has(name) ?? false;
};

// Port of `oxc_linter::rules::react::jsx_no_undef`. Reports JSX usages
// of an identifier (or root of a member expression) that has no
// binding visible from the JSX site.
//
// Scope-aware via `findVariableInitializer`:
//
//   - Block-scoped `let` / `const` declarations are only visible in
//     their owning block — JSX in a sibling block flags as undefined.
//   - Function-scoped `var` and function/class declarations bind to
//     the enclosing function-or-program scope (JS hoisting).
//   - Imports bind to the module scope and are visible everywhere.
//   - TS declarations that have runtime representation (`enum`,
//     `namespace`, `import X = require(...)`) DO suppress the
//     diagnostic. `interface` and `type` alias declarations do NOT
//     — those are erased at runtime and JSX usage of them is an
//     error we want to surface.
export const jsxNoUndef = defineRule({
  id: "jsx-no-undef",
  title: "Undefined JSX component",
  severity: "error",
  recommendation:
    "Import the component or fix the typo so React can resolve the JSX identifier at runtime.",
  create: (context) => {
    const autoImportGlobalScopes = resolveUnpluginAutoImportGlobalScopes(context.settings);
    const configuredRuntimeGlobals = new Set(
      getReactDoctorStringArraySetting(context.settings, "runtimeGlobals"),
    );
    const configuredAutoImportRootDirectories = getReactDoctorStringArraySetting(
      context.settings,
      "unpluginAutoImportRootDirectories",
    );
    const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
    const fallbackAutoImportRootDirectories = rootDirectory ? [rootDirectory] : [];
    const autoImportRootDirectories =
      configuredAutoImportRootDirectories.length > 0
        ? configuredAutoImportRootDirectories
        : fallbackAutoImportRootDirectories;
    const relativeFilename = getProjectRelativeFilenameFromRoots(
      context.filename ?? "",
      autoImportRootDirectories,
    );
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const rootIdentifier = getRootIdentifier(node.name as EsTreeNode);
        if (!rootIdentifier) return;
        if (KNOWN_GLOBALS.has(rootIdentifier)) return;
        if (
          isInjectedRuntimeGlobal(
            rootIdentifier,
            relativeFilename,
            configuredRuntimeGlobals,
            autoImportGlobalScopes,
          )
        ) {
          return;
        }
        const programRoot = findProgramRoot(node);
        if (!programRoot) return;
        if (isReactLiveStyleScript(programRoot)) return;
        // Scope-aware lookup first — finds bindings whose scope owner is
        // an ancestor of the JSX site (respects let/const block scoping
        // AND TS declarations like enum / type / interface / module).
        if (findVariableInitializer(node, rootIdentifier)) return;
        context.report({ node: node.name, message: buildMessage(rootIdentifier) });
      },
    };
  },
});
