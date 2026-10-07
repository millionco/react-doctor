import { isAbsolute, resolve } from "node:path";
import { parseSync } from "oxc-parser";

export interface BundlerAlias {
  name: string;
  targetDirectory: string;
  isExact: boolean;
}

interface BundlerConfigNode {
  type: string;
  [key: string]: unknown;
}

const isBundlerConfigNode = (value: unknown): value is BundlerConfigNode =>
  value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";

const getNodeName = (node: unknown): string | undefined => {
  if (!isBundlerConfigNode(node)) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
};

const getObjectPropertyValue = (
  objectExpression: BundlerConfigNode,
  propertyName: string,
): unknown => {
  if (objectExpression.type !== "ObjectExpression" || !Array.isArray(objectExpression.properties)) {
    return undefined;
  }
  for (const property of objectExpression.properties) {
    if (!isBundlerConfigNode(property) || property.type !== "Property") continue;
    if (getNodeName(property.key) === propertyName) return property.value;
  }
  return undefined;
};

const collectLocalPathHelperRoots = (
  program: unknown,
  configDirectory: string,
): Map<string, string> => {
  const roots = new Map<string, string>();
  const visitNode = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const element of node) visitNode(element);
      return;
    }
    if (!isBundlerConfigNode(node)) return;
    if (
      node.type === "FunctionDeclaration" &&
      Array.isArray(node.params) &&
      node.params.length === 1 &&
      isBundlerConfigNode(node.body) &&
      Array.isArray(node.body.body)
    ) {
      const helperName = getNodeName(node.id);
      const parameterName = getNodeName(node.params[0]);
      const returnStatement = node.body.body.find(
        (statement) => isBundlerConfigNode(statement) && statement.type === "ReturnStatement",
      );
      const callExpression =
        isBundlerConfigNode(returnStatement) && isBundlerConfigNode(returnStatement.argument)
          ? returnStatement.argument
          : undefined;
      const callee =
        callExpression?.type === "CallExpression" && isBundlerConfigNode(callExpression.callee)
          ? callExpression.callee
          : undefined;
      const argumentsList = Array.isArray(callExpression?.arguments)
        ? callExpression.arguments
        : [];
      const isPathCall =
        callee?.type === "MemberExpression" &&
        getNodeName(callee.object) === "path" &&
        ["resolve", "join"].includes(getNodeName(callee.property) ?? "");
      if (
        helperName &&
        parameterName &&
        isPathCall &&
        getNodeName(argumentsList[0]) === "__dirname" &&
        getNodeName(argumentsList.at(-1)) === parameterName
      ) {
        const pathSegments = argumentsList
          .slice(1, -1)
          .map(getNodeName)
          .filter((segment): segment is string => segment !== undefined);
        if (pathSegments.length === argumentsList.length - 2) {
          roots.set(helperName, resolve(configDirectory, ...pathSegments));
        }
      }
    }
    for (const value of Object.values(node)) visitNode(value);
  };
  visitNode(program);
  return roots;
};

const resolveAliasTarget = (
  expression: unknown,
  configDirectory: string,
  localPathHelperRoots: ReadonlyMap<string, string>,
): string | undefined => {
  if (!isBundlerConfigNode(expression)) return undefined;
  if (expression.type === "Literal" && typeof expression.value === "string") {
    const target = expression.value.replace(/\/\*$/, "");
    return isAbsolute(target) ? target : resolve(configDirectory, target);
  }
  if (expression.type !== "CallExpression" || !isBundlerConfigNode(expression.callee)) {
    return undefined;
  }
  const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
  const callee = expression.callee;
  if (
    callee.type === "MemberExpression" &&
    getNodeName(callee.object) === "path" &&
    ["resolve", "join"].includes(getNodeName(callee.property) ?? "") &&
    getNodeName(argumentsList[0]) === "__dirname"
  ) {
    const pathSegments = argumentsList
      .slice(1)
      .map(getNodeName)
      .filter((segment): segment is string => segment !== undefined);
    return pathSegments.length === argumentsList.length - 1
      ? resolve(configDirectory, ...pathSegments)
      : undefined;
  }
  const calleeName = getNodeName(callee);
  if (calleeName === "fileURLToPath") {
    const urlExpression = argumentsList[0];
    if (
      isBundlerConfigNode(urlExpression) &&
      urlExpression.type === "NewExpression" &&
      getNodeName(urlExpression.callee) === "URL" &&
      Array.isArray(urlExpression.arguments)
    ) {
      const relativeTarget = getNodeName(urlExpression.arguments[0]);
      if (relativeTarget) return resolve(configDirectory, relativeTarget);
    }
  }
  const localPathHelperRoot = calleeName ? localPathHelperRoots.get(calleeName) : undefined;
  const localPathHelperTarget = getNodeName(argumentsList[0]);
  return localPathHelperRoot && localPathHelperTarget
    ? resolve(localPathHelperRoot, localPathHelperTarget)
    : undefined;
};

const createAlias = (
  rawName: string,
  targetDirectory: string | undefined,
): BundlerAlias | undefined => {
  if (!targetDirectory) return undefined;
  const isExact = rawName.endsWith("$");
  const name = rawName.replace(/\$$/, "").replace(/\/\*$/, "").replace(/\/$/, "");
  return name ? { name, targetDirectory, isExact } : undefined;
};

export const extractBundlerAliases = (content: string, configDirectory: string): BundlerAlias[] => {
  const aliases: BundlerAlias[] = [];
  let program: unknown;
  try {
    program = parseSync("bundler-config.ts", content).program;
  } catch {
    return aliases;
  }
  const localPathHelperRoots = collectLocalPathHelperRoots(program, configDirectory);
  const visitNode = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const element of node) visitNode(element);
      return;
    }
    if (!isBundlerConfigNode(node)) return;
    if (node.type === "Property" && getNodeName(node.key) === "alias") {
      const aliasValue = isBundlerConfigNode(node.value) ? node.value : undefined;
      if (aliasValue?.type === "ObjectExpression" && Array.isArray(aliasValue.properties)) {
        for (const property of aliasValue.properties) {
          if (!isBundlerConfigNode(property) || property.type !== "Property") continue;
          const rawName = getNodeName(property.key);
          if (!rawName) continue;
          const alias = createAlias(
            rawName,
            resolveAliasTarget(property.value, configDirectory, localPathHelperRoots),
          );
          if (alias) aliases.push(alias);
        }
      }
      if (aliasValue?.type === "ArrayExpression" && Array.isArray(aliasValue.elements)) {
        for (const element of aliasValue.elements) {
          if (!isBundlerConfigNode(element) || element.type !== "ObjectExpression") continue;
          const rawName = getNodeName(getObjectPropertyValue(element, "find"));
          if (!rawName) continue;
          const alias = createAlias(
            rawName,
            resolveAliasTarget(
              getObjectPropertyValue(element, "replacement"),
              configDirectory,
              localPathHelperRoots,
            ),
          );
          if (alias) aliases.push(alias);
        }
      }
      return;
    }
    for (const value of Object.values(node)) visitNode(value);
  };
  visitNode(program);
  return aliases;
};
