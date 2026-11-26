import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
export interface StaticDataModule {
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly resolvedImports: ReadonlyMap<string, StaticDataModule>;
}
type Primitive = string | number | boolean | null | undefined;
export type OwnedStaticData =
  | Primitive
  | { readonly kind: "record"; readonly fields: ReadonlyMap<string, OwnedStaticData> }
  | { readonly kind: "array"; readonly items: readonly OwnedStaticData[] };
interface FunctionValue {
  kind: "function";
  node: EsTreeNode;
  module: StaticDataModule;
  env: Map<number, Value>;
}
type Value = OwnedStaticData | FunctionValue;
const UNKNOWN = Symbol("unsupported");
type Result = Value | typeof UNKNOWN;
interface Frame {
  module: StaticDataModule;
  env: Map<number, Value>;
  owned: Set<number>;
  depth: number;
}
interface Completion {
  value: Result;
  returned: boolean;
}
const primitive = (v: Result): v is Primitive =>
  v !== UNKNOWN && (v === null || typeof v !== "object");
const record = (v: Result): v is Extract<OwnedStaticData, { kind: "record" }> =>
  v !== UNKNOWN && typeof v === "object" && v !== null && v.kind === "record";
const array = (v: Result): v is Extract<OwnedStaticData, { kind: "array" }> =>
  v !== UNKNOWN && typeof v === "object" && v !== null && v.kind === "array";
/** Pure AST interpreter for a deliberately finite data grammar, not JS execution.
 * Caller establishes a stock Node compiler realm with document absent and stock
 * Object.freeze/String/parseInt intrinsics. No calls to source code are executed.
 */
