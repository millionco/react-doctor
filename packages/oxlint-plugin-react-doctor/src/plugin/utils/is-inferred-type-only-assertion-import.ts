import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";

import { walkAst } from "./walk-ast.js";

interface ImportEmissionOptions {
  readonly verbatimModuleSyntax?: boolean;
  readonly preserveValueImports?: boolean;
  readonly importsNotUsedAsValues?: string;
  readonly allowNamedTypeReferences?: boolean;
}

const isSupportedTypeReference = (
  identifier: EsTreeNode,
  allowNamedTypeReferences: boolean,
): boolean => {
  const reference = identifier.parent;
  const assertion = reference?.parent;
  return (
    isTypeScriptTypePosition(identifier) &&
    isNodeOfType(reference, "TSTypeReference") &&
    reference.typeName === identifier &&
    (allowNamedTypeReferences ||
      ((isNodeOfType(assertion, "TSAsExpression") ||
        isNodeOfType(assertion, "TSTypeAssertion") ||
        isNodeOfType(assertion, "TSSatisfiesExpression")) &&
        assertion.typeAnnotation === reference))
  );
};

// Apply this inference only once the active emitter and its configuration
// have been established. A value import with a runtime read must survive.
export const isInferredTypeOnlyAssertionImport = (
  declaration: EsTreeNodeOfType<"ImportDeclaration">,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  options: ImportEmissionOptions,
): boolean => {
  if (
    options.verbatimModuleSyntax ||
    options.preserveValueImports ||
    (options.importsNotUsedAsValues !== undefined && options.importsNotUsedAsValues !== "remove") ||
    declaration.specifiers.length === 0
  )
    return false;
  return declaration.specifiers.every((specifier) => {
    if (!isNodeOfType(specifier, "ImportSpecifier")) return false;
    if (specifier.importKind === "type") return true;
    const binding = scopes.symbolFor(specifier.local);
    if (binding?.kind !== "import" || binding.references.length !== 0) return false;
    // The scope analysis intentionally excludes erased TS nodes. Enumerate
    // same-name syntax and refuse every occurrence other than this specifier
    // and type references directly in supported assertions.
    let sawTypeReference = false;
    let unsupported = false;
    walkAst(program, (node) => {
      if (unsupported) return false;
      if (isNodeOfType(node, "Identifier") && node.name === "eval") {
        unsupported = true;
        return false;
      }
      if (
        (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
        node.name !== specifier.local.name ||
        node === specifier.local ||
        node === specifier.imported
      )
        return;
      if (isSupportedTypeReference(node, options.allowNamedTypeReferences === true)) {
        sawTypeReference = true;
      } else unsupported = true;
    });
    return sawTypeReference && !unsupported;
  });
};
