import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// `<object>.<property>()` calls whose result is non-deterministic — it differs
// per call and is unavailable / inconsistent during SSR, so it can NOT be
// passed as a deterministic `useState(initial)` argument. Seeding such a value
// from a mount effect is the CORRECT pattern, not a "you might not need an
// effect" smell.
const NON_DETERMINISTIC_MEMBER_CALLS: ReadonlySet<string> = new Set([
  "Math.random",
  "Date.now",
  "performance.now",
  "crypto.randomUUID",
  "crypto.getRandomValues",
]);

// Bare id-generator calls (`nanoid()`, `uuid()`, …). Each produces a fresh,
// non-deterministic value, so the same SSR-safety reasoning applies.
const NON_DETERMINISTIC_ID_GENERATOR_NAMES: ReadonlySet<string> = new Set([
  "nanoid",
  "uuid",
  "cuid",
  "ulid",
  "createId",
]);

// True when the subtree invokes any non-deterministic source. Scans the whole
// subtree because the value often flows through a local (`const id = nanoid();
// setId(id)`) rather than being the direct setter argument — but never
// descends into function expressions: a stored callback
// (`setCallback(() => Date.now())`) is itself a deterministic value.
// `new Date()` with no arguments captures the current instant, so it is as
// non-deterministic as `Date.now()`; `new Date(value)` stays deterministic.
const isZeroArgDateConstruction = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === "Date" &&
  (node.arguments?.length ?? 0) === 0;

export const containsNonDeterministicSource = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (isFunctionLike(child)) return false;
    if (isZeroArgDateConstruction(child)) {
      found = true;
      return false;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "Identifier") &&
      NON_DETERMINISTIC_ID_GENERATOR_NAMES.has(callee.name)
    ) {
      found = true;
      return false;
    }
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.object, "Identifier") &&
      isNodeOfType(callee.property, "Identifier") &&
      NON_DETERMINISTIC_MEMBER_CALLS.has(`${callee.object.name}.${callee.property.name}`)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};
