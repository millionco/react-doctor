import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType as is } from "./is-node-of-type.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { walkAst } from "./walk-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";
const namespaces = new Set(["Array", "Object", "Reflect", "Function"]);
const globalObjects = new Set(["window", "self", "globalThis", "global"]);
const scalarMath = new Set([
  "round",
  "random",
  "floor",
  "ceil",
  "abs",
  "min",
  "max",
  "trunc",
  "sign",
]);
const cache = new WeakMap<ScopeAnalysis, boolean>();
/** Local AST slice only. It proves no unknown local use of the native carriers
 * it recognizes, not an initial stock realm or external module behavior. */
export function hasUnsafeArrayIterationIntrinsics(
  program: EsTreeNode,
  scopes: ScopeAnalysis = analyzeScopes(program),
): boolean {
  if (scopes.rootScope.node !== program) return true;
  const prior = cache.get(scopes);
  if (prior !== undefined) return prior;
  function nativePath(node: EsTreeNode, seen = new Set<number>()): string[] | null {
    node = stripParenExpression(node);
    if (is(node, "MemberExpression")) {
      if (node.optional) return null;
      const base = nativePath(node.object, seen),
        key = getResolvedStaticPropertyName(node, scopes);
      if (!base || key === null) return null;
      return base[0] === "$global" && namespaces.has(key) ? [key] : [...base, key];
    }
    if (!is(node, "Identifier")) return null;
    if (scopes.isGlobalReference(node)) {
      if (namespaces.has(node.name)) return [node.name];
      if (globalObjects.has(node.name)) return ["$global"];
      return null;
    }
    const symbol = scopes.symbolFor(node),
      decl = symbol?.declarationNode;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      seen.has(symbol.id) ||
      !is(decl, "VariableDeclarator") ||
      !decl.init
    )
      return null;
    seen.add(symbol.id);
    const base = nativePath(decl.init, seen);
    if (!base) return null;
    if (is(decl.id, "Identifier")) return base;
    const key = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
    return key === null
      ? null
      : base[0] === "$global" && namespaces.has(key)
        ? [key]
        : [...base, key];
  }
  function plainRecord(node: EsTreeNode): boolean {
    return (
      is(node, "ObjectExpression") &&
      node.properties.every(
        (property) =>
          is(property, "Property") &&
          property.kind === "init" &&
          !property.computed &&
          !property.method &&
          ((is(property.key, "Identifier") && property.key.name !== "__proto__") ||
            (is(property.key, "Literal") &&
              typeof property.key.value === "string" &&
              property.key.value !== "__proto__")),
      )
    );
  }
  function scalarRecordSource(node: EsTreeNode): boolean {
    if (is(node, "ConditionalExpression"))
      return scalarRecordSource(node.consequent) && scalarRecordSource(node.alternate);
    return (
      plainRecord(node) &&
      is(node, "ObjectExpression") &&
      node.properties.every(
        (property) =>
          is(property, "Property") &&
          is(property.value, "Literal") &&
          ["string", "number", "boolean"].includes(typeof property.value.value),
      )
    );
  }
  function privateRecordAssign(node: EsTreeNode): boolean {
    if (
      !is(node, "CallExpression") ||
      node.optional ||
      node.arguments.length !== 2 ||
      !is(node.arguments[0], "Identifier") ||
      !scalarRecordSource(node.arguments[1]!)
    )
      return false;
    const symbol = scopes.symbolFor(node.arguments[0]),
      declaration = symbol?.declarationNode;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !is(declaration, "VariableDeclarator") ||
      !declaration.init ||
      !plainRecord(declaration.init) ||
      !hasCompleteSymbolReferences(symbol, program, scopes)
    )
      return false;
    const before = node.range?.[0];
    if (before === undefined) return false;
    return symbol.references.every((reference) => {
      if (reference.flag !== "read") return false;
      if (reference.identifier === node.arguments[0]) return true;
      const offset = reference.identifier.range?.[0];
      return offset !== undefined && offset > before;
    });
  }
  function readonlyCall(node: EsTreeNode): boolean {
    if (!is(node, "CallExpression") || node.optional) return false;
    const route = nativePath(node.callee);
    if (!route || route.length !== 2) return false;
    if (route[0] === "Object" && route[1] === "assign" && privateRecordAssign(node)) return true;
    const [input] = node.arguments;
    if (
      route[0] === "Array" &&
      route[1] === "from" &&
      node.arguments.length === 1 &&
      is(input, "ObjectExpression") &&
      input.properties.length === 1
    ) {
      const field = input.properties[0];
      if (
        is(field, "Property") &&
        !field.computed &&
        field.kind === "init" &&
        is(field.key, "Identifier") &&
        field.key.name === "length" &&
        is(field.value, "Literal") &&
        typeof field.value.value === "number" &&
        Number.isSafeInteger(field.value.value) &&
        field.value.value >= 0 &&
        field.value.value <= 64
      )
        return true;
    }
    return (
      (route[0] === "Math" && scalarMath.has(route[1]!)) ||
      (route[0] === "Array" && route[1] === "isArray") ||
      (route[0] === "Object" && ["keys", "values", "entries"].includes(route[1]!))
    );
  }
  let unsafe = false;
  walkAst(program, (node) => {
    if (unsafe) return false;
    if (
      is(node, "ObjectPattern") &&
      node.properties.some((property) => {
        if (!is(property, "Property")) return false;
        const key =
          is(property.key, "Identifier") && !property.computed
            ? property.key.name
            : is(property.key, "Literal") && typeof property.key.value === "string"
              ? property.key.value
              : null;
        return key === "constructor" || key === "__proto__" || (property.computed && key === null);
      })
    ) {
      unsafe = true;
      return false;
    }
    if (!is(node, "Identifier") && !is(node, "MemberExpression")) return;
    if (is(node, "Identifier") && !scopes.referenceFor(node)) return;
    if (
      is(node, "MemberExpression") &&
      ["constructor", "__proto__"].includes(getResolvedStaticPropertyName(node, scopes) ?? "")
    ) {
      unsafe = true;
      return false;
    }
    if (
      is(node, "MemberExpression") &&
      nativePath(node.object) &&
      getResolvedStaticPropertyName(node, scopes) === null
    ) {
      unsafe = true;
      return false;
    }
    const route = nativePath(node);
    if (!route || route[0] === "$global") return;
    const value = findTransparentExpressionRoot(node),
      parent = value.parent;
    if (is(parent, "MemberExpression") && parent.object === value) return;
    if (isWithinAssignmentTarget(value)) {
      unsafe = true;
      return false;
    }
    if (
      is(parent, "UpdateExpression") ||
      (is(parent, "UnaryExpression") && parent.operator === "delete")
    ) {
      unsafe = true;
      return false;
    }
    if (
      is(parent, "VariableDeclarator") &&
      parent.init === value &&
      is(parent.parent, "VariableDeclaration") &&
      parent.parent.kind === "const"
    ) {
      if (is(parent.id, "Identifier")) {
        const s = scopes.symbolFor(parent.id);
        unsafe = !s || s.references.some((ref) => ref.flag !== "read");
        return;
      }
      if (is(parent.id, "ObjectPattern")) {
        for (const p of parent.id.properties) {
          if (!is(p, "Property") || p.computed || !is(p.value, "Identifier")) {
            unsafe = true;
            break;
          }
          const s = scopes.symbolFor(p.value);
          if (!s || s.references.some((ref) => ref.flag !== "read")) unsafe = true;
        }
        return;
      }
    }
    if (is(parent, "CallExpression")) {
      if (parent.callee === value && readonlyCall(parent)) return;
      if (
        parent.arguments.some((argument) => argument === value) &&
        readonlyCall(parent) &&
        nativePath(parent.callee)?.[0] === "Object"
      )
        return;
      unsafe = true;
      return false;
    }
    if (is(parent, "UnaryExpression") && ["typeof", "void", "!"].includes(parent.operator)) return;
    if (is(parent, "BinaryExpression") && ["===", "!==", "==", "!="].includes(parent.operator))
      return;
    if (is(parent, "ExpressionStatement")) return;
    unsafe = true;
    return false;
  });
  cache.set(scopes, unsafe);
  return unsafe;
}