export function readOwnedStaticDataModules(
  roots: readonly StaticDataModule[],
): ReadonlyMap<StaticDataModule, ReadonlyMap<string, OwnedStaticData>> | null {
  let budget = 12000;
  const completed = new Map<StaticDataModule, Map<string, Value>>(),
    active = new Set<StaticDataModule>();
  const global = (n: EsTreeNode, name: string, f: Frame): boolean =>
    isNodeOfType(n, "Identifier") && n.name === name && f.module.scopes.isGlobalReference(n);
  const lookup = (n: EsTreeNode, f: Frame): Result => {
    const symbol = f.module.scopes.symbolFor(n);
    return symbol && f.env.has(symbol.id)
      ? f.env.get(symbol.id)!
      : global(n, "undefined", f)
        ? undefined
        : UNKNOWN;
  };
  const bind = (n: EsTreeNode, value: Result, f: Frame): boolean => {
    if (value === UNKNOWN) return false;
    if (isNodeOfType(n, "Identifier")) {
      const symbol = f.module.scopes.symbolFor(n);
      if (!symbol) return false;
      f.env.set(symbol.id, value);
      f.owned.add(symbol.id);
      return true;
    }
    if (isNodeOfType(n, "ArrayPattern") && array(value) && n.elements.length === value.items.length)
      return n.elements.every((p, i) => !!p && bind(p, value.items[i], f));
    return false;
  };
  const invoke = (v: Result, args: Result[], caller: Frame): Result => {
    if (
      v === UNKNOWN ||
      !v ||
      typeof v !== "object" ||
      v.kind !== "function" ||
      args.includes(UNKNOWN) ||
      caller.depth >= 24
    )
      return UNKNOWN;
    const n = v.node;
    if (
      !(
        isNodeOfType(n, "FunctionDeclaration") ||
        isNodeOfType(n, "FunctionExpression") ||
        isNodeOfType(n, "ArrowFunctionExpression")
      ) ||
      n.async ||
      n.generator ||
      n.params.length !== args.length
    )
      return UNKNOWN;
    const f: Frame = {
      module: v.module,
      env: new Map(v.env),
      owned: new Set(),
      depth: caller.depth + 1,
    };
    if (!n.params.every((p, i) => bind(p, args[i], f))) return UNKNOWN;
    return isNodeOfType(n.body, "BlockStatement")
      ? statements(n.body.body, f).value
      : expression(n.body, f);
  };
  const expression = (n: EsTreeNode | undefined | null, f: Frame): Result => {
    if (!n || --budget < 0) return UNKNOWN;
    if (isNodeOfType(n, "Literal"))
      return n.value === null || ["string", "number", "boolean"].includes(typeof n.value)
        ? (n.value as Primitive)
        : UNKNOWN;
    if (isNodeOfType(n, "Identifier")) return lookup(n, f);
    const unwrapped = stripParenExpression(n);
    if (unwrapped !== n) return expression(unwrapped, f);
    if (isNodeOfType(n, "ObjectExpression")) {
      const fields = new Map<string, OwnedStaticData>();
      for (const p of n.properties) {
        if (!isNodeOfType(p, "Property") || p.method || p.kind !== "init") return UNKNOWN;
        const key = p.computed ? expression(p.key, f) : getStaticPropertyKeyName(p);
        if (typeof key !== "string" || key === "__proto__" || fields.has(key)) return UNKNOWN;
        const v = expression(p.value, f);
        if (v === UNKNOWN || (v && typeof v === "object" && v.kind === "function")) return UNKNOWN;
        fields.set(key, v);
      }
      return { kind: "record", fields };
    }
    if (isNodeOfType(n, "ArrayExpression")) {
      const items: OwnedStaticData[] = [];
      for (const item of n.elements) {
        if (!item) return UNKNOWN;
        const v = expression(item, f);
        if (v === UNKNOWN || (v && typeof v === "object" && v.kind === "function")) return UNKNOWN;
        items.push(v);
      }
      return { kind: "array", items };
    }
    if (isNodeOfType(n, "MemberExpression") && !n.optional) {
      const object = expression(n.object, f),
        key = n.computed
          ? expression(n.property, f)
          : isNodeOfType(n.property, "Identifier")
            ? n.property.name
            : UNKNOWN;
      if (typeof key !== "string" && typeof key !== "number") return UNKNOWN;
      if (record(object))
        return object.fields.has(String(key)) ? object.fields.get(String(key))! : UNKNOWN;
      if ((typeof object === "string" || array(object)) && key === "length")
        return typeof object === "string" ? object.length : object.items.length;
      return UNKNOWN;
    }
    if (isNodeOfType(n, "ConditionalExpression")) {
      const test = expression(n.test, f);
      return test === UNKNOWN ? UNKNOWN : expression(test ? n.consequent : n.alternate, f);
    }
    if (isNodeOfType(n, "LogicalExpression")) {
      const left = expression(n.left, f);
      if (left === UNKNOWN) return UNKNOWN;
      if (n.operator === "||") return left ? left : expression(n.right, f);
      if (n.operator === "&&") return left ? expression(n.right, f) : left;
      return UNKNOWN;
    }
    if (isNodeOfType(n, "UnaryExpression")) {
      if (n.operator === "typeof" && global(n.argument, "document", f)) return "undefined";
      const v = expression(n.argument, f);
      if (!primitive(v)) return UNKNOWN;
      if (n.operator === "!") return !v;
      if (n.operator === "typeof") return typeof v;
      if (n.operator === "-" && typeof v === "number") return -v;
      return UNKNOWN;
    }
    if (isNodeOfType(n, "BinaryExpression")) {
      const a = expression(n.left, f),
        b = expression(n.right, f);
      if (!primitive(a) || !primitive(b)) return UNKNOWN;
      switch (n.operator) {
        case "===":
          return a === b;
        case "!==":
          return a !== b;
        case "+":
          return (typeof a === "string" || typeof a === "number") &&
            (typeof b === "string" || typeof b === "number")
            ? typeof a === "string" || typeof b === "string"
              ? String(a) + String(b)
              : a + b
            : UNKNOWN;
        case ">>":
          return typeof a === "number" && typeof b === "number" ? a >> b : UNKNOWN;
        case "&":
          return typeof a === "number" && typeof b === "number" ? a & b : UNKNOWN;
        default:
          return UNKNOWN;
      }
    }
    if (isNodeOfType(n, "TemplateLiteral")) {
      let out = "";
      for (let i = 0; i < n.quasis.length; i++) {
        out += n.quasis[i].value.cooked ?? "";
        if (i < n.expressions.length) {
          const v = expression(n.expressions[i], f);
          if (!primitive(v) || typeof v === "undefined") return UNKNOWN;
          out += String(v);
        }
      }
      return out;
    }
    if (isNodeOfType(n, "ArrowFunctionExpression") || isNodeOfType(n, "FunctionExpression"))
      return { kind: "function", node: n, module: f.module, env: f.env };
    if (isNodeOfType(n, "CallExpression") && !n.optional) {
      const args = n.arguments.map((a) => expression(a, f));
      if (args.includes(UNKNOWN)) return UNKNOWN;
      if (
        isNodeOfType(n.callee, "MemberExpression") &&
        !n.callee.computed &&
        !n.callee.optional &&
        isNodeOfType(n.callee.property, "Identifier")
      ) {
        const key = n.callee.property.name;
        if (
          global(n.callee.object, "Object", f) &&
          key === "freeze" &&
          args.length === 1 &&
          (record(args[0]) || array(args[0]))
        )
          return args[0];
        const receiver = expression(n.callee.object, f);
        if (
          typeof receiver === "string" &&
          key === "replace" &&
          args.length === 2 &&
          typeof args[0] === "string" &&
          typeof args[1] === "string"
        )
          return receiver.replace(args[0], args[1]);
        return UNKNOWN;
      }
      if (
        global(n.callee, "parseInt", f) &&
        args.length === 2 &&
        typeof args[0] === "string" &&
        /^[a-f0-9]{6}$/iu.test(args[0]) &&
        args[1] === 16
      )
        return parseInt(args[0], 16);
      return invoke(expression(n.callee, f), args, f);
    }
    return UNKNOWN;
  };
  const statements = (body: readonly EsTreeNode[], f: Frame): Completion => {
    for (const n of body) {
      if (--budget < 0) return { value: UNKNOWN, returned: true };
      if (isNodeOfType(n, "VariableDeclaration")) {
        for (const d of n.declarations)
          if (!bind(d.id, d.init ? expression(d.init, f) : undefined, f))
            return { value: UNKNOWN, returned: true };
        continue;
      }
      if (isNodeOfType(n, "ReturnStatement"))
        return { value: n.argument ? expression(n.argument, f) : undefined, returned: true };
      if (isNodeOfType(n, "IfStatement")) {
        const test = expression(n.test, f);
        if (test === UNKNOWN) return { value: UNKNOWN, returned: true };
        const selected = test ? n.consequent : n.alternate;
        if (selected) {
          const result = statements(
            isNodeOfType(selected, "BlockStatement") ? selected.body : [selected],
            f,
          );
          if (result.returned) return result;
        }
        continue;
      }
      if (
        isNodeOfType(n, "ExpressionStatement") &&
        isNodeOfType(n.expression, "AssignmentExpression") &&
        n.expression.operator === "=" &&
        isNodeOfType(n.expression.left, "Identifier")
      ) {
        const symbol = f.module.scopes.symbolFor(n.expression.left),
          v = expression(n.expression.right, f);
        if (!symbol || !f.owned.has(symbol.id) || v === UNKNOWN)
          return { value: UNKNOWN, returned: true };
        f.env.set(symbol.id, v);
        continue;
      }
      return { value: UNKNOWN, returned: true };
    }
    return { value: undefined, returned: false };
  };
  const evaluate = (module: StaticDataModule): Map<string, Value> | null => {
    if (completed.has(module)) return completed.get(module)!;
    if (active.has(module) || active.size > 8 || !isNodeOfType(module.program, "Program"))
      return null;
    const names = new Set<string>();
    for (const item of module.program.body) {
      const node = isNodeOfType(item, "ExportNamedDeclaration") ? item.declaration : item;
      if (isNodeOfType(node, "FunctionDeclaration")) {
        if (!node.id || names.has(node.id.name)) return null;
        names.add(node.id.name);
      }
    }
    active.add(module);
    const env = new Map<number, Value>(),
      f: Frame = { module, env, owned: new Set(), depth: 0 },
      exports = new Map<string, Value>();
    for (const symbol of module.scopes.rootScope.symbols.values())
      if (isNodeOfType(symbol.declarationNode, "FunctionDeclaration"))
        env.set(symbol.id, { kind: "function", node: symbol.declarationNode, module, env });
    for (const statement of module.program.body) {
      let n: EsTreeNode = statement;
      if (isNodeOfType(n, "ImportDeclaration")) {
        const dependency =
          typeof n.source.value === "string"
            ? module.resolvedImports.get(n.source.value)
            : undefined;
        if (!dependency) return null;
        const data = evaluate(dependency);
        if (!data) return null;
        for (const s of n.specifiers) {
          if (
            !isNodeOfType(s, "ImportSpecifier") ||
            !isNodeOfType(s.imported, "Identifier") ||
            !data.has(s.imported.name) ||
            !bind(s.local, data.get(s.imported.name)!, f)
          )
            return null;
        }
        continue;
      }
      let published = false;
      if (isNodeOfType(n, "ExportNamedDeclaration")) {
        if (!n.declaration || n.source) return null;
        published = true;
        n = n.declaration;
      }
      if (isNodeOfType(n, "FunctionDeclaration")) {
        if (published) {
          const symbol = [...module.scopes.rootScope.symbols.values()].find(
            (s) => s.declarationNode === n,
          );
          if (!symbol) return null;
          exports.set(symbol.name, env.get(symbol.id)!);
        }
        continue;
      }
      if (!isNodeOfType(n, "VariableDeclaration") || n.kind !== "const") return null;
      for (const d of n.declarations) {
        if (!isNodeOfType(d.id, "Identifier") || !d.init) return null;
        const v = expression(d.init, f);
        if (!bind(d.id, v, f)) return null;
        if (published) exports.set(d.id.name, v as Value);
      }
    }
    active.delete(module);
    completed.set(module, exports);
    return exports;
  };
  for (const root of roots) if (!evaluate(root)) return null;
  return new Map(
    [...completed].map(([module, exports]) => [
      module,
      new Map(
        [...exports].filter(
          (entry): entry is [string, OwnedStaticData] =>
            !(entry[1] && typeof entry[1] === "object" && entry[1].kind === "function"),
        ),
      ),
    ]),
  );
}
