import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveUnambiguousRelativeImportPath } from "./resolve-relative-import-path.js";
import { walkAst } from "./walk-ast.js";

interface ImportedHostYieldInput {
  readonly awaitNode: EsTreeNode;
  readonly filename: string | undefined;
  readonly scopes: ScopeAnalysis;
}

const schedulerGlobalNames = new Set(["Promise", "setTimeout"]);
const globalObjectNames = new Set(["globalThis", "window", "self", "global", "document"]);
const opaqueGatewayNames = new Set([
  "eval",
  "Function",
  "Reflect",
  "top",
  "parent",
  "opener",
  "frames",
]);
const prototypeCapabilityNames = new Set([
  "constructor",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "getPrototypeOf",
  "setPrototypeOf",
  "defaultView",
  "parentWindow",
]);
const unsafeSchedulerUseByScopes = new WeakMap<ScopeAnalysis, boolean>();
const hostYieldProofByProgram = new WeakMap<EsTreeNode, Map<string, boolean>>();

const hasUnsafeSchedulerUse = (scopes: ScopeAnalysis): boolean => {
  const cached = unsafeSchedulerUseByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let unsafe = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (unsafe) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "MemberExpression") &&
        prototypeCapabilityNames.has(getStaticPropertyName(node) ?? "")) ||
      (isNodeOfType(node, "ObjectPattern") &&
        node.properties.some((property) => {
          if (!isNodeOfType(property, "Property")) return false;
          const key = getStaticPropertyKeyName(property, { allowComputedString: true });
          return (property.computed && !key) || prototypeCapabilityNames.has(key ?? "");
        }))
    ) {
      unsafe = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    const parent = node.parent;
    if (opaqueGatewayNames.has(node.name)) unsafe = true;
    if (schedulerGlobalNames.has(node.name)) {
      unsafe =
        isWithinAssignmentTarget(node) ||
        !(
          (node.name === "Promise" &&
            isNodeOfType(parent, "NewExpression") &&
            parent.callee === node) ||
          (node.name === "setTimeout" &&
            isNodeOfType(parent, "CallExpression") &&
            parent.callee === node)
        );
    }
    if (globalObjectNames.has(node.name)) {
      const property =
        isNodeOfType(parent, "MemberExpression") && parent.object === node
          ? getStaticPropertyName(parent)
          : null;
      unsafe =
        property === null || schedulerGlobalNames.has(property) || opaqueGatewayNames.has(property);
    }
  });
  unsafeSchedulerUseByScopes.set(scopes, unsafe);
  return unsafe;
};

const provesTimerYieldExport = (program: EsTreeNode, exportedName: string): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  const exported = program.body.find(
    (statement) =>
      isNodeOfType(statement, "ExportNamedDeclaration") &&
      isNodeOfType(statement.declaration, "FunctionDeclaration") &&
      statement.declaration.id?.name === exportedName,
  );
  if (!isNodeOfType(exported, "ExportNamedDeclaration")) return false;
  const helper = exported.declaration;
  if (!isNodeOfType(helper, "FunctionDeclaration") || !helper.async || helper.generator)
    return false;
  const delay = helper.params[0];
  if (
    helper.params.length !== 1 ||
    !isNodeOfType(delay, "AssignmentPattern") ||
    !isNodeOfType(delay.left, "Identifier") ||
    !isNodeOfType(delay.right, "Literal") ||
    delay.right.value !== 0 ||
    !isNodeOfType(helper.body, "BlockStatement") ||
    helper.body.body.length !== 1
  ) {
    return false;
  }
  const statement = helper.body.body[0];
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "AwaitExpression")
  ) {
    return false;
  }
  const promise = statement.expression.argument;
  if (
    !isNodeOfType(promise, "NewExpression") ||
    !isNodeOfType(promise.callee, "Identifier") ||
    promise.callee.name !== "Promise" ||
    promise.arguments.length !== 1
  ) {
    return false;
  }
  const executor = promise.arguments[0];
  if (
    !isNodeOfType(executor, "ArrowFunctionExpression") ||
    executor.async ||
    executor.params.length !== 1 ||
    !isNodeOfType(executor.params[0], "Identifier") ||
    !isNodeOfType(executor.body, "BlockStatement") ||
    executor.body.body.length !== 1
  ) {
    return false;
  }
  const schedulerStatement = executor.body.body[0];
  if (!isNodeOfType(schedulerStatement, "ExpressionStatement")) return false;
  const scheduler = schedulerStatement.expression;
  if (
    !isNodeOfType(scheduler, "CallExpression") ||
    scheduler.optional ||
    !isNodeOfType(scheduler.callee, "Identifier") ||
    scheduler.callee.name !== "setTimeout" ||
    scheduler.arguments.length !== 2 ||
    !isNodeOfType(scheduler.arguments[1], "Identifier")
  ) {
    return false;
  }
  const callback = scheduler.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "CallExpression") ||
    callback.body.optional ||
    callback.body.arguments.length !== 0 ||
    !isNodeOfType(callback.body.callee, "Identifier")
  ) {
    return false;
  }
  const scopes = analyzeScopes(program);
  const helperSymbol = helper.id && scopes.symbolFor(helper.id);
  const delaySymbol = scopes.symbolFor(delay.left);
  const resolveSymbol = scopes.symbolFor(executor.params[0]);
  return Boolean(
    helperSymbol &&
    helperSymbol.references.length === 0 &&
    scopes.isGlobalReference(promise.callee) &&
    scopes.isGlobalReference(scheduler.callee) &&
    delaySymbol &&
    scopes.symbolFor(scheduler.arguments[1]) === delaySymbol &&
    resolveSymbol &&
    scopes.symbolFor(callback.body.callee) === resolveSymbol &&
    !hasUnsafeSchedulerUse(scopes),
  );
};

export const isAwaitingImportedHostYield = ({
  awaitNode,
  filename,
  scopes,
}: ImportedHostYieldInput): boolean => {
  if (!filename || !isNodeOfType(awaitNode, "AwaitExpression")) return false;
  const call = awaitNode.argument;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 0 ||
    !isNodeOfType(call.callee, "Identifier")
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(call.callee);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier")
  ) {
    return false;
  }
  const imported = resolveImportedApiReference(call.callee, scopes);
  if (
    !imported?.importedName ||
    !symbol.references.every(({ identifier, flag }) => {
      const parent = identifier.parent;
      return (
        flag === "read" &&
        isNodeOfType(parent, "CallExpression") &&
        parent.callee === identifier &&
        !parent.optional &&
        parent.arguments.length === 0 &&
        isNodeOfType(parent.parent, "AwaitExpression") &&
        parent.parent.argument === parent
      );
    }) ||
    hasUnsafeSchedulerUse(scopes)
  ) {
    return false;
  }
  const provider = resolveUnambiguousRelativeImportPath(filename, imported.source);
  if (!provider || provider === filename) return false;
  const program = parseSourceFile(provider);
  if (!program) return false;
  const proofs = hostYieldProofByProgram.get(program) ?? new Map<string, boolean>();
  const cached = proofs.get(imported.importedName);
  if (cached !== undefined) return cached;
  const proved = provesTimerYieldExport(program, imported.importedName);
  proofs.set(imported.importedName, proved);
  hostYieldProofByProgram.set(program, proofs);
  return proved;
};
