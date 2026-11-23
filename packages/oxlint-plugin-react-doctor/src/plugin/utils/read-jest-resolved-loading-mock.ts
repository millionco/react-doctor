import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { NamedJestSourceInspection } from "./read-named-jest-caller.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

type Call = EsTreeNodeOfType<"CallExpression">;

interface SelectedJestMock {
  readonly focalImport: string;
  readonly hookExportName: string;
  readonly field: string;
}

const plainField = (value: EsTreeNode | null, name: string): EsTreeNode | null => {
  if (!value) return null;
  const object = stripParenExpression(value);
  if (!isNodeOfType(object, "ObjectExpression")) return null;
  let selected: EsTreeNode | null = null;
  const keys = new Set<string>();
  for (const entry of object.properties) {
    if (!isNodeOfType(entry, "Property") || entry.kind !== "init" || entry.method) return null;
    const key = getStaticPropertyKeyName(entry);
    if (key === null || key === "__proto__" || keys.has(key)) return null;
    keys.add(key);
    if (key === name) selected = entry.value;
  }
  return selected;
};

const readZeroArgumentArrowReturn = (value: EsTreeNode | null): EsTreeNode | null => {
  if (
    !value ||
    !isNodeOfType(value, "ArrowFunctionExpression") ||
    value.async ||
    value.params.length !== 0
  )
    return null;
  return getSingleReturnExpression(value);
};

const jestMethod = (
  source: NamedJestSourceInspection,
  node: EsTreeNode,
  method: string,
): node is Call =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.optional &&
  getStaticPropertyKeyName(node.callee) === method &&
  source.isStockGlobal(node.callee.object, "jest");

const sharesSuite = (
  source: NamedJestSourceInspection,
  render: Call,
  registrationOwner: EsTreeNode,
): boolean => {
  let block = render.parent?.parent;
  while (isNodeOfType(block, "BlockStatement")) {
    const callback = block.parent;
    const registration = callback?.parent;
    if (
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      !isNodeOfType(registration, "CallExpression") ||
      registration.arguments[1] !== callback ||
      !isNodeOfType(registration.parent, "ExpressionStatement")
    )
      return false;
    const owner = registration.parent.parent;
    if (owner === registrationOwner) return true;
    block = owner;
  }
  return false;
};

/** Checks an already resolved mock ID under the verified named CommonJS Jest profile. */
export const readJestResolvedLoadingMock = (
  source: NamedJestSourceInspection,
  selected: SelectedJestMock,
): boolean => {
  const [match, duplicate] = source.localMocks.filter(
    (mock) => mock.focalImport === selected.focalImport,
  );
  if (!match || duplicate || !source.renders.length) return false;
  const registrations: Call[] = [];
  let opaquePromise = false;
  walkAst(source.program, (node) => {
    if (
      jestMethod(source, node, "mock") &&
      isNodeOfType(node.arguments[0], "Literal") &&
      node.arguments[0].value === match.registration
    )
      registrations.push(node);
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "Promise" &&
      source.scopes.isGlobalReference(node)
    )
      opaquePromise = true;
  });
  if (opaquePromise || registrations.length !== 1) return false;
  const factory = registrations[0].arguments[1];
  const hook = plainField(readZeroArgumentArrowReturn(factory), selected.hookExportName);
  const field = plainField(readZeroArgumentArrowReturn(hook), selected.field);
  if (!isNodeOfType(field, "Identifier")) return false;
  const binding = source.scopes.symbolFor(field);
  const declaration = binding?.declarationNode;
  const shorthand =
    isNodeOfType(field.parent, "Property") && field.parent.shorthand && field.parent.key !== field
      ? field.parent.key
      : undefined;
  const references = binding?.references.filter(({ identifier }) => identifier !== shorthand) ?? [];
  if (
    !binding ||
    binding.kind !== "const" ||
    !hasCompleteSymbolReferences(binding, source.program, source.scopes) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== binding.bindingIdentifier ||
    declaration.parent?.parent !== source.program ||
    !declaration.init ||
    !jestMethod(source, declaration.init, "fn") ||
    declaration.init.arguments.length !== 0 ||
    references.length !== 2 ||
    references.some(({ flag }) => flag !== "read")
  )
    return false;

  const setupRef = references.find(({ identifier }) => identifier !== field)?.identifier;
  const method = setupRef?.parent;
  const setup = method?.parent;
  if (
    !isNodeOfType(method, "MemberExpression") ||
    method.object !== setupRef ||
    method.optional ||
    getStaticPropertyKeyName(method) !== "mockResolvedValue" ||
    !isNodeOfType(setup, "CallExpression") ||
    setup.optional ||
    setup.callee !== method ||
    setup.arguments.length !== 1 ||
    !isNodeOfType(setup.arguments[0], "ArrayExpression")
  )
    return false;
  const statement = setup.parent;
  const block = statement?.parent;
  const callback = block?.parent;
  const register = callback?.parent;
  const registrationOwner = register?.parent?.parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement") ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    callback.body !== block ||
    !isNodeOfType(register, "CallExpression") ||
    register.optional ||
    register.arguments.length !== 1 ||
    register.arguments[0] !== callback ||
    !source.isStockGlobal(register.callee, "beforeEach") ||
    !isNodeOfType(register.parent, "ExpressionStatement") ||
    !registrationOwner
  )
    return false;
  // Every preceding operation either reaches the setup or throws, which causes
  // the named Jest runner to skip that render. Control-flow statements are not
  // covered by this local proof.
  const prior = block.body.slice(
    0,
    block.body.findIndex((node) => node === statement),
  );
  return (
    prior.every((node) => isNodeOfType(node, "ExpressionStatement")) &&
    source.renders.every((render) => sharesSuite(source, render, registrationOwner))
  );
};
