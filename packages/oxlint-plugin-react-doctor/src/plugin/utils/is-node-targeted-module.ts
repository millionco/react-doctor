import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// Builtins that only exist in a Node runtime. Deliberately excludes the
// names browser and React Native bundles commonly polyfill (`path`,
// `events`, `util`, `buffer`, `url`, `assert`, `stream`, `crypto`,
// `querystring`) so bundled code is not misclassified as Node-targeted.
const NODE_BUILTIN_MODULE_NAMES: ReadonlySet<string> = new Set([
  "fs",
  "child_process",
  "os",
  "module",
  "worker_threads",
  "v8",
  "net",
  "tls",
  "dns",
  "dgram",
  "cluster",
  "readline",
  "repl",
  "inspector",
  "perf_hooks",
  "async_hooks",
  "vm",
  "tty",
  "http",
  "https",
  "http2",
  "zlib",
]);

// npm packages that only run in a Node process — servers, build tools,
// CLI frameworks. Importing one marks the whole module as Node-targeted.
const SERVER_ONLY_PACKAGE_NAMES: ReadonlySet<string> = new Set([
  "express",
  "fastify",
  "koa",
  "hapi",
  "@hapi/hapi",
  "multer",
  "body-parser",
  "gulp",
  "grunt",
  "webpack",
  "rollup",
  "esbuild",
  "chokidar",
  "execa",
  "fs-extra",
  "glob",
  "fast-glob",
  "globby",
  "rimraf",
  "mkdirp",
  "resolve-from",
  "commander",
  "yargs",
  "inquirer",
  "ora",
  "winston",
  "pino",
  "nodemailer",
  "dotenv",
  "electron",
]);

const NODE_PROCESS_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "cwd",
  "exit",
  "argv",
  "execPath",
  "chdir",
  "resourcesPath",
  "stdout",
  "stderr",
  "stdin",
  "pid",
]);

const getRootPackageName = (moduleSource: string): string => {
  const segments = moduleSource.split("/");
  if (moduleSource.startsWith("@") && segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? moduleSource;
};

const isNodeOnlyModuleSource = (moduleSource: string): boolean => {
  if (moduleSource.startsWith("node:")) return true;
  const rootPackageName = getRootPackageName(moduleSource);
  return (
    NODE_BUILTIN_MODULE_NAMES.has(rootPackageName) || SERVER_ONLY_PACKAGE_NAMES.has(rootPackageName)
  );
};

const nodeIsNodeOnlySignal = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ImportDeclaration")) {
    if (node.importKind === "type") return false;
    const source = node.source?.value;
    return typeof source === "string" && isNodeOnlyModuleSource(source);
  }
  if (isNodeOfType(node, "CallExpression")) {
    if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "require") return false;
    const firstArgument = node.arguments?.[0];
    return (
      firstArgument !== undefined &&
      isNodeOfType(firstArgument, "Literal") &&
      typeof firstArgument.value === "string" &&
      isNodeOnlyModuleSource(firstArgument.value)
    );
  }
  if (isNodeOfType(node, "MemberExpression")) {
    if (!isNodeOfType(node.object, "Identifier")) return false;
    const objectName = node.object.name;
    const propertyName = isNodeOfType(node.property, "Identifier") ? node.property.name : null;
    if (propertyName === null) return false;
    if (objectName === "require") {
      return propertyName === "cache" || propertyName === "resolve" || propertyName === "main";
    }
    if (objectName === "module") return propertyName === "exports";
    if (objectName === "process") return NODE_PROCESS_PROPERTY_NAMES.has(propertyName);
    return false;
  }
  if (isNodeOfType(node, "AssignmentExpression")) {
    return (
      isNodeOfType(node.left, "MemberExpression") &&
      isNodeOfType(node.left.object, "Identifier") &&
      node.left.object.name === "exports"
    );
  }
  if (isNodeOfType(node, "Identifier")) {
    return node.name === "__dirname" || node.name === "__filename";
  }
  return false;
};

const cachedResultByProgram = new WeakMap<EsTreeNodeOfType<"Program">, boolean>();

// True when the module carries unmistakable Node-runtime signals (node
// builtin imports, server-only packages, `process.cwd()`-style API use,
// CommonJS `module.exports` / `exports.x =` authoring, `require.cache`
// manipulation, `__dirname`). Such files never ship in a browser bundle,
// so bundle-size claims do not apply to them.
export const isNodeTargetedModule = (node: EsTreeNode): boolean => {
  const programRoot = findProgramRoot(node);
  if (!programRoot) return false;
  const cached = cachedResultByProgram.get(programRoot);
  if (cached !== undefined) return cached;
  let hasNodeOnlySignal = false;
  walkAst(programRoot, (visitedNode) => {
    if (hasNodeOnlySignal) return false;
    if (nodeIsNodeOnlySignal(visitedNode)) {
      hasNodeOnlySignal = true;
      return false;
    }
  });
  cachedResultByProgram.set(programRoot, hasNodeOnlySignal);
  return hasNodeOnlySignal;
};
