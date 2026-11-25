import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveVerifiedViteExport } from "./resolve-verified-vite-export.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface OwnedRecordReadInput {
  readonly project: NamedViteSourceProject;
  readonly module: NamedViteSourceModule;
  readonly ownDataKeys: ReadonlySet<string>;
}

const isOwnFieldRead = (expression: EsTreeNode, ownDataKeys: ReadonlySet<string>): boolean => {
  const root = findTransparentExpressionRoot(expression);
  const member = root.parent;
  if (!isNodeOfType(member, "MemberExpression") || member.object !== root || member.optional)
    return false;
  const key = getStaticPropertyName(member);
  if (!key || !ownDataKeys.has(key) || ["__proto__", "constructor", "prototype"].includes(key))
    return false;
  const memberRoot = findTransparentExpressionRoot(member);
  const parent = memberRoot.parent;
  return (
    !isWithinAssignmentTarget(memberRoot) &&
    !(
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
      parent.callee === memberRoot
    ) &&
    !(isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === memberRoot)
  );
};

const isOwnPatternKey = (node: EsTreeNode, binding: SymbolDescriptor): boolean => {
  const property = node.parent;
  return (
    isNodeOfType(property, "Property") &&
    property.shorthand &&
    !property.computed &&
    property.key === node &&
    property.value === binding.bindingIdentifier &&
    isNodeOfType(property.parent, "ObjectPattern")
  );
};

const hasOnlyFieldReferences = (
  binding: SymbolDescriptor,
  ownDataKeys: ReadonlySet<string>,
): boolean =>
  binding.references.every(
    (reference) =>
      reference.flag === "read" &&
      (isOwnPatternKey(reference.identifier, binding) ||
        isOwnFieldRead(reference.identifier, ownDataKeys)),
  );

const isOwnDataDestructure = (
  pattern: EsTreeNode | undefined,
  ownDataKeys: ReadonlySet<string>,
): boolean =>
  isNodeOfType(pattern, "ObjectPattern") &&
  pattern.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.value, "Identifier")
    )
      return false;
    const key = getStaticPropertyKeyName(property);
    return (
      key !== null &&
      ownDataKeys.has(key) &&
      !["__proto__", "constructor", "prototype"].includes(key)
    );
  });

const isDirectOwnedReader = (reference: EsTreeNode, input: OwnedRecordReadInput): boolean => {
  const root = findTransparentExpressionRoot(reference);
  const call = root.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments[0] !== root ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const imported = resolveImportedApiReference(call.callee, input.module.scopes);
  if (imported && (!imported.importedName || imported.isNamespace)) return false;
  const resolved = imported?.importedName
    ? resolveVerifiedViteExport(input.project, input.module, imported.source, imported.importedName)
    : null;
  const module = resolved?.module ?? input.module;
  const local = imported ? null : module.scopes.symbolFor(call.callee);
  if (local?.references.some((reference) => reference.flag !== "read")) return false;
  const localFunction =
    local?.kind === "function"
      ? local.declarationNode
      : local?.kind === "const" && local.initializer
        ? stripParenExpression(local.initializer)
        : null;
  const fn = imported ? resolved?.exportedNode : localFunction;
  if (
    (!isNodeOfType(fn, "FunctionDeclaration") &&
      !isNodeOfType(fn, "FunctionExpression") &&
      !isNodeOfType(fn, "ArrowFunctionExpression")) ||
    fn.async ||
    fn.generator ||
    !fn.body
  )
    return false;
  // An ordinary function can acquire its input without a reference to the formal.
  let hasImplicitRecordCapture = false;
  walkAst(fn, (node) => {
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && ["arguments", "eval"].includes(node.name))
    )
      hasImplicitRecordCapture = true;
    return !hasImplicitRecordCapture;
  });
  if (hasImplicitRecordCapture) return false;
  const formal = fn.params[0];
  if (isOwnDataDestructure(formal, input.ownDataKeys)) return true;
  const parameter = formal && module.scopes.symbolFor(formal);
  return Boolean(
    isNodeOfType(formal, "Identifier") &&
    parameter &&
    hasOnlyFieldReferences(parameter, input.ownDataKeys),
  );
};

// The caller proves the record's initial own data properties, and which lexical
// bindings/expressions receive its identity. Projected values cannot lead back
// to the record. This verifies only the explicit consumers supplied.
export const hasClosedOwnedRecordBindingReads = (
  input: OwnedRecordReadInput,
  binding: SymbolDescriptor,
): boolean =>
  binding.references.every(
    (reference) =>
      reference.flag === "read" &&
      (isOwnPatternKey(reference.identifier, binding) ||
        hasClosedOwnedRecordExpressionRead(input, reference.identifier) ||
        isDirectOwnedReader(reference.identifier, input)),
  );

export const hasClosedOwnedRecordExpressionRead = (
  input: OwnedRecordReadInput,
  expression: EsTreeNode,
): boolean => {
  if (isOwnFieldRead(expression, input.ownDataKeys)) return true;
  const root = findTransparentExpressionRoot(expression);
  const declaration = root.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== root ||
    !isNodeOfType(declaration.id, "ObjectPattern")
  )
    return false;
  return isOwnDataDestructure(declaration.id, input.ownDataKeys);
};
