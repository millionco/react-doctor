import { posix } from "node:path";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface PrimitiveValue {
  readonly kind: "primitive";
  readonly value: string | number | boolean | null | undefined;
}

interface RecordValue {
  readonly kind: "record";
  readonly properties: ReadonlyMap<string, StartupValue>;
}

interface ArrayValue {
  readonly kind: "array";
  readonly items: readonly StartupValue[];
}

interface NamedOperation {
  readonly kind: "intrinsic" | "builtin" | "operation";
  readonly name: string;
}

interface OpaqueStartupValue {
  readonly kind: "deferred" | "moduleUrl" | "fileUrl" | "pathString";
}

type StartupValue = PrimitiveValue | RecordValue | ArrayValue | NamedOperation | OpaqueStartupValue;
type BindingTable = Map<string, StartupValue | null>;
type ExportTable = Map<string, StartupValue>;
type ImportOrExport = EsTreeNodeOfType<
  "ImportDeclaration" | "ExportAllDeclaration" | "ExportNamedDeclaration"
>;

interface DataModuleStartupInput {
  readonly entries: readonly string[];
  readonly sourceByPath: ReadonlyMap<string, string>;
}

const DEFERRED_VALUE: OpaqueStartupValue = { kind: "deferred" };
const KNOWN_GLOBALS = new Set(["Object", "Error", "URL"]);
const BUILTIN_MODULES = new Set(["fs", "path", "url", "crypto"]);
const makePrimitive = (value: PrimitiveValue["value"]): PrimitiveValue => ({
  kind: "primitive",
  value,
});

const makeBuiltinExports = (request: string): ExportTable | null => {
  const builtin = request.replace(/^node:/u, "");
  if (!BUILTIN_MODULES.has(builtin)) return null;
  const selected: ExportTable = new Map([["default", { kind: "builtin", name: builtin }]]);
  if (builtin === "url")
    selected.set("fileURLToPath", { kind: "operation", name: "url.fileURLToPath" });
  if (builtin === "crypto")
    selected.set("createHash", { kind: "operation", name: "crypto.createHash" });
  return selected;
};

const readName = (node: EsTreeNode): string | null =>
  isNodeOfType(node, "Identifier")
    ? node.name
    : isNodeOfType(node, "Literal") && typeof node.value === "string"
      ? node.value
      : null;

const readBinding = (bindings: BindingTable, name: string): StartupValue | null => {
  if (bindings.has(name)) return bindings.get(name) ?? null;
  if (name === "undefined") return makePrimitive(undefined);
  return KNOWN_GLOBALS.has(name) ? { kind: "intrinsic", name } : null;
};

const readOwnProperty = (object: StartupValue | null, key: string): StartupValue | null => {
  if (object?.kind === "record") return object.properties.get(key) ?? null;
  if (
    object?.kind === "intrinsic" &&
    object.name === "Object" &&
    (key === "freeze" || key === "values")
  ) {
    return { kind: "operation", name: "Object." + key };
  }
  if (
    object?.kind === "builtin" &&
    object.name === "path" &&
    (key === "resolve" || key === "join")
  ) {
    return { kind: "operation", name: "path." + key };
  }
  return null;
};

const selectOperation = (
  callee: StartupValue | null,
  args: readonly StartupValue[],
): StartupValue | null => {
  if (callee?.kind !== "operation") return null;
  const value = args[0];
  switch (callee.name) {
    case "Object.freeze":
      return args.length === 1 && (value?.kind === "array" || value?.kind === "record")
        ? value
        : null;
    case "Object.values":
      if (args.length !== 1) return null;
      if (value?.kind === "array") return value;
      return value?.kind === "record"
        ? { kind: "array", items: [...value.properties.values()] }
        : null;
    case "url.fileURLToPath":
      return args.length === 1 && value?.kind === "fileUrl" ? { kind: "pathString" } : null;
    case "path.resolve":
    case "path.join":
      return args.every(
        (arg) =>
          arg.kind === "pathString" || (arg.kind === "primitive" && typeof arg.value === "string"),
      )
        ? { kind: "pathString" }
        : null;
    default:
      return null;
  }
};

const selectArgumentValues = (
  nodes: readonly (EsTreeNode | null)[],
  bindings: BindingTable,
): StartupValue[] | null => {
  const values: StartupValue[] = [];
  for (const node of nodes) {
    const value = evaluateInitializer(node, bindings);
    if (!value) return null;
    values.push(value);
  }
  return values;
};

const selectComputedKey = (node: EsTreeNode, bindings: BindingTable): string | null => {
  const value = evaluateInitializer(node, bindings);
  return value?.kind === "primitive" && typeof value.value === "string" ? value.value : null;
};

