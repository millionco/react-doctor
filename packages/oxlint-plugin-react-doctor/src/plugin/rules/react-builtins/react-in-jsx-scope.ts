import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hasAutomaticTypeScriptJsxPragma,
  resolveDirectTypeScriptJsxRoot,
} from "../../utils/resolve-direct-typescript-jsx.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getValueImportDeclaration } from "../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const fileEmitsWithAutomaticTypeScriptJsx = (context: RuleContext): boolean => {
  const filename = context.filename;
  if (!filename?.endsWith(".tsx")) return false;
  let source: string;
  try {
    source = context.sourceCode?.getText?.() ?? readFileSync(filename, "utf8");
  } catch {
    return false;
  }
  if (!hasAutomaticTypeScriptJsxPragma(source)) return false;

  const compilerRoot = resolveDirectTypeScriptJsxRoot(filename);
  if (!compilerRoot) return false;
  const settings = context.settings?.["react-doctor"];
  return !(
    typeof settings === "object" &&
    settings !== null &&
    "rootDirectory" in settings &&
    typeof settings.rootDirectory === "string" &&
    resolve(settings.rootDirectory) !== compilerRoot
  );
};

const MESSAGE = "This JSX crashes because `React` isn't in scope.";

const isValueBinding = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind === "import") return getValueImportDeclaration(symbol) !== null;
  if (isNodeOfType(symbol.declarationNode, "TSImportEqualsDeclaration")) {
    return symbol.declarationNode.importKind !== "type";
  }
  return symbol.kind !== "ts-type-alias" && symbol.kind !== "ts-interface";
};

const hasReactBinding = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  for (
    let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(node);
    scope;
    scope = scope.parent
  ) {
    const react = scope.symbolsByName.get("React");
    if (!react) continue;
    if (isValueBinding(react)) return true;
    // TypeScript can declare a type and a value with the same name in one scope.
    if (scope.symbols.some((symbol) => symbol.name === "React" && isValueBinding(symbol)))
      return true;
  }
  return false;
};

const jsxTagEvaluatesReact = (tag: EsTreeNodeOfType<"JSXOpeningElement">["name"]): boolean => {
  let component = tag;
  while (isNodeOfType(component, "JSXMemberExpression")) component = component.object;
  return isNodeOfType(component, "JSXIdentifier") && component.name === "React";
};

// Port of `oxc_linter::rules::react::react_in_jsx_scope`. Only relevant
// for the legacy classic JSX runtime; tsconfig `jsx: "react-jsx"` (or
// Babel's automatic runtime) makes this unnecessary. Rule fires per
// JSX site when `React` isn't visible from that site's scope chain.
export const reactInJsxScope = defineRule({
  id: "react-in-jsx-scope",
  title: "React not in scope for JSX",
  severity: "warn",
  // Default off because the rule is obsolete for any project on React 17+
  // with the automatic JSX runtime (`jsx: "react-jsx"` in tsconfig, or
  // `runtime: "automatic"` in Babel/SWC) — which is the configuration
  // every modern React tool ships out of the box. Opt in via config if
  // you're stuck on the classic transform.
  defaultEnabled: false,
  recommendation:
    "If you're on React 17+ with the new JSX transform, disable this rule. Otherwise import `React` at the top of the file.",
  create: (context) => {
    let automaticJsx: boolean | undefined;
    const usesAutomaticJsx = () => (automaticJsx ??= fileEmitsWithAutomaticTypeScriptJsx(context));
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (hasReactBinding(node, context.scopes)) return;
        if (!jsxTagEvaluatesReact(node.name) && usesAutomaticJsx()) return;
        context.report({ node: node.name, message: MESSAGE });
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        if (hasReactBinding(node, context.scopes) || usesAutomaticJsx()) return;
        context.report({ node: node.openingFragment, message: MESSAGE });
      },
    };
  },
});
