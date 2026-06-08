import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isCanonicalReactNamespaceName } from "../../utils/is-canonical-react-namespace-name.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Every reader of this context redraws on each render because you build its `value` inline.";

// Modules whose `createContext` export has the same identity
// semantics as React's. Kept in sync with the list in
// no-create-context-in-render.ts.
const CONTEXT_MODULES = ["react", "use-context-selector", "react-tracked"];

const isConstructedValue = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (
    isNodeOfType(stripped, "ObjectExpression") ||
    isNodeOfType(stripped, "ArrayExpression") ||
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression") ||
    isNodeOfType(stripped, "ClassExpression") ||
    isNodeOfType(stripped, "NewExpression") ||
    isNodeOfType(stripped, "JSXElement") ||
    isNodeOfType(stripped, "JSXFragment")
  ) {
    return true;
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return isConstructedValue(stripped.consequent) || isConstructedValue(stripped.alternate);
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return isConstructedValue(stripped.left) || isConstructedValue(stripped.right);
  }
  return false;
};

// True for `<XContext.Provider …>` — the legacy provider shape.
const isProviderMemberName = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXMemberExpression")) return false;
  return node.property.name === "Provider";
};

const isCreateContextCallExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  const callee = stripped.callee;
  if (isNodeOfType(callee, "Identifier")) {
    for (const moduleName of CONTEXT_MODULES) {
      const canonical = getImportedNameFromModule(callee, callee.name, moduleName);
      if (canonical === "createContext") return true;
    }
    return false;
  }
  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    const namespaceIdentifier = callee.object;
    const propertyIdentifier = callee.property;
    if (!isNodeOfType(namespaceIdentifier, "Identifier")) return false;
    if (!isNodeOfType(propertyIdentifier, "Identifier")) return false;
    if (propertyIdentifier.name !== "createContext") return false;
    if (isCanonicalReactNamespaceName(namespaceIdentifier.name)) return true;
    for (const moduleName of CONTEXT_MODULES) {
      const canonical = getImportedNameFromModule(
        namespaceIdentifier,
        namespaceIdentifier.name,
        moduleName,
      );
      if (canonical === null) continue;
      return true;
    }
  }
  return false;
};

// Collects the set of file-local identifier names that are bound to a
// `createContext(...)` call (from `react`, `use-context-selector`, or
// `react-tracked`). Walks only top-level declarators because that's
// where context objects are conventionally declared; in-render
// `createContext` is handled by `no-create-context-in-render` and
// shouldn't be considered "the context" for this rule's purposes.
const collectContextBindings = (programRoot: EsTreeNode): Set<string> => {
  const bindings = new Set<string>();
  if (!isNodeOfType(programRoot, "Program")) return bindings;
  for (const topLevel of programRoot.body ?? []) {
    let declaration: EsTreeNode | null = topLevel;
    if (isNodeOfType(topLevel, "ExportNamedDeclaration") && topLevel.declaration) {
      declaration = topLevel.declaration as EsTreeNode;
    }
    if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) continue;
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!declarator.init) continue;
      if (!isAstNode(declarator.init)) continue;
      if (!isCreateContextCallExpression(declarator.init)) continue;
      bindings.add(declarator.id.name);
    }
  }
  return bindings;
};

// True for `<MyContext …>` (React 19 shorthand) when `MyContext` is a
// known createContext binding in this file AND the JSX identifier
// resolves to that top-level binding (not a local shadow like a prop
// or destructured variable with the same name).
const isCreateContextBindingJsxName = (
  node: EsTreeNode,
  contextBindings: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(node, "JSXIdentifier")) return false;
  if (!contextBindings.has(node.name)) return false;
  const binding = findVariableInitializer(node, node.name);
  if (!binding) return false;
  return binding.scopeOwner.type === "Program";
};

// Port of `oxc_linter::rules::react::jsx_no_constructed_context_values`.
// Reports `<XContext.Provider value={…}>` AND the React 19 shorthand
// `<XContext value={…}>` where the `value` is constructed per-render
// (object/array/function/JSX/etc.) AND the provider sits inside a
// function (i.e. a render).
//
// The React 19 shorthand is detected by collecting file-local
// `const X = createContext(...)` bindings on Program visit, then
// checking whether the JSX opening name is one of those bindings.
// Covers createContext imported from `react`, `use-context-selector`,
// and `react-tracked`.
export const jsxNoConstructedContextValues = defineRule<Rule>({
  id: "jsx-no-constructed-context-values",
  title: "Unstable context provider value",
  tags: ["react-jsx-only"],
  severity: "warn",
  disabledBy: ["react-compiler"],
  recommendation:
    "Wrap the context value in `useMemo` or move it outside the component so consumers do not redraw every render.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    let contextBindings: ReadonlySet<string> = new Set<string>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        contextBindings = collectContextBindings(node as EsTreeNode);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        const nameNode = node.name as EsTreeNode;
        const isLegacyProvider = isProviderMemberName(nameNode);
        const isReact19Shorthand = isCreateContextBindingJsxName(nameNode, contextBindings);
        if (!isLegacyProvider && !isReact19Shorthand) return;
        if (!isInsideFunctionScope(node)) return;
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          if (attribute.name.name !== "value") continue;
          const attributeValue = attribute.value;
          if (!attributeValue) continue;
          if (!isNodeOfType(attributeValue, "JSXExpressionContainer")) continue;
          const innerExpression = attributeValue.expression;
          if (!innerExpression || innerExpression.type === "JSXEmptyExpression") continue;
          if (!isConstructedValue(innerExpression as EsTreeNode)) continue;
          context.report({ node: attribute, message: MESSAGE });
        }
      },
    };
  },
});