const evaluateInitializer = (
  expression: EsTreeNode | null | undefined,
  bindings: BindingTable,
): StartupValue | null => {
  if (!expression) return null;
  const node = stripParenExpression(expression);
  switch (node.type) {
    case "Literal":
      return node.value === null ||
        typeof node.value === "string" ||
        typeof node.value === "boolean" ||
        (typeof node.value === "number" && Number.isFinite(node.value))
        ? makePrimitive(node.value)
        : null;
    case "Identifier":
      return readBinding(bindings, node.name);
    case "TemplateLiteral": {
      const values = selectArgumentValues(node.expressions, bindings);
      const quasis = node.quasis.map((quasi) => quasi.value.cooked);
      if (
        !values ||
        quasis.some((value) => value === null) ||
        node.quasis.length !== values.length + 1
      )
        return null;
      let result = quasis[0] ?? "";
      for (const [index, value] of values.entries()) {
        if (value.kind !== "primitive") return null;
        result += String(value.value) + quasis[index + 1];
      }
      return makePrimitive(result);
    }
    case "ArrayExpression": {
      const items = selectArgumentValues(node.elements, bindings);
      return items ? { kind: "array", items } : null;
    }
    case "ObjectExpression": {
      const properties = new Map<string, StartupValue>();
      for (const property of node.properties) {
        if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
          return null;
        const key = property.computed
          ? selectComputedKey(property.key, bindings)
          : getStaticPropertyKeyName(property);
        const value = evaluateInitializer(property.value, bindings);
        if (key === null || key === "__proto__" || properties.has(key) || !value) return null;
        properties.set(key, value);
      }
      return { kind: "record", properties };
    }
    case "MemberExpression": {
      if (node.optional) return null;
      const key = node.computed
        ? selectComputedKey(node.property, bindings)
        : readName(node.property);
      if (key === null) return null;
      if (
        !node.computed &&
        key === "url" &&
        isNodeOfType(node.object, "MetaProperty") &&
        node.object.meta.name === "import" &&
        node.object.property.name === "meta"
      ) {
        return { kind: "moduleUrl" };
      }
      return readOwnProperty(evaluateInitializer(node.object, bindings), key);
    }
    case "NewExpression": {
      const callee = evaluateInitializer(node.callee, bindings);
      const args = selectArgumentValues(node.arguments, bindings);
      const relative = args?.[0];
      return callee?.kind === "intrinsic" &&
        callee.name === "URL" &&
        args?.length === 2 &&
        relative?.kind === "primitive" &&
        typeof relative.value === "string" &&
        /^\.{1,2}\/[A-Za-z0-9_./-]*$/u.test(relative.value) &&
        args[1]?.kind === "moduleUrl"
        ? { kind: "fileUrl" }
        : null;
    }
    case "CallExpression": {
      if (node.optional) return null;
      const args = selectArgumentValues(node.arguments, bindings);
      return args ? selectOperation(evaluateInitializer(node.callee, bindings), args) : null;
    }
    default:
      return null;
  }
};

const isReadOnlyErrorClass = (
  node: EsTreeNodeOfType<"ClassDeclaration">,
  bindings: BindingTable,
): boolean => {
  const parent = evaluateInitializer(node.superClass, bindings);
  return (
    node.decorators.length === 0 &&
    parent?.kind === "intrinsic" &&
    parent.name === "Error" &&
    node.body.body.every(
      (member) =>
        (isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition")) &&
        !member.computed &&
        !member.static &&
        member.decorators.length === 0,
    )
  );
};

const getDeclaredNode = (statement: EsTreeNode): EsTreeNode | null =>
  isNodeOfType(statement, "ExportNamedDeclaration") ? statement.declaration : statement;

const declareBinding = (
  node: EsTreeNode | null,
  value: StartupValue | null,
  bindings: BindingTable,
): boolean => {
  if (!isNodeOfType(node, "Identifier") || bindings.has(node.name)) return false;
  bindings.set(node.name, value);
  return true;
};

const declareModuleBindings = (body: readonly EsTreeNode[], bindings: BindingTable): boolean => {
  for (const statement of body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      if (
        statement.importKind === "type" ||
        statement.attributes.length > 0 ||
        !statement.specifiers.every(
          (specifier) =>
            !isNodeOfType(specifier, "ImportNamespaceSpecifier") &&
            declareBinding(specifier.local, null, bindings),
        )
      )
        return false;
      continue;
    }
    const node = getDeclaredNode(statement);
    if (isNodeOfType(node, "VariableDeclaration")) {
      if (!node.declarations.every((declaration) => declareBinding(declaration.id, null, bindings)))
        return false;
    } else if (
      isNodeOfType(node, "FunctionDeclaration") ||
      isNodeOfType(node, "ClassDeclaration")
    ) {
      if (
        !declareBinding(
          node.id,
          isNodeOfType(node, "FunctionDeclaration") ? DEFERRED_VALUE : null,
          bindings,
        )
      ) {
        return false;
      }
    }
  }
  return true;
};

