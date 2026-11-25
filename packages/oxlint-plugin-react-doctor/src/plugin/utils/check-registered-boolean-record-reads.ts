import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import {
  hasClosedOwnedRecordBindingReads,
  hasClosedOwnedRecordExpressionRead,
} from "./has-closed-owned-record-reads.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import type {
  BoundNode,
  NamedViteOmittedLiteralProjection,
} from "./project-named-vite-omitted-boolean.js";
import {
  bindingUses,
  hasUniquePlainFields,
  lexical,
  onlyValueUses,
  ownProperty,
  patternRest,
  sameValue,
} from "./project-named-vite-omitted-boolean.js";
import type { RegisteredBooleanForwarding } from "./qualify-registered-boolean-forwarding.js";
import { verifyCarrierSpread } from "./qualify-registered-boolean-forwarding.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { readOwnedReactContextDefinition } from "./resolve-owned-react-context.js";
import { walkAst } from "./walk-ast.js";

export interface RegisteredRecordReadback {
  readonly contextReads: number;
  readonly sourceRecordReads: number;
  readonly remainingWholeCarrierUses: readonly BoundNode[];
}

// Independently validates record members and the complete Context getter use set.
// Whole-carrier uses are returned explicitly because a caller has to prove their
// actual semantics before accepting a warning qualification.
export const inspectRegisteredBooleanRecordReads = (
  project: NamedViteSourceProject,
  projection: NamedViteOmittedLiteralProjection<false | null>,
  forwarding: RegisteredBooleanForwarding,
  recordField: string,
): RegisteredRecordReadback | null => {
  let contextReads = 0;
  let sourceRecordReads = 0;
  const remainingWholeCarrierUses: BoundNode[] = [];
  const acceptRecord = (module: NamedViteSourceModule, value: EsTreeNode): boolean => {
    if (isNodeOfType(value, "ObjectPattern")) {
      return (
        hasUniquePlainFields(value, false) &&
        value.properties.every(
          (property) =>
            isNodeOfType(property, "Property") &&
            isNodeOfType(property.value, "Identifier") &&
            projection.ownDataKeys.has(getStaticPropertyKeyName(property) ?? ""),
        )
      );
    }
    if (!isNodeOfType(value, "Identifier")) return false;
    const alias = lexical(module, value);
    if (!alias) return false;
    sourceRecordReads++;
    return hasClosedOwnedRecordBindingReads(
      { project, module, ownDataKeys: projection.ownDataKeys },
      alias,
    );
  };
  const wrapper = forwarding.wrapper;
  if (wrapper) {
    const providerNode = wrapper.provider.node;
    if (!isNodeOfType(providerNode, "JSXElement")) return null;
    const exposed: BoundNode[] = [];
    const contextOwned = onlyValueUses(project, wrapper.context, (use) => {
      const parent = use.parent;
      if (
        isNodeOfType(parent, "JSXMemberExpression") &&
        parent.object === use &&
        parent.property.name === "Provider"
      ) {
        return (
          parent.parent === providerNode.openingElement ||
          parent.parent === providerNode.closingElement
        );
      }
      if (
        !isNodeOfType(parent, "CallExpression") ||
        parent.optional ||
        parent.arguments.length !== 3 ||
        parent.arguments[2] !== use ||
        !isNodeOfType(parent.parent, "VariableDeclarator") ||
        parent.parent.init !== parent ||
        !isNodeOfType(parent.parent.parent, "VariableDeclaration") ||
        parent.parent.parent.kind !== "const" ||
        !isNodeOfType(parent.parent.id, "Identifier")
      )
        return false;
      if (findProgramRoot(use) !== wrapper.context.module.programNode) return false;
      exposed.push({ module: wrapper.context.module, node: parent });
      return true;
    });
    if (!contextOwned || exposed.length !== 1) return null;
    const getter = exposed[0]!;
    const verified = readOwnedReactContextDefinition(
      project,
      { module: getter.module, exportedNode: getter.node },
      (module, call) => {
        contextReads++;
        const parent = call.parent;
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === call &&
          !parent.optional &&
          !isWithinAssignmentTarget(parent)
        ) {
          const name = getStaticPropertyName(parent);
          if (!name || ["__proto__", "constructor", "prototype"].includes(name)) return false;
          return (
            name !== recordField ||
            hasClosedOwnedRecordExpressionRead(
              { project, module, ownDataKeys: projection.ownDataKeys },
              parent,
            )
          );
        }
        if (
          !isNodeOfType(parent, "VariableDeclarator") ||
          parent.init !== call ||
          !isNodeOfType(parent.id, "ObjectPattern") ||
          !hasUniquePlainFields(parent.id, false)
        )
          return false;
        const selected = ownProperty(parent.id, recordField);
        return !selected || acceptRecord(module, selected.value);
      },
    );
    if (
      !verified ||
      !sameValue(verified.provider, wrapper.provider) ||
      !sameValue(verified.context, wrapper.context)
    )
      return null;
  }

  for (const component of forwarding.graphComponents) {
    const { module, node } = component;
    if (!isFunctionLike(node) || node.params.length > 1 || !node.body) return null;
    let ambientArguments = false;
    walkAst(node, (item) => {
      if (
        isNodeOfType(item, "ThisExpression") ||
        (isNodeOfType(item, "Identifier") && item.name === "arguments")
      )
        ambientArguments = true;
      return !ambientArguments;
    });
    if (ambientArguments) return null;
    const pattern = node.params[0];
    if (!pattern) continue;
    if (!isNodeOfType(pattern, "ObjectPattern") || !hasUniquePlainFields(pattern, true))
      return null;
    const selected = ownProperty(pattern, recordField);
    if (selected && !acceptRecord(module, selected.value)) return null;
    const rest = patternRest(pattern);
    const restBinding = rest && lexical(module, rest);
    if (!restBinding) continue;
    for (const reference of bindingUses(restBinding)) {
      const parent = reference.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === reference &&
        isNodeOfType(parent.id, "ObjectPattern") &&
        hasUniquePlainFields(parent.id, false)
      ) {
        const record = ownProperty(parent.id, recordField);
        if (record && !acceptRecord(module, record.value)) return null;
        continue;
      }
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === reference &&
        !parent.optional &&
        !isWithinAssignmentTarget(parent)
      ) {
        const field = getStaticPropertyName(parent);
        if (!field || ["__proto__", "constructor", "prototype"].includes(field)) return null;
        if (
          field === recordField &&
          !hasClosedOwnedRecordExpressionRead(
            { project, module, ownDataKeys: projection.ownDataKeys },
            parent,
          )
        )
          return null;
        continue;
      }
      const provider = verifyCarrierSpread(project, module, reference);
      if (provider && wrapper && sameValue(provider.wrapper, wrapper.wrapper)) continue;
      remainingWholeCarrierUses.push({ module, node: reference });
    }
  }
  return { contextReads, sourceRecordReads, remainingWholeCarrierUses };
};
