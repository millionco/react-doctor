import { BUILTIN_HOOK_NAMES } from "../../../constants/react.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../utils/attach-parent-references.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { hasPossibleStaticPropertyWriteBefore } from "../../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../../utils/has-symbol-write-before.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookName } from "../../../utils/is-react-hook-name.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { findNearestPackageDirectory } from "../../../utils/read-nearest-package-manifest.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isUnconditionalServiceHookConsumer } from "./is-unconditional-service-hook-consumer.js";
import { tracksExportedServiceHookConsumers } from "./service-hook-consumer-graph.js";

type ClassNode = EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression">;

const isPlainClass = (node: EsTreeNode | null | undefined): node is ClassNode =>
  (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression")) &&
  !node.superClass &&
  !node.decorators?.length &&
  !node.body.body.some(
    (member) =>
      (isNodeOfType(member, "PropertyDefinition") || isNodeOfType(member, "MethodDefinition")) &&
      (member.computed || Boolean(member.decorators?.length)),
  );

const hasUntrackedThisUse = (cls: ClassNode, name: string, scopes: ScopeAnalysis): boolean => {
  let untracked = false;
  for (const member of cls.body.body) {
    if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition"))
      continue;
    if (member.static || !member.value) continue;
    const isConstructor = isNodeOfType(member, "MethodDefinition") && member.kind === "constructor";
    const tree = isNodeOfType(member, "MethodDefinition") ? member.value.body : member.value;
    if (!tree) continue;
    walkAst(tree, (node) => {
      if (untracked || isNodeOfType(node, "ClassBody")) return false;
      if (isConstructor && isFunctionLike(node)) return false;
      if (isConstructor && isNodeOfType(node, "ReturnStatement") && node.argument) {
        untracked = true;
      }
      if (isNodeOfType(node, "ThisExpression")) {
        const access = node.parent;
        if (!isNodeOfType(access, "MemberExpression") || access.object !== node) {
          untracked = true;
          return false;
        }
        const property = getResolvedStaticPropertyName(access, scopes);
        untracked ||=
          property === null ||
          (property === name &&
            (isWithinAssignmentTarget(access) ||
              (isNodeOfType(access.parent, "UnaryExpression") &&
                access.parent.operator === "delete")));
      }
      return !untracked;
    });
    if (untracked) return true;
  }
  return false;
};

const isTrackedInvocation = (reference: EsTreeNode, requireRenderPlacement: boolean): boolean =>
  isNodeOfType(reference.parent, "CallExpression") &&
  reference.parent.callee === reference &&
  (!requireRenderPlacement || isUnconditionalServiceHookConsumer(reference.parent));

const tracksDetachedHook = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  requireRenderPlacement: boolean,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const binding = scopes.symbolFor(identifier);
  const property = identifier.parent;
  // A shorthand pattern can expose its key as a separate scope reference.
  const declarationKey =
    isNodeOfType(property, "Property") && property.shorthand ? property.key : null;
  return Boolean(
    binding?.kind === "const" &&
    binding.references.every(
      (reference) =>
        reference.identifier === declarationKey ||
        (reference.flag === "read" &&
          isTrackedInvocation(reference.identifier, requireRenderPlacement)),
    ),
  );
};

const tracksInstanceReferences = (
  binding: SymbolDescriptor,
  name: string,
  scopes: ScopeAnalysis,
  seen: Set<number>,
  requireRenderPlacement = false,
): boolean => {
  if ((binding.kind !== "const" && binding.kind !== "import") || seen.has(binding.id)) return false;
  seen.add(binding.id);
  return binding.references.every(
    (reference) =>
      reference.flag === "read" &&
      tracksInstanceUse(reference.identifier, name, scopes, seen, requireRenderPlacement),
  );
};

