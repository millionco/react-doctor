import { recordContentProbe } from "../cross-file-probe-recorder.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { isPropertyNamePosition } from "../is-property-name-position.js";
import { walkAst } from "../walk-ast.js";
import { getRootIdentifier } from "../get-root-identifier.js";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EsTreeNode } from "../es-tree-node.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { getStaticPropertyKeyName } from "../get-static-property-key-name.js";
import { parseSourceText } from "../parse-source-file.js";
import { hasClosedJsonSnapshotCommonjsScope } from "./has-closed-json-snapshot-commonjs-scope.js";
import {
  SNAPSHOT_CONFIG_MAX_BYTES,
  SNAPSHOT_CONFIG_MAX_DEPTH,
  SNAPSHOT_CONFIG_MAX_FILES,
  SNAPSHOT_CONFIG_MAX_NODES,
  SNAPSHOT_CONFIG_SUPPORTED_EXTENSIONS,
  SNAPSHOT_KNOWN_SDK_REQUEST_HEADS,
} from "./constants.js";
import type {
  ClosedJsonSnapshotSourceAlias,
  ClosedJsonSnapshotSourceResolutionInput,
  ClosedJsonSnapshotSourceResolutionPolicy,
  SnapshotConfigValue,
  SnapshotConfigDataBudget,
} from "./interfaces.js";

