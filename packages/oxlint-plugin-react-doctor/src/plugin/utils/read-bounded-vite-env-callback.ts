import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface BoundedViteEnvCallbackProjection {
  readonly configLoaderRequired: "bundle";
  readonly commandRequired: "build";
  readonly environmentDirectory: "process.cwd()";
  readonly environmentMerge: "inherited-then-vite-prefixed";
  readonly definesWholeProcessEnvironment: true;
  readonly pluginSpecifiers: readonly string[];
  readonly aliases: readonly never[];
  readonly outputDirectory: string;
  readonly serverPort: number;
  readonly requiresSeparatePhysicalAndEnvironmentQualification: true;
}

const fields = (node: EsTreeNode | null | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const name = isNodeOfType(property.key, "Identifier")
      ? property.key.name
      : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
        ? property.key.value
        : null;
    if (name === null || result.has(name)) return null;
    result.set(name, property.value);
  }
  return result;
};
const exactly = (
  values: Map<string, EsTreeNode> | null,
  names: readonly string[],
): values is Map<string, EsTreeNode> =>
  Boolean(values && values.size === names.length && names.every((name) => values.has(name)));
const literal = (node: EsTreeNode | undefined, expected: string | number): boolean =>
  isNodeOfType(node, "Literal") && node.value === expected;