const tracksInstanceUse = (
  value: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
  seen: Set<number>,
  requireRenderPlacement = false,
): boolean => {
  const access = value.parent;
  if (isNodeOfType(access, "MemberExpression") && access.object === value) {
    const property = getResolvedStaticPropertyName(access, scopes);
    if (property === null) return false;
    if (
      property !== name ||
      isTrackedInvocation(access, requireRenderPlacement) ||
      isWithinAssignmentTarget(access)
    )
      return true;
    const declarator = access.parent;
    return (
      isNodeOfType(declarator, "VariableDeclarator") &&
      declarator.init === access &&
      tracksDetachedHook(declarator.id, scopes, requireRenderPlacement)
    );
  }
  if (isNodeOfType(access, "VariableDeclarator") && access.init === value) {
    if (isNodeOfType(access.id, "ObjectPattern")) {
      return access.id.properties.every((property) => {
        if (!isNodeOfType(property, "Property")) return false;
        const key = getResolvedStaticPropertyName(property, scopes);
        return (
          key !== null &&
          (key !== name || tracksDetachedHook(property.value, scopes, requireRenderPlacement))
        );
      });
    }
    const binding = scopes.symbolFor(access.id);
    return Boolean(
      binding && tracksInstanceReferences(binding, name, scopes, seen, requireRenderPlacement),
    );
  }
  return isNodeOfType(value, "NewExpression") && isNodeOfType(access, "ExpressionStatement");
};

const getTrackedServiceExports = (cls: ClassNode, name: string, scopes: ScopeAnalysis) => {
  const binding = cls.id ? scopes.symbolFor(cls.id) : null;
  if (!binding || isNodeOfType(cls.parent, "ExportDefaultDeclaration")) return null;
  const singletonNames = new Set<string>();
  for (const reference of binding.references) {
    const construction = reference.identifier.parent;
    if (
      !isNodeOfType(construction, "NewExpression") ||
      construction.callee !== reference.identifier
    ) {
      if (
        !isNodeOfType(construction, "MemberExpression") ||
        construction.object !== reference.identifier ||
        construction.computed ||
        !isNodeOfType(construction.property, "Identifier") ||
        construction.property.name === "prototype" ||
        isWithinAssignmentTarget(construction)
      )
        return null;
      continue;
    }
    if (!tracksInstanceUse(construction, name, scopes, new Set())) return null;
    const declarator = construction.parent;
    if (
      isNodeOfType(declarator, "VariableDeclarator") &&
      isNodeOfType(declarator.id, "Identifier") &&
      isNodeOfType(declarator.parent?.parent, "ExportNamedDeclaration")
    )
      singletonNames.add(declarator.id.name);
  }
  return {
    className: isNodeOfType(cls.parent, "ExportNamedDeclaration") ? binding.name : null,
    singletonNames,
  };
};

const hookFieldNames = new WeakMap<EsTreeNode, string | null>();