const unsupported = (): never => {
  throw new Error("Unsupported static webpack configuration");
};
const resolveValue = (value: SnapshotConfigValue | undefined): SnapshotConfigValue => {
  let resolved = value ?? unsupported();
  for (let depth = 0; resolved.kind === "deferred"; depth += 1) {
    if (depth > SNAPSHOT_CONFIG_MAX_DEPTH || !resolved.resolve) return unsupported();
    resolved = resolved.resolve();
  }
  return resolved;
};
const deferred = (read: () => SnapshotConfigValue): SnapshotConfigValue => {
  let value: SnapshotConfigValue | undefined;
  let isReading = false;
  return {
    kind: "deferred",
    resolve: () => {
      if (isReading) return unsupported();
      isReading = true;
      value ??= read();
      isReading = false;
      return value;
    },
  };
};
const scalar = (value: string | number | boolean | null): SnapshotConfigValue => ({
  kind: "scalar",
  scalar: value,
});
const readString = (unresolved: SnapshotConfigValue | undefined): string => {
  const value = resolveValue(unresolved);
  if ((value?.kind !== "scalar" && value?.kind !== "path") || typeof value.scalar !== "string")
    return unsupported();
  return value.scalar;
};
const readObject = (
  unresolved: SnapshotConfigValue | undefined,
): ReadonlyMap<string, SnapshotConfigValue> => {
  const value = resolveValue(unresolved);
  if (value?.kind !== "object" || !value.properties) return unsupported();
  return value.properties;
};
const readArray = (
  unresolved: SnapshotConfigValue | undefined,
): ReadonlyArray<SnapshotConfigValue> => {
  const value = resolveValue(unresolved);
  if (value?.kind !== "array" || !value.elements) return unsupported();
  return value.elements;
};
const mergeValues = (
  unresolvedLeft: SnapshotConfigValue,
  unresolvedRight: SnapshotConfigValue,
  budget: SnapshotConfigDataBudget,
): SnapshotConfigValue => {
  const left = resolveValue(unresolvedLeft);
  const right = resolveValue(unresolvedRight);
  budget.remaining -= 1;
  if (budget.remaining < 0) return unsupported();
  if (left.kind === "array" && right.kind === "array") {
    budget.remaining -= readArray(left).length + readArray(right).length;
    if (budget.remaining < 0) return unsupported();
    return { kind: "array", elements: [...readArray(left), ...readArray(right)] };
  }
  if (left.kind !== "object" || right.kind !== "object") return right;
  const properties = new Map(readObject(left));
  for (const [name, value] of readObject(right)) {
    const previous = properties.get(name);
    budget.remaining -= 1;
    if (budget.remaining < 0) return unsupported();
    properties.set(name, previous ? deferred(() => mergeValues(previous, value, budget)) : value);
  }
  return { kind: "object", properties };
};
export const getClosedJsonSnapshotSourceResolutionPolicy = ({
  rootDirectory,
  configFilePath,
}: ClosedJsonSnapshotSourceResolutionInput): ClosedJsonSnapshotSourceResolutionPolicy | null => {
  const root = path.resolve(rootDirectory);
  const modules = new Map<string, SnapshotConfigValue>();
  const activeModules = new Set<string>();
  const taintedModules = new Set<string>();
  const taintedExternalSources = new Set<string>();
  let nodeCount = 0;
  let totalBytes = 0;
  const dataBudget: SnapshotConfigDataBudget = { remaining: SNAPSHOT_CONFIG_MAX_NODES };
  const insideProject = (filename: string): boolean => {
    const relative = path.relative(root, filename);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const readText = (filename: string): string => {
    recordContentProbe(filename);
    if (!insideProject(filename)) return unsupported();
    const status = fs.lstatSync(filename);
    if (!status.isFile() || status.isSymbolicLink()) return unsupported();
    totalBytes += status.size;
    if (totalBytes > SNAPSHOT_CONFIG_MAX_BYTES) return unsupported();
    return fs.readFileSync(filename, "utf8");
  };
  const resolveConfigModule = (filename: string, source: string): string => {
    const requested = path.resolve(path.dirname(filename), source);
    const candidates = [requested, `${requested}.js`].filter((candidate) =>
      fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(),
    );
    if (candidates.length !== 1 || !insideProject(candidates[0])) return unsupported();
    return candidates[0];
  };
  const readModule = (filename: string, depth: number): SnapshotConfigValue => {
    if (taintedModules.has(filename)) return unsupported();
    if (depth > SNAPSHOT_CONFIG_MAX_DEPTH || activeModules.has(filename)) return unsupported();
    const cached = modules.get(filename);
    if (cached) return cached;
    if (!hasClosedJsonSnapshotCommonjsScope({ rootDirectory: root, filePath: filename }))
      return unsupported();
    if (modules.size + activeModules.size >= SNAPSHOT_CONFIG_MAX_FILES || !filename.endsWith(".js"))
      return unsupported();
    activeModules.add(filename);
    const program = parseSourceText({ filename, sourceText: readText(filename), language: "js" });
    if (!program || !isNodeOfType(program, "Program")) return unsupported();
    const scopes = analyzeScopes(program);
    const bindings = new Map<string, SnapshotConfigValue>();
    const declarations = new Map<string, EsTreeNode>();
    const rootDeclarationCounts = new Map<string, number>();
    const isDeclaredReference = (node: EsTreeNode): boolean => {
      if (!isNodeOfType(node, "Identifier") || rootDeclarationCounts.get(node.name) !== 1)
        return false;
      const declaration = declarations.get(node.name)?.parent;
      const symbol = scopes.symbolFor(node);
      return Boolean(
        symbol &&
        symbol === scopes.rootScope.symbolsByName.get(node.name) &&
        isNodeOfType(declaration, "VariableDeclarator") &&
        declaration.id === symbol.bindingIdentifier,
      );
    };
    const taintedBindings = new Set<string>();
    const taintRequiredModule = (source: string): void => {
      if (source.startsWith("./") || source.startsWith("../"))
        taintedModules.add(resolveConfigModule(filename, source));
      else taintedExternalSources.add(source === "node:path" ? "path" : source);
    };
    {
      for (const statement of program.body) {
        const identifiers: EsTreeNode[] = [];
        if (isNodeOfType(statement, "VariableDeclaration")) {
          for (const declaration of statement.declarations) {
            if (!isNodeOfType(declaration.id, "Identifier")) continue;
            identifiers.push(declaration.id);
            if (declaration.init) declarations.set(declaration.id.name, declaration.init);
          }
        } else if (
          (isNodeOfType(statement, "FunctionDeclaration") ||
            isNodeOfType(statement, "ClassDeclaration")) &&
          statement.id
        )
          identifiers.push(statement.id);
        for (const identifier of identifiers)
          if (isNodeOfType(identifier, "Identifier"))
            rootDeclarationCounts.set(
              identifier.name,
              (rootDeclarationCounts.get(identifier.name) ?? 0) + 1,
            );
      }
      const isReference = (node: EsTreeNode): boolean => {
        if (!isNodeOfType(node, "Identifier")) return false;
        if (
          isPropertyNamePosition(node) &&
          !(
            isNodeOfType(node.parent, "Property") &&
            node.parent.shorthand &&
            node.parent.value === node
          )
        )
          return false;
        const symbol = scopes.symbolFor(node);
        return declarations.has(node.name)
          ? isDeclaredReference(node)
          : ["module", "exports", "require", "__dirname"].includes(node.name) && !symbol;
      };
      const isPureScalarCall = (node: EsTreeNode): boolean => {
        if (
          !isNodeOfType(node, "CallExpression") ||
          !isNodeOfType(node.callee, "MemberExpression") ||
          node.callee.computed ||
          !isNodeOfType(node.callee.object, "Identifier") ||
          !isNodeOfType(node.callee.property, "Identifier")
        )
          return false;
        const receiver = node.callee.object;
        if (
          receiver.name === "JSON" &&
          scopes.isGlobalReference(receiver) &&
          node.callee.property.name === "stringify"
        )
          return node.arguments.length === 1 && isNodeOfType(node.arguments[0], "Literal");
        const initializer = declarations.get(receiver.name);
        return Boolean(
          isDeclaredReference(receiver) &&
          initializer &&
          isNodeOfType(initializer, "CallExpression") &&
          isNodeOfType(initializer.callee, "Identifier") &&
          initializer.callee.name === "require" &&
          scopes.isGlobalReference(initializer.callee) &&
          initializer.arguments.length === 1 &&
          isNodeOfType(initializer.arguments[0], "Literal") &&
          ["path", "node:path"].includes(String(initializer.arguments[0].value)) &&
          node.callee.property.name === "resolve" &&
          node.arguments.length === 2 &&
          isNodeOfType(node.arguments[0], "Identifier") &&
          node.arguments[0].name === "__dirname" &&
          scopes.isGlobalReference(node.arguments[0]) &&
          isNodeOfType(node.arguments[1], "Literal") &&
          typeof node.arguments[1].value === "string",
        );
      };
      const isKnownCall = (node: EsTreeNode): boolean => {
        if (!isNodeOfType(node, "CallExpression")) return false;
        if (isPureScalarCall(node)) return true;
        if (!isNodeOfType(node.callee, "Identifier")) return false;
        if (node.callee.name === "require" && scopes.isGlobalReference(node.callee)) return true;
        const initializer = declarations.get(node.callee.name);
        return Boolean(
          isDeclaredReference(node.callee) &&
          initializer &&
          isNodeOfType(initializer, "CallExpression") &&
          isNodeOfType(initializer.callee, "Identifier") &&
          initializer.callee.name === "require" &&
          scopes.isGlobalReference(initializer.callee) &&
          initializer.arguments.length === 1 &&
          isNodeOfType(initializer.arguments[0], "Literal") &&
          initializer.arguments[0].value === "webpack-merge",
        );
      };
      walkAst(program, (node) => {
        let target: EsTreeNode | null = null;
        if (isNodeOfType(node, "AssignmentExpression")) {
          const left = node.left;
          if (
            isNodeOfType(left, "MemberExpression") &&
            !left.computed &&
            isNodeOfType(left.object, "Identifier") &&
            left.object.name === "module" &&
            scopes.isGlobalReference(left.object) &&
            isNodeOfType(left.property, "Identifier") &&
            left.property.name === "exports" &&
            node.parent?.parent === program
          )
            return;
          target = left;
        } else if (
          isNodeOfType(node, "UpdateExpression") ||
          (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
        )
          target = node.argument;
        if (target) {
          const rootIdentifier = getRootIdentifier(target);
          if (rootIdentifier) taintedBindings.add(rootIdentifier.name);
        }
        if (
          (isNodeOfType(node, "CallExpression") || isNodeOfType(node, "NewExpression")) &&
          !isKnownCall(node)
        ) {
          for (const argument of node.arguments)
            walkAst(argument, (reference) => {
              if (isPureScalarCall(reference)) return false;
              if (
                isNodeOfType(reference, "CallExpression") &&
                isNodeOfType(reference.callee, "Identifier") &&
                reference.callee.name === "require" &&
                scopes.isGlobalReference(reference.callee) &&
                reference.arguments.length === 1 &&
                isNodeOfType(reference.arguments[0], "Literal") &&
                typeof reference.arguments[0].value === "string"
              ) {
                taintRequiredModule(reference.arguments[0].value);
                return false;
              }
              if (isReference(reference) && isNodeOfType(reference, "Identifier"))
                taintedBindings.add(reference.name);
            });
          if (isNodeOfType(node.callee, "MemberExpression")) {
            const receiver = getRootIdentifier(node.callee.object);
            if (receiver && isReference(receiver)) taintedBindings.add(receiver.name);
          }
        }
      });
      for (let depth = 0; depth < SNAPSHOT_CONFIG_MAX_DEPTH; depth += 1) {
        const previousSize = taintedBindings.size;
        for (const [name, initializer] of declarations) {
          if (!taintedBindings.has(name)) continue;
          if (
            isNodeOfType(initializer, "CallExpression") &&
            isNodeOfType(initializer.callee, "Identifier") &&
            initializer.callee.name === "require" &&
            scopes.isGlobalReference(initializer.callee) &&
            initializer.arguments.length === 1 &&
            isNodeOfType(initializer.arguments[0], "Literal") &&
            typeof initializer.arguments[0].value === "string"
          ) {
            taintRequiredModule(initializer.arguments[0].value);
            continue;
          }
          walkAst(initializer, (reference) => {
            if (isReference(reference) && isNodeOfType(reference, "Identifier"))
              taintedBindings.add(reference.name);
          });
        }
        if (previousSize === taintedBindings.size) break;
      }
      if (["module", "exports", "require", "__dirname"].some((name) => taintedBindings.has(name)))
        return unsupported();
    }
    const readBinding = (reference: EsTreeNode): SnapshotConfigValue | undefined => {
      if (!isNodeOfType(reference, "Identifier") || !isDeclaredReference(reference))
        return undefined;
      if (taintedBindings.has(reference.name)) return unsupported();
      const value = bindings.get(reference.name);
      return value ? resolveValue(value) : undefined;
    };
    let exported: SnapshotConfigValue | null = null;
    const evaluate = (node: EsTreeNode, expressionDepth = 0): SnapshotConfigValue => {
      if (taintedModules.has(filename)) return unsupported();
      nodeCount += 1;
      if (nodeCount > SNAPSHOT_CONFIG_MAX_NODES || expressionDepth > SNAPSHOT_CONFIG_MAX_DEPTH)
        return unsupported();
      if (isNodeOfType(node, "Literal")) {
        if (
          node.value === null ||
          typeof node.value === "string" ||
          typeof node.value === "number" ||
          typeof node.value === "boolean"
        )
          return scalar(node.value);
        return unsupported();
      }
      if (isNodeOfType(node, "Identifier")) {
        return readBinding(node) ?? unsupported();
      }
      if (isNodeOfType(node, "ArrayExpression"))
        return {
          kind: "array",
          elements: node.elements.map((element) =>
            element ? evaluate(element, expressionDepth + 1) : unsupported(),
          ),
        };
      if (isNodeOfType(node, "ObjectExpression")) {
        const properties = new Map<string, SnapshotConfigValue>();
        for (const property of node.properties) {
          if (
            !isNodeOfType(property, "Property") ||
            property.kind !== "init" ||
            property.method ||
            property.computed
          )
            return unsupported();
          const name = getStaticPropertyKeyName(property);
          if (
            !name ||
            ["__proto__", "constructor", "prototype"].includes(name) ||
            properties.has(name)
          )
            return unsupported();
          properties.set(
            name,
            deferred(() => evaluate(property.value, expressionDepth + 1)),
          );
        }
        return { kind: "object", properties };
      }
      if (isNodeOfType(node, "CallExpression")) {
        if (
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "require" &&
          scopes.isGlobalReference(node.callee) &&
          node.arguments.length === 1
        ) {
          const argument = node.arguments[0];
          if (!argument || !isNodeOfType(argument, "Literal") || typeof argument.value !== "string")
            return unsupported();
          const source = argument.value;
          if (taintedExternalSources.has(source === "node:path" ? "path" : source))
            return unsupported();
          if (["path", "node:path", "webpack-merge"].includes(source))
            return { kind: "binding", binding: source === "node:path" ? "path" : source };
          if (!source.startsWith("./") && !source.startsWith("../")) return unsupported();
          return readModule(resolveConfigModule(filename, source), depth + 1);
        }
        if (
          isNodeOfType(node.callee, "MemberExpression") &&
          !node.callee.computed &&
          isNodeOfType(node.callee.object, "Identifier") &&
          isNodeOfType(node.callee.property, "Identifier")
        ) {
          const namespace = readBinding(node.callee.object);
          if (
            namespace?.binding === "path" &&
            node.callee.property.name === "resolve" &&
            node.arguments.length === 2
          ) {
            const [directory, relative] = node.arguments;
            if (
              !directory ||
              !isNodeOfType(directory, "Identifier") ||
              directory.name !== "__dirname" ||
              !scopes.isGlobalReference(directory) ||
              !relative ||
              !isNodeOfType(relative, "Literal") ||
              typeof relative.value !== "string" ||
              path.isAbsolute(relative.value)
            )
              return unsupported();
            const resolved = path.resolve(path.dirname(filename), relative.value);
            if (!insideProject(resolved)) return unsupported();
            return { kind: "path", scalar: resolved };
          }
        }
        if (
          isNodeOfType(node.callee, "Identifier") &&
          readBinding(node.callee)?.binding === "webpack-merge" &&
          node.arguments.length >= 2 &&
          node.arguments.length <= SNAPSHOT_CONFIG_MAX_DEPTH
        ) {
          const values = node.arguments.map((argument) => evaluate(argument, expressionDepth + 1));
          if (values.some((value) => value.kind !== "object")) return unsupported();
          return values.reduce((left, right) => mergeValues(left, right, dataBudget));
        }
        return unsupported();
      }
      return unsupported();
    };
    for (const statement of program.body) {
      nodeCount += 1;
      if (nodeCount > SNAPSHOT_CONFIG_MAX_NODES) return unsupported();
      if (
        isNodeOfType(statement, "EmptyStatement") ||
        (isNodeOfType(statement, "ExpressionStatement") &&
          isNodeOfType(statement.expression, "Literal") &&
          statement.expression.value === "use strict")
      )
        continue;
      if (isNodeOfType(statement, "VariableDeclaration")) {
        if (statement.kind !== "const" && statement.kind !== "var") return unsupported();
        for (const declaration of statement.declarations) {
          if (
            !isNodeOfType(declaration.id, "Identifier") ||
            !declaration.init ||
            bindings.has(declaration.id.name) ||
            ["module", "exports", "require", "__dirname", "JSON", "Infinity"].includes(
              declaration.id.name,
            )
          )
            return unsupported();
          const initializer = declaration.init;
          bindings.set(
            declaration.id.name,
            deferred(() => evaluate(initializer)),
          );
        }
        continue;
      }
      if (
        isNodeOfType(statement, "ExpressionStatement") &&
        isNodeOfType(statement.expression, "AssignmentExpression") &&
        statement.expression.operator === "=" &&
        isNodeOfType(statement.expression.left, "MemberExpression") &&
        !statement.expression.left.computed &&
        isNodeOfType(statement.expression.left.object, "Identifier") &&
        statement.expression.left.object.name === "module" &&
        scopes.isGlobalReference(statement.expression.left.object) &&
        isNodeOfType(statement.expression.left.property, "Identifier") &&
        statement.expression.left.property.name === "exports"
      ) {
        if (exported) return unsupported();
        const expression = statement.expression.right;
        exported = deferred(() => evaluate(expression));
        continue;
      }
      if (isNodeOfType(statement, "FunctionDeclaration")) continue;
      if (isNodeOfType(statement, "ExpressionStatement")) {
        const expression = statement.expression;
        if (isNodeOfType(expression, "AssignmentExpression")) {
          const receiver = getRootIdentifier(expression.left);
          if (receiver && declarations.has(receiver.name)) continue;
        }
        if (
          isNodeOfType(expression, "CallExpression") &&
          isNodeOfType(expression.callee, "Identifier") &&
          expression.callee.name === "require" &&
          scopes.isGlobalReference(expression.callee) &&
          expression.arguments.length === 1 &&
          isNodeOfType(expression.arguments[0], "Literal") &&
          typeof expression.arguments[0].value === "string"
        )
          continue;
      }
      return unsupported();
    }
    const checkSourceJsxOptions = (node: EsTreeNode): void => {
      const options = readObject(evaluate(node));
      for (const [key, expected] of [
        ["pragma", "React.createElement"],
        ["pragmaFrag", "React.Fragment"],
        ["runtime", "classic"],
        ["importSource", "react"],
      ])
        if (options.has(key) && readString(options.get(key)) !== expected) unsupported();
    };
    walkAst(program, (node) => {
      if (
        isNodeOfType(node, "Property") &&
        getStaticPropertyKeyName(node) === "options" &&
        isNodeOfType(node.parent, "ObjectExpression") &&
        node.parent.properties.some(
          (property) =>
            isNodeOfType(property, "Property") &&
            getStaticPropertyKeyName(property) === "loader" &&
            isNodeOfType(property.value, "Literal") &&
            property.value.value === "babel-loader",
        )
      ) {
        checkSourceJsxOptions(node.value);
      }
      if (!isNodeOfType(node, "ArrayExpression") || node.elements.length !== 2) return;
      const name = node.elements[0];
      const optionsNode = node.elements[1];
      const list = node.parent;
      const property = list?.parent;
      if (
        !isNodeOfType(name, "Literal") ||
        typeof name.value !== "string" ||
        ![
          "react",
          "babel-preset-react",
          "@babel/preset-react",
          "transform-react-jsx",
          "babel-plugin-transform-react-jsx",
          "@babel/plugin-transform-react-jsx",
        ].includes(name.value) ||
        !isNodeOfType(list, "ArrayExpression") ||
        !isNodeOfType(property, "Property") ||
        !["presets", "plugins"].includes(getStaticPropertyKeyName(property) ?? "") ||
        !optionsNode
      )
        return;
      checkSourceJsxOptions(optionsNode);
    });
    if (!exported) return unsupported();
    activeModules.delete(filename);
    modules.set(filename, exported);
    return exported;
  };
  try {
    const config = readObject(readModule(path.resolve(configFilePath), 0));
    if (config.has("context")) {
      const context = readString(config.get("context"));
      if (!path.isAbsolute(context) || !insideProject(context)) return null;
    }
    const resolution = config.has("resolve")
      ? readObject(config.get("resolve"))
      : new Map<string, SnapshotConfigValue>();
    if ([...resolution.keys()].some((name) => !["extensions", "alias"].includes(name))) return null;
    const extensions = resolution.has("extensions")
      ? readArray(resolution.get("extensions")).map(readString)
      : [".js", ".jsx", ".mjs", ".json"];
    if (
      !extensions.length ||
      new Set(extensions).size !== extensions.length ||
      extensions.some((extension) => !SNAPSHOT_CONFIG_SUPPORTED_EXTENSIONS.has(extension))
    )
      return null;
    const aliases: ClosedJsonSnapshotSourceAlias[] = [];
    if (resolution.has("alias"))
      for (const [key, unresolved] of readObject(resolution.get("alias"))) {
        const value = resolveValue(unresolved);
        const exact = key.endsWith("$");
        const name = exact ? key.slice(0, -1) : key;
        const targetAbsolutePath = readString(value);
        if (
          !/^[@A-Za-z][@A-Za-z0-9_/-]*$/.test(name) ||
          name.includes("..") ||
          !path.isAbsolute(targetAbsolutePath) ||
          !insideProject(targetAbsolutePath) ||
          SNAPSHOT_KNOWN_SDK_REQUEST_HEADS.some(
            (packageName) => name === packageName || name.startsWith(`${packageName}/`),
          ) ||
          aliases.some(
            (alias) =>
              name === alias.name ||
              name.startsWith(`${alias.name}/`) ||
              alias.name.startsWith(`${name}/`),
          )
        )
          return null;
        aliases.push({ name, exact, targetAbsolutePath });
      }
    return { rootDirectory: root, extensions, aliases, configFilePaths: [...modules.keys()] };
  } catch {
    return null;
  }
};
