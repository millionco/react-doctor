import type { EsTreeNode } from "../ast/es-tree-node.js";
import { forEachChildNode } from "../ast/for-each-child-node.js";
import { isFunctionLike } from "../ast/is-function-like.js";
import { isNodeOfType } from "../ast/is-node-of-type.js";
import type { Place, ResolveBinding } from "../ir/place.js";

// Lower an ESTree subtree into the ordered list of binding reads/writes
// (`Place`s) the SSA builder consumes — the variable-level analogue of the
// React Compiler's `BuildHIR` operand/lvalue extraction, minus field-level
// granularity. We walk in evaluation order so a block's occurrence list
// matches the order the Braun renamer must see (`x = x + 1` reads the old
// `x` before writing the new one). Nested functions are skipped: each owns
// its own CFG and SSA.

interface PlaceEmitter {
  (place: Place): void;
}

const emitIdentifier = (
  node: EsTreeNode,
  kind: "read" | "write" | "declare",
  resolveBinding: ResolveBinding,
  emit: PlaceEmitter,
): void => {
  if (!isNodeOfType(node, "Identifier")) return;
  const binding = resolveBinding(node);
  if (binding === null) return;
  emit({ binding, name: node.name, kind, node });
};

// A binding *target* (assignment lhs, declarator id, for-in/of left): an
// Identifier is a write; a member access writes a field we don't model, so
// its object is merely read; destructuring patterns recurse.
const walkWriteTarget = (
  node: EsTreeNode,
  resolveBinding: ResolveBinding,
  emit: PlaceEmitter,
): void => {
  if (isNodeOfType(node, "Identifier")) {
    emitIdentifier(node, "write", resolveBinding, emit);
    return;
  }
  if (isNodeOfType(node, "ObjectPattern")) {
    for (const property of node.properties) {
      if (isNodeOfType(property, "RestElement")) {
        walkWriteTarget(property.argument as EsTreeNode, resolveBinding, emit);
        continue;
      }
      if (property.computed) walkReads(property.key as EsTreeNode, resolveBinding, emit);
      walkWriteTarget(property.value as EsTreeNode, resolveBinding, emit);
    }
    return;
  }
  if (isNodeOfType(node, "ArrayPattern")) {
    for (const element of node.elements) {
      if (element) walkWriteTarget(element as EsTreeNode, resolveBinding, emit);
    }
    return;
  }
  if (isNodeOfType(node, "AssignmentPattern")) {
    walkReads(node.right as EsTreeNode, resolveBinding, emit);
    walkWriteTarget(node.left as EsTreeNode, resolveBinding, emit);
    return;
  }
  if (isNodeOfType(node, "RestElement")) {
    walkWriteTarget(node.argument as EsTreeNode, resolveBinding, emit);
    return;
  }
  // `obj.x = …` / anything else: the target itself is read, not a binding write.
  walkReads(node, resolveBinding, emit);
};

// Read occurrences in evaluation order. The default branch threads children
// left-to-right (source order ≈ evaluation order for the constructs SSA
// reasons about); the explicit cases fix the spots where they diverge.
const walkReads = (node: EsTreeNode, resolveBinding: ResolveBinding, emit: PlaceEmitter): void => {
  if (isFunctionLike(node)) {
    // A function declaration binds its own name; its body has its own SSA.
    if (isNodeOfType(node, "FunctionDeclaration") && node.id) {
      emitIdentifier(node.id as EsTreeNode, "write", resolveBinding, emit);
    }
    return;
  }

  if (isNodeOfType(node, "Identifier")) {
    emitIdentifier(node, "read", resolveBinding, emit);
    return;
  }

  if (isNodeOfType(node, "VariableDeclaration")) {
    for (const declarator of node.declarations) {
      if (declarator.init) {
        walkReads(declarator.init as EsTreeNode, resolveBinding, emit);
        walkWriteTarget(declarator.id as EsTreeNode, resolveBinding, emit);
        continue;
      }
      // `let x;` / `var x;` — a binding declared without a value. Only a
      // bare Identifier can lack an initializer (init-less patterns are a
      // syntax error), so this is the binding's declaration, not a store.
      emitIdentifier(declarator.id as EsTreeNode, "declare", resolveBinding, emit);
    }
    return;
  }

  if (isNodeOfType(node, "AssignmentExpression")) {
    // Compound assignment (`+=`) reads the lhs before the rhs; plain `=`
    // evaluates the rhs first, then stores.
    if (node.operator !== "=") walkReadTarget(node.left as EsTreeNode, resolveBinding, emit);
    walkReads(node.right as EsTreeNode, resolveBinding, emit);
    walkWriteTarget(node.left as EsTreeNode, resolveBinding, emit);
    return;
  }

  if (isNodeOfType(node, "UpdateExpression")) {
    walkReadTarget(node.argument as EsTreeNode, resolveBinding, emit);
    walkWriteTarget(node.argument as EsTreeNode, resolveBinding, emit);
    return;
  }

  if (isNodeOfType(node, "MemberExpression")) {
    walkReads(node.object as EsTreeNode, resolveBinding, emit);
    if (node.computed) walkReads(node.property as EsTreeNode, resolveBinding, emit);
    return;
  }

  if (isNodeOfType(node, "Property")) {
    if (node.computed) walkReads(node.key as EsTreeNode, resolveBinding, emit);
    walkReads(node.value as EsTreeNode, resolveBinding, emit);
    return;
  }

  forEachChildNode(node, (child) => walkReads(child, resolveBinding, emit));
};

// A binding target evaluated as a read (compound-assignment / update lhs).
const walkReadTarget = (
  node: EsTreeNode,
  resolveBinding: ResolveBinding,
  emit: PlaceEmitter,
): void => {
  if (isNodeOfType(node, "Identifier")) {
    emitIdentifier(node, "read", resolveBinding, emit);
    return;
  }
  walkReads(node, resolveBinding, emit);
};

// Ordered read/write occurrences of resolvable bindings inside `node`,
// stopping at nested function boundaries.
export const collectPlaces = (node: EsTreeNode, resolveBinding: ResolveBinding): Place[] => {
  const places: Place[] = [];
  walkReads(node, resolveBinding, (place) => places.push(place));
  return places;
};

// Parameter bindings are written once, at the function entry, before any
// body instruction runs. Default values are reads evaluated at entry too.
export const collectParameterPlaces = (
  parameters: ReadonlyArray<EsTreeNode>,
  resolveBinding: ResolveBinding,
): Place[] => {
  const places: Place[] = [];
  for (const parameter of parameters) {
    walkWriteTarget(parameter, resolveBinding, (place) => places.push(place));
  }
  return places;
};