export const readBoundedViteEnvCallback = (
  program: EsTreeNode,
): BoundedViteEnvCallbackProjection | null => {
  if (!isNodeOfType(program, "Program")) return null;
  const scopes = analyzeScopes(program);
  const imports = new Map<number, string>();
  const expectedImports = new Set([
    "vite:defineConfig",
    "vite:loadEnv",
    "@vitejs/plugin-react:default",
    "vite-tsconfig-paths:default",
    "vite-plugin-svgr:default",
    "rollup-plugin-visualizer:visualizer",
  ]);
  const last = program.body.at(-1);
  if (!isNodeOfType(last, "ExportDefaultDeclaration")) return null;
  for (const statement of program.body.slice(0, -1)) {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      statement.specifiers.length === 0
    )
      return null;
    for (const specifier of statement.specifiers) {
      const name = isNodeOfType(specifier, "ImportDefaultSpecifier")
        ? "default"
        : isNodeOfType(specifier, "ImportSpecifier") &&
            specifier.importKind !== "type" &&
            isNodeOfType(specifier.imported, "Identifier")
          ? specifier.imported.name
          : null;
      const symbol = scopes.symbolFor(specifier.local);
      const identity = `${statement.source.value}:${name}`;
      if (!symbol || !expectedImports.delete(identity)) return null;
      imports.set(symbol.id, identity);
    }
  }
  if (expectedImports.size) return null;
  const imported = (node: EsTreeNode | undefined, identity: string): boolean => {
    if (!isNodeOfType(node, "Identifier")) return false;
    const symbol = scopes.symbolFor(node);
    return Boolean(symbol && imports.get(symbol.id) === identity);
  };
  const globalProcess = (node: EsTreeNode | undefined): boolean =>
    isNodeOfType(node, "Identifier") && node.name === "process" && scopes.isGlobalReference(node);
  const member = (
    node: EsTreeNode | undefined,
    name: string,
    receiver: (node: EsTreeNode) => boolean,
  ): boolean =>
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    !node.optional &&
    isNodeOfType(node.property, "Identifier") &&
    node.property.name === name &&
    receiver(node.object);
  const processEnv = (node: EsTreeNode): boolean => member(node, "env", globalProcess);
  const call = (
    node: EsTreeNode | null | undefined,
    identity: string,
    count: number,
  ): node is EsTreeNode & { arguments: EsTreeNode[] } =>
    isNodeOfType(node, "CallExpression") &&
    !node.optional &&
    node.arguments.length === count &&
    imported(node.callee, identity);
  const declaration = last.declaration;
  if (!call(declaration, "vite:defineConfig", 1)) return null;
  const callback = declaration.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 2
  )
    return null;
  const parameter = callback.params[0];
  if (!isNodeOfType(parameter, "ObjectPattern") || parameter.properties.length !== 1) return null;
  const property = parameter.properties[0];
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    !isNodeOfType(property.key, "Identifier") ||
    property.key.name !== "mode" ||
    !isNodeOfType(property.value, "Identifier")
  )
    return null;
  const mode = scopes.symbolFor(property.value);
  const assignmentStatement = callback.body.body[0];
  if (
    !isNodeOfType(assignmentStatement, "ExpressionStatement") ||
    !isNodeOfType(assignmentStatement.expression, "AssignmentExpression")
  )
    return null;
  const assignment = assignmentStatement.expression;
  if (
    assignment.operator !== "=" ||
    !processEnv(assignment.left) ||
    !isNodeOfType(assignment.right, "ObjectExpression") ||
    assignment.right.properties.length !== 2
  )
    return null;
  const [inherited, loaded] = assignment.right.properties;
  if (
    !isNodeOfType(inherited, "SpreadElement") ||
    !processEnv(inherited.argument) ||
    !isNodeOfType(loaded, "SpreadElement") ||
    !call(loaded.argument, "vite:loadEnv", 2)
  )
    return null;
  const [selectedMode, cwd] = loaded.argument.arguments;
  if (
    !mode ||
    !isNodeOfType(selectedMode, "Identifier") ||
    scopes.symbolFor(selectedMode)?.id !== mode.id ||
    !isNodeOfType(cwd, "CallExpression") ||
    cwd.optional ||
    cwd.arguments.length ||
    !member(cwd.callee, "cwd", globalProcess)
  )
    return null;
  const returned = callback.body.body[1];
  if (!isNodeOfType(returned, "ReturnStatement")) return null;
  const envelope = fields(returned.argument);
  if (!exactly(envelope, ["plugins", "define", "server", "build"])) return null;
  const plugins = envelope.get("plugins");
  if (!isNodeOfType(plugins, "ArrayExpression") || plugins.elements.length !== 4) return null;
  const [react, paths, svg, visualizer] = plugins.elements;
  if (
    !call(react, "@vitejs/plugin-react:default", 0) ||
    !call(paths, "vite-tsconfig-paths:default", 0) ||
    !call(svg, "vite-plugin-svgr:default", 0) ||
    !call(visualizer, "rollup-plugin-visualizer:visualizer", 1)
  )
    return null;
  const visualization = fields(visualizer.arguments[0]);
  const open = visualization?.get("open");
  if (
    !exactly(visualization, ["open"]) ||
    !isNodeOfType(open, "BinaryExpression") ||
    open.operator !== "===" ||
    !literal(open.right, "true") ||
    !member(open.left, "ANALYZE", processEnv)
  )
    return null;
  const define = fields(envelope.get("define"));
  const build = fields(envelope.get("build"));
  const server = fields(envelope.get("server"));
  if (
    !exactly(define, ["process.env"]) ||
    !processEnv(define.get("process.env")!) ||
    !exactly(build, ["outDir"]) ||
    !exactly(server, ["port"])
  )
    return null;
  const directory = build.get("outDir");
  const port = server.get("port");
  if (
    !isNodeOfType(directory, "Literal") ||
    typeof directory.value !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(directory.value) ||
    !isNodeOfType(port, "Literal") ||
    typeof port.value !== "number" ||
    !Number.isInteger(port.value) ||
    port.value < 1 ||
    port.value > 65535
  )
    return null;
  return {
    configLoaderRequired: "bundle",
    commandRequired: "build",
    environmentDirectory: "process.cwd()",
    environmentMerge: "inherited-then-vite-prefixed",
    definesWholeProcessEnvironment: true,
    pluginSpecifiers: [
      "@vitejs/plugin-react",
      "vite-tsconfig-paths",
      "vite-plugin-svgr",
      "rollup-plugin-visualizer",
    ],
    aliases: [],
    outputDirectory: directory.value,
    serverPort: port.value,
    requiresSeparatePhysicalAndEnvironmentQualification: true,
  };
};
