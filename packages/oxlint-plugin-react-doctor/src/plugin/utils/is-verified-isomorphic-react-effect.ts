import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveVerifiedViteExport } from "./resolve-verified-vite-export.js";

const resolveLexicalImport = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  callee: EsTreeNode,
) => {
  if (!isNodeOfType(callee, "Identifier") || module.scopes.symbolFor(callee)?.kind !== "import")
    return null;
  const imported = resolveImportedApiReference(callee, module.scopes);
  return imported?.importedName && !imported.isNamespace
    ? resolveVerifiedViteExport(project, module, imported.source, imported.importedName)
    : null;
};

const isStockReactMember = (
  node: EsTreeNode,
  module: NamedViteSourceModule,
  member: string,
): boolean => {
  if (
    !isNodeOfType(node, "MemberExpression") ||
    node.optional ||
    node.computed ||
    !isNodeOfType(node.property, "Identifier") ||
    node.property.name !== member ||
    !isNodeOfType(node.object, "Identifier") ||
    module.scopes.symbolFor(node.object)?.kind !== "import"
  )
    return false;
  const imported = resolveImportedApiReference(node.object, module.scopes);
  return imported?.source === "react" && imported.isNamespace;
};

export const isVerifiedIsomorphicReactEffect = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  invocation: EsTreeNode,
): boolean => {
  if (!isNodeOfType(invocation, "CallExpression") || invocation.optional) return false;
  const imported = resolveLexicalImport(project, module, invocation.callee);
  const choice = imported?.exportedNode;
  if (
    !imported ||
    !isNodeOfType(choice, "ConditionalExpression") ||
    !isStockReactMember(choice.consequent, imported.module, "useLayoutEffect") ||
    !isStockReactMember(choice.alternate, imported.module, "useEffect") ||
    !isNodeOfType(choice.test, "CallExpression") ||
    choice.test.optional ||
    choice.test.arguments.length
  )
    return false;
  const guard = resolveLexicalImport(project, imported.module, choice.test.callee);
  const fn = guard?.exportedNode;
  if (
    !guard ||
    !isNodeOfType(fn, "FunctionDeclaration") ||
    fn.async ||
    fn.generator ||
    fn.params.length ||
    !fn.body ||
    fn.body.body.length !== 1
  )
    return false;
  const returned = fn.body.body[0];
  const test = isNodeOfType(returned, "ReturnStatement") ? returned.argument : null;
  return (
    isNodeOfType(test, "BinaryExpression") &&
    test.operator === "!==" &&
    isNodeOfType(test.left, "UnaryExpression") &&
    test.left.operator === "typeof" &&
    isNodeOfType(test.left.argument, "Identifier") &&
    test.left.argument.name === "window" &&
    guard.module.scopes.isGlobalReference(test.left.argument) &&
    isNodeOfType(test.right, "Literal") &&
    test.right.value === "undefined"
  );
};