const bindImports = (
  statement: EsTreeNodeOfType<"ImportDeclaration">,
  exports: ExportTable,
  bindings: BindingTable,
): boolean =>
  statement.specifiers.every((specifier) => {
    const name = isNodeOfType(specifier, "ImportDefaultSpecifier")
      ? "default"
      : isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind !== "type"
        ? readName(specifier.imported)
        : null;
    const value = name === null ? null : exports.get(name);
    if (!value) return false;
    bindings.set(specifier.local.name, value);
    return true;
  });

const addExport = (exports: ExportTable, name: string, value: StartupValue): boolean => {
  if (exports.has(name)) return false;
  exports.set(name, value);
  return true;
};

const initializeModule = (
  body: readonly EsTreeNode[],
  bindings: BindingTable,
  dependencies: ReadonlyMap<ImportOrExport, ExportTable>,
): ExportTable | null => {
  const exports: ExportTable = new Map();
  for (const statement of body) {
    if (isNodeOfType(statement, "ImportDeclaration")) continue;
    if (isNodeOfType(statement, "ExportAllDeclaration")) {
      const selected = dependencies.get(statement);
      if (
        !selected ||
        statement.exported ||
        statement.exportKind === "type" ||
        ![...selected].every(
          ([name, value]) => name === "default" || addExport(exports, name, value),
        )
      ) {
        return null;
      }
      continue;
    }
    const exported = isNodeOfType(statement, "ExportNamedDeclaration");
    const node = getDeclaredNode(statement);
    if (exported && !node) {
      const foreign = statement.source ? dependencies.get(statement) : null;
      if (
        (statement.source && !foreign) ||
        statement.exportKind === "type" ||
        !statement.specifiers.every((specifier) => {
          const local = readName(specifier.local);
          const publicName = readName(specifier.exported);
          const value =
            local === null ? null : foreign ? foreign.get(local) : readBinding(bindings, local);
          return (
            specifier.exportKind !== "type" &&
            publicName !== null &&
            Boolean(value && addExport(exports, publicName, value))
          );
        })
      )
        return null;
      continue;
    }
    if (isNodeOfType(node, "VariableDeclaration")) {
      for (const declaration of node.declarations) {
        const value = evaluateInitializer(declaration.init, bindings);
        if (!isNodeOfType(declaration.id, "Identifier") || !value) return null;
        bindings.set(declaration.id.name, value);
        if (exported && !addExport(exports, declaration.id.name, value)) return null;
      }
      continue;
    }
    if (isNodeOfType(node, "FunctionDeclaration") || isNodeOfType(node, "ClassDeclaration")) {
      if (
        !node.id ||
        (isNodeOfType(node, "ClassDeclaration") && !isReadOnlyErrorClass(node, bindings))
      )
        return null;
      bindings.set(node.id.name, DEFERRED_VALUE);
      if (exported && !addExport(exports, node.id.name, DEFERRED_VALUE)) return null;
      continue;
    }
    return null;
  }
  return exports;
};

export const hasBoundedDataModuleStartup = ({
  entries,
  sourceByPath,
}: DataModuleStartupInput): boolean => {
  const active = new Set<string>();
  const completed = new Map<string, ExportTable>();
  const readModule = (filename: string): ExportTable | null => {
    const cached = completed.get(filename);
    if (cached) return cached;
    if (active.has(filename)) return null;
    const sourceText = sourceByPath.get(filename);
    if (sourceText === undefined) return null;
    const program = parseSourceText({
      filename,
      sourceText,
      shouldAttachParentReferences: false,
      language: "js",
    });
    if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return null;
    const bindings: BindingTable = new Map();
    if (!declareModuleBindings(program.body, bindings)) return null;
    active.add(filename);
    const dependencies = new Map<ImportOrExport, ExportTable>();
    for (const statement of program.body) {
      if (
        (!isNodeOfType(statement, "ImportDeclaration") &&
          !isNodeOfType(statement, "ExportAllDeclaration") &&
          !isNodeOfType(statement, "ExportNamedDeclaration")) ||
        !statement.source
      )
        continue;
      if (statement.attributes.length > 0 || typeof statement.source.value !== "string")
        return null;
      const request = statement.source.value;
      const module =
        request.startsWith("./") || request.startsWith("../")
          ? readModule(posix.join(posix.dirname(filename), request))
          : makeBuiltinExports(request);
      if (
        !module ||
        (isNodeOfType(statement, "ImportDeclaration") && !bindImports(statement, module, bindings))
      )
        return null;
      dependencies.set(statement, module);
    }
    const exports = initializeModule(program.body, bindings, dependencies);
    active.delete(filename);
    if (exports) completed.set(filename, exports);
    return exports;
  };
  return entries.length > 0 && entries.every((entry) => Boolean(readModule(entry)));
};
