import { collectReferenceIdentifierNames } from "./collect-reference-identifier-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// Next.js Pages Router data functions are compiled out of the client bundle
// along with every import referenced only from inside them.
const SERVER_DATA_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "getServerSideProps",
  "getStaticProps",
  "getStaticPaths",
]);

const isServerDataFunctionStatement = (statement: EsTreeNode): boolean => {
  const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
    ? statement.declaration
    : statement;
  if (!declaration) return false;
  if (isNodeOfType(declaration, "FunctionDeclaration")) {
    return declaration.id !== null && SERVER_DATA_FUNCTION_NAMES.has(declaration.id.name);
  }
  if (isNodeOfType(declaration, "VariableDeclaration")) {
    return declaration.declarations.every(
      (declarator) =>
        isNodeOfType(declarator.id, "Identifier") &&
        SERVER_DATA_FUNCTION_NAMES.has(declarator.id.name),
    );
  }
  return false;
};

const getJsxRootName = (nameNode: EsTreeNode | null | undefined): string | null => {
  let cursor: EsTreeNode | null | undefined = nameNode;
  while (cursor && cursor.type === "JSXMemberExpression") {
    cursor = (cursor as { object?: EsTreeNode }).object;
  }
  if (cursor && cursor.type === "JSXIdentifier") {
    const name = (cursor as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }
  return null;
};

const collectClientRuntimeReferenceNames = (program: EsTreeNodeOfType<"Program">): Set<string> => {
  const runtimeNames = new Set<string>();
  for (const statement of program.body ?? []) {
    if (isNodeOfType(statement, "ImportDeclaration")) continue;
    if (isServerDataFunctionStatement(statement)) continue;
    collectReferenceIdentifierNames(statement, runtimeNames);
  }
  // collectReferenceIdentifierNames sees only plain Identifiers — JSX usage
  // (`<Bar />`) references the binding through a JSXIdentifier, so it is
  // gathered separately here.
  walkAst(program, (node) => {
    if (node.type === "JSXOpeningElement") {
      const rootName = getJsxRootName((node as { name?: EsTreeNode }).name);
      if (rootName) runtimeNames.add(rootName);
    }
  });
  return runtimeNames;
};

const cachedRuntimeNamesByProgram = new WeakMap<EsTreeNodeOfType<"Program">, Set<string>>();

// True when no binding of the import survives into the client bundle: every
// runtime specifier is referenced only in type positions (TypeScript erases
// the whole declaration at emit time), never referenced at all, or referenced
// only inside Next.js server data functions (the compiler strips those — and
// their imports — from the client build). A bare side-effect import
// (`import "x"`) always ships.
export const isImportAbsentFromClientBundle = (
  importNode: EsTreeNodeOfType<"ImportDeclaration">,
): boolean => {
  const specifiers = importNode.specifiers ?? [];
  if (specifiers.length === 0) return false;
  const programRoot = findProgramRoot(importNode);
  if (!programRoot) return false;
  let runtimeNames = cachedRuntimeNamesByProgram.get(programRoot);
  if (!runtimeNames) {
    runtimeNames = collectClientRuntimeReferenceNames(programRoot);
    cachedRuntimeNamesByProgram.set(programRoot, runtimeNames);
  }
  for (const specifier of specifiers) {
    if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
    const local = (specifier as { local?: EsTreeNode }).local;
    if (!local || !isNodeOfType(local, "Identifier")) return false;
    if (runtimeNames.has(local.name)) return false;
  }
  return true;
};