export const getServiceHookFieldName = (
  fn: EsTreeNode,
  scopes: ScopeAnalysis,
  filename?: string,
): string | null => {
  if (hookFieldNames.has(fn)) return hookFieldNames.get(fn) ?? null;
  const field = fn.parent;
  const body = field?.parent;
  if (
    !isNodeOfType(fn, "ArrowFunctionExpression") ||
    !isNodeOfType(field, "PropertyDefinition") ||
    field.static ||
    field.value !== fn ||
    field.computed ||
    !isNodeOfType(field.key, "Identifier") ||
    !isReactHookName(field.key.name) ||
    field.key.name === "use" ||
    !isNodeOfType(body, "ClassBody") ||
    !isPlainClass(body.parent)
  )
    return null;
  const name = field.key.name;
  if (
    body.body.some(
      (member) => member !== field && getResolvedStaticPropertyName(member, scopes) === name,
    ) ||
    hasUntrackedThisUse(body.parent, name, scopes)
  ) {
    return null;
  }

  let hasOwnHook = false;
  walkAst(fn.body, (node) => {
    if (hasOwnHook || isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const imported = resolveImportedApiReference(node.callee, scopes);
    if (
      imported?.source === "react" &&
      imported.importedName &&
      BUILTIN_HOOK_NAMES.has(imported.importedName)
    ) {
      hasOwnHook = true;
    }
  });
  const exports = hasOwnHook ? getTrackedServiceExports(body.parent, name, scopes) : null;
  const result =
    exports &&
    tracksExportedServiceHookConsumers(
      body.parent,
      scopes,
      filename,
      exports,
      (binding, ownerScopes) =>
        tracksInstanceReferences(binding, name, ownerScopes, new Set(), true),
    )
      ? name
      : null;
  hookFieldNames.set(fn, result);
  return result;
};

const resolveNewClass = (value: EsTreeNode, scopes: ScopeAnalysis): ClassNode | null => {
  if (!isNodeOfType(value, "NewExpression") || !isNodeOfType(value.callee, "Identifier"))
    return null;
  const binding = scopes.symbolFor(value.callee);
  if (!binding || hasSymbolWriteBefore(binding, value, scopes)) return null;
  const candidate = binding.initializer;
  if (binding.kind !== "class" && binding.kind !== "const") return null;
  return isPlainClass(candidate) ? candidate : null;
};

const resolveThisClass = (node: EsTreeNode): ClassNode | null => {
  let current = node.parent;
  while (current) {
    if (isNodeOfType(current, "ClassBody")) {
      return isPlainClass(current.parent) ? current.parent : null;
    }
    if (isFunctionLike(current) && !isNodeOfType(current, "ArrowFunctionExpression")) {
      if (!isNodeOfType(current.parent, "MethodDefinition") || current.parent.static) return null;
    }
    if (isNodeOfType(current, "PropertyDefinition") && current.static) return null;
    current = current.parent;
  }
  return null;
};

const hasClassField = (
  cls: ClassNode,
  name: string,
  scopes: ScopeAnalysis,
  filename?: string,
): boolean =>
  cls.body.body.some(
    (member) =>
      isNodeOfType(member, "PropertyDefinition") &&
      Boolean(member.value) &&
      getServiceHookFieldName(member.value!, scopes, filename) === name,
  );

const resolvesToServiceHook = (
  receiver: EsTreeNode,
  name: string,
  access: EsTreeNode,
  filename: string | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(receiver, "ThisExpression")) {
    const cls = resolveThisClass(receiver);
    return Boolean(cls && hasClassField(cls, name, scopes, filename));
  }
  if (isNodeOfType(receiver, "NewExpression")) {
    const cls = resolveNewClass(receiver, scopes);
    return Boolean(cls && hasClassField(cls, name, scopes, filename));
  }
  if (
    !isNodeOfType(receiver, "Identifier") ||
    hasPossibleStaticPropertyWriteBefore(receiver, name, access, scopes)
  ) {
    return false;
  }
  const binding = resolveConstIdentifierAlias(receiver, scopes);
  if (binding?.kind === "const" && binding.initializer) {
    const cls = resolveNewClass(stripParenExpression(binding.initializer), scopes);
    return Boolean(cls && hasClassField(cls, name, scopes, filename));
  }
  if (binding?.kind !== "import" || !filename) return false;
  const importRef = resolveImportedApiReference(receiver, scopes);
  if (!importRef?.importedName) return false;
  const exported = resolveCrossFileValueExportWithFilePath(
    filename,
    importRef.source,
    importRef.importedName,
  );
  if (!exported) return false;
  const owner = findNearestPackageDirectory(filename);
  if (!owner || owner !== findNearestPackageDirectory(exported.filePath)) return false;
  attachParentReferences(exported.programNode);
  const originScopes = analyzeScopes(exported.programNode);
  const cls = resolveNewClass(exported.exportedNode, originScopes);
  return Boolean(cls && hasClassField(cls, name, originScopes, exported.filePath));
};

export const resolveServiceHookInvocation = (
  call: EsTreeNodeOfType<"CallExpression">,
  filename: string | undefined,
  scopes: ScopeAnalysis,
): string | null => {
  const callee = stripParenExpression(call.callee);
  let receiver: EsTreeNode | null = null;
  let name: string | null = null;
  let access: EsTreeNode = call;
  if (isNodeOfType(callee, "MemberExpression")) {
    name = getResolvedStaticPropertyName(callee, scopes);
    receiver = callee.object;
  } else if (isNodeOfType(callee, "Identifier")) {
    const binding = resolveConstIdentifierAlias(callee, scopes, true);
    if (binding?.kind !== "const" || !binding.initializer) return null;
    const initializer = stripParenExpression(binding.initializer);
    if (
      isNodeOfType(binding.declarationNode, "VariableDeclarator") &&
      isNodeOfType(binding.declarationNode.id, "ObjectPattern") &&
      isNodeOfType(binding.bindingIdentifier.parent, "Property")
    ) {
      name = getDestructuredBindingPropertyName(binding.bindingIdentifier);
      receiver = initializer;
      access = binding.declarationNode;
    } else if (isNodeOfType(initializer, "MemberExpression")) {
      name = getResolvedStaticPropertyName(initializer, scopes);
      receiver = initializer.object;
      access = initializer;
    }
  }
  return name &&
    name !== "use" &&
    isReactHookName(name) &&
    receiver &&
    resolvesToServiceHook(stripParenExpression(receiver), name, access, filename, scopes)
    ? name
    : null;
};
