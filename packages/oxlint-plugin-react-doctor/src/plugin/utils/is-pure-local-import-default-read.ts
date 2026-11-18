import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenRelativeEsmNamespaceResult } from "./is-proven-relative-esm-namespace-result.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const DEFAULT_MEMBER_NAME = "default";
const INTRINSICS = new Set(["Promise", "Object", "Reflect", "Symbol"]);
const GLOBAL_ROOTS = new Set(["globalThis", "global", "window", "self"]);
const PROTOTYPE_ACCESS = new Set([
  "prototype",
  "constructor",
  "__proto__",
  "getPrototypeOf",
  "setPrototypeOf",
]);
const opaqueByScopes = new WeakMap<ScopeAnalysis, boolean>();

// An inline Promise continuation must produce the object we inspected.
const hasOpaqueRuntimeAccess = (scopes: ScopeAnalysis): boolean => {
  const cached = opaqueByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let found = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (found) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "MemberExpression") &&
        (node.computed || PROTOTYPE_ACCESS.has(getStaticPropertyName(node) ?? "")))
    ) {
      found = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    if (["eval", "Function", "module", "exports", "require"].includes(node.name)) {
      found = true;
    } else if (INTRINSICS.has(node.name)) {
      found = !isProvenUnmodifiedGlobalNamespaceReference(node, node.name, scopes, undefined, true);
    } else if (GLOBAL_ROOTS.has(node.name)) {
      found = !isProvenUnmodifiedGlobalNamespaceReference(node, null, scopes, undefined, true);
    }
  });
  opaqueByScopes.set(scopes, found);
  return found;
};

const isOwnDefaultRecord = (value: EsTreeNode): boolean => {
  const node = stripParenExpression(value);
  if (!isNodeOfType(node, "ObjectExpression") || node.properties.length !== 1) return false;
  const [property] = node.properties;
  return (
    isNodeOfType(property, "Property") &&
    property.kind === "init" &&
    !property.method &&
    !property.computed &&
    isNodeOfType(property.key, "Identifier") &&
    property.key.name === DEFAULT_MEMBER_NAME
  );
};

const isDefaultRead = (receiver: EsTreeNode): boolean => {
  const object = findTransparentExpressionRoot(receiver);
  const member = object.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== object ||
    member.computed ||
    getStaticPropertyName(member) !== DEFAULT_MEMBER_NAME
  )
    return false;
  const value = findTransparentExpressionRoot(member);
  const consumer = value.parent;
  return (
    !isWithinAssignmentTarget(value) &&
    !(isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "delete") &&
    !(isNodeOfType(consumer, "CallExpression") && consumer.callee === value) &&
    !(isNodeOfType(consumer, "TaggedTemplateExpression") && consumer.tag === value)
  );
};

const isLocalImportValue = (raw: EsTreeNode, context: RuleContext): boolean => {
  const value = stripParenExpression(raw);
  if (isNodeOfType(value, "Literal") && value.value === null) return true;
  if (isOwnDefaultRecord(value)) return true;
  if (!isNodeOfType(value, "AwaitExpression")) return false;
  const argument = stripParenExpression(value.argument);
  let imported = argument;
  if (
    isNodeOfType(argument, "CallExpression") &&
    !argument.optional &&
    argument.arguments.length === 1 &&
    isNodeOfType(argument.callee, "MemberExpression") &&
    !argument.callee.optional &&
    !argument.callee.computed &&
    getStaticPropertyName(argument.callee) === "then"
  ) {
    const [mapper] = argument.arguments;
    if (
      !isNodeOfType(mapper, "ArrowFunctionExpression") ||
      mapper.async ||
      !isOwnDefaultRecord(mapper.body)
    )
      return false;
    imported = stripParenExpression(argument.callee.object);
  }
  const filename = context.filename;
  if (
    !filename ||
    !isNodeOfType(imported, "ImportExpression") ||
    imported.options ||
    !isNodeOfType(imported.source, "Literal") ||
    typeof imported.source.value !== "string"
  )
    return false;
  const framework = getReactDoctorStringSetting(context.settings, "framework");
  const projectRoot = framework === "nextjs" ? findNearestPackageDirectory(filename) : null;
  return Boolean(
    projectRoot &&
    framework &&
    isProvenRelativeEsmNamespaceResult({
      fromFilename: filename,
      source: imported.source.value,
      projectRoot,
      framework,
    }),
  );
};

export const isPureLocalImportDefaultRead = (
  member: EsTreeNodeOfType<"MemberExpression">,
  context: RuleContext,
): boolean => {
  const receiver = stripParenExpression(member.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    member.computed ||
    getStaticPropertyName(member) !== DEFAULT_MEMBER_NAME ||
    !isDefaultRead(receiver)
  )
    return false;
  const scopes = context.scopes;
  const symbol = scopes.symbolFor(receiver);
  const functionNode = findEnclosingFunction(member);
  const program = scopes.rootScope.node;
  const declaration = symbol?.declarationNode;
  if (
    !symbol ||
    (symbol.kind !== "let" && symbol.kind !== "const") ||
    !symbol.initializer ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier ||
    declaration.init !== symbol.initializer ||
    !functionNode ||
    findEnclosingFunction(declaration) !== functionNode ||
    !isNodeOfType(program, "Program") ||
    program.sourceType !== "module" ||
    !hasCompleteSymbolReferences(symbol, program, scopes) ||
    hasOpaqueRuntimeAccess(scopes)
  )
    return false;
  if (!isLocalImportValue(symbol.initializer, context)) return false;
  return symbol.references.every(({ identifier, flag }) => {
    if (flag === "read") return isDefaultRead(identifier);
    const assignment = identifier.parent;
    return (
      flag === "write" &&
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === identifier &&
      findEnclosingFunction(assignment) === functionNode &&
      isLocalImportValue(assignment.right, context)
    );
  });
};
