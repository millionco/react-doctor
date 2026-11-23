import { analyzeScopes, type ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import { walkAst } from "../../utils/walk-ast.js";
import { hasReactSuspense, isTruthyJsxProperty } from "./truthy-jsx-property.js";

const isNamedImport = (
  reference: EsTreeNode,
  source: string,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(reference, "Identifier")) return false;
  const symbol = scopes.symbolFor(reference);
  const specifier = symbol?.declarationNode;
  const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  return (
    declaration?.source.value === source &&
    declaration.importKind !== "type" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(specifier.imported, "Identifier") &&
    specifier.imported.name === name
  );
};

const getLazyReactBinding = (
  importNode: EsTreeNodeOfType<"ImportExpression">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (importNode.options) return null;
  const loader = importNode.parent;
  const wrapper = loader?.parent;
  if (
    !isNodeOfType(loader, "ArrowFunctionExpression") ||
    loader.body !== importNode ||
    loader.params.length !== 0 ||
    loader.async ||
    !isNodeOfType(wrapper, "CallExpression") ||
    wrapper.optional ||
    wrapper.arguments.length !== 1 ||
    wrapper.arguments[0] !== loader ||
    !isNamedImport(wrapper.callee, "react", "lazy", scopes)
  )
    return null;
  const initializer = wrapper.parent;
  if (
    !isNodeOfType(initializer, "VariableDeclarator") ||
    initializer.init !== wrapper ||
    !isNodeOfType(initializer.id, "Identifier") ||
    !isNodeOfType(initializer.parent, "VariableDeclaration") ||
    initializer.parent.kind !== "const"
  ) {
    return null;
  }
  return initializer.id;
};

const isReturnedInTransparentJsx = (element: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let child = element;
  while (child.parent) {
    const parent: EsTreeNode = child.parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return (
        parent.argument === child &&
        isNodeOfType(parent.parent, "BlockStatement") &&
        isNodeOfType(parent.parent.parent, "FunctionDeclaration")
      );
    }
    if (
      isNodeOfType(parent, "JSXElement") &&
      parent.children.some((candidate) => candidate === child) &&
      hasReactSuspense(parent.openingElement, scopes)
    ) {
      // Provider qualification is supplied by the module resolver.
    } else if (
      isNodeOfType(parent, "JSXFragment") &&
      parent.children.some((candidate) => candidate === child)
    ) {
      // Fragments preserve component elements under the stock JSX implementation.
    } else if (
      (String(parent.type) === "ParenthesizedExpression" ||
        isNodeOfType(parent, "JSXExpressionContainer")) &&
      "expression" in parent &&
      parent.expression === child
    ) {
      // Forward the expression result within the same scope.
    } else if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === child
    ) {
      // In the other branch this component was not constructed.
    } else return false;
    child = parent;
  }
  return false;
};

const getOpeningCount = (
  binding: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  property: string,
  checkPlacement: (element: EsTreeNode) => boolean,
  checkOpening?: (element: EsTreeNodeOfType<"JSXOpeningElement">) => boolean,
): number | null => {
  const symbol = scopes.symbolFor(binding);
  if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return null;
  let openings = 0;
  for (const { flag, identifier } of symbol.references) {
    const tag = identifier.parent;
    if (flag !== "read" || !isNodeOfType(identifier, "JSXIdentifier")) return null;
    if (isNodeOfType(tag, "JSXClosingElement") && tag.name === identifier) continue;
    if (
      !isNodeOfType(tag, "JSXOpeningElement") ||
      tag.name !== identifier ||
      !isNodeOfType(tag.parent, "JSXElement") ||
      !checkPlacement(tag.parent) ||
      !(checkOpening ? checkOpening(tag) : isTruthyJsxProperty(tag, property, program, scopes))
    )
      return null;
    openings++;
  }
  return openings > 0 ? openings : null;
};

interface ConsumerInput {
  readonly path?: string;
  readonly tag: string;
  readonly property: string;
  readonly specifier: string;
  readonly route: "lazy" | "named";
  readonly checkOpening?: (opening: EsTreeNodeOfType<"JSXOpeningElement">) => boolean;
}

export const inspectConsumerModule = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
  input: ConsumerInput,
): number | null => {
  const directBindings: EsTreeNode[] = [];
  let unsupported = false;
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "ImportExpression") &&
      isNodeOfType(node.source, "Literal") &&
      node.source.value === input.specifier
    ) {
      const binding = input.route === "lazy" ? getLazyReactBinding(node, scopes) : null;
      if (binding) directBindings.push(binding);
      else unsupported = true;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.source.value === input.specifier &&
      node.importKind !== "type"
    ) {
      const [specifier] = node.specifiers;
      if (
        input.route === "named" &&
        node.specifiers.length === 1 &&
        isNodeOfType(specifier, "ImportSpecifier") &&
        specifier.importKind !== "type" &&
        isNodeOfType(specifier.imported, "Identifier") &&
        specifier.imported.name === input.tag
      ) {
        directBindings.push(specifier.local);
      } else unsupported = true;
    }
  });
  if (unsupported || directBindings.length !== 1) return null;
  const [binding] = directBindings;
  return getOpeningCount(
    binding,
    program,
    scopes,
    input.property,
    (element) => {
      if (input.route === "lazy") return isReturnedInTransparentJsx(element, scopes);
      const call = element.parent;
      return (
        isNodeOfType(call, "CallExpression") &&
        !call.optional &&
        call.arguments[0] === element &&
        isNamedImport(call.callee, "@testing-library/react", "render", scopes)
      );
    },
    input.checkOpening,
  );
};

export const inspectConsumer = (sourceText: string, input: ConsumerInput): number | null => {
  const program = parseSourceText({ filename: "Input.tsx", sourceText });
  return isNodeOfType(program, "Program")
    ? inspectConsumerModule(program, analyzeScopes(program), input)
    : null;
};
