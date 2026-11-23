import * as fs from "node:fs";
import * as path from "node:path";
import { STOCK_GATSBY_MAX_CONFIG_BYTES } from "../constants/design.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";

interface DeclaredGatsbyV1StyledSsrRoute {
  readonly pluginNames: ReadonlyArray<string>;
  readonly sourceDirectory: string;
  readonly runtimeHookPaths: ReadonlyArray<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const allowedPlugins = new Set([
  "gatsby-transformer-yaml",
  "gatsby-source-filesystem",
  "gatsby-transformer-remark",
  "gatsby-remark-prismjs",
  "gatsby-remark-images",
  "gatsby-plugin-catch-links",
  "gatsby-plugin-react-helmet",
  "gatsby-plugin-styled-components",
  "gatsby-remark-copy-linked-files",
]);

const readText = (filename: string): string | null => {
  recordExistenceProbe(filename);
  recordContentProbe(filename);
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > STOCK_GATSBY_MAX_CONFIG_BYTES) return null;
    return fs.readFileSync(filename, "utf8");
  } catch {
    return null;
  }
};

const exists = (filename: string): boolean => {
  recordExistenceProbe(filename);
  try {
    fs.lstatSync(filename);
    return true;
  } catch (error) {
    // A permission or I/O failure is not an absence certificate.
    return !isRecord(error) || error.code !== "ENOENT";
  }
};

const readObjectProperties = (node: EsTreeNode): ReadonlyMap<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      property.shorthand
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (!key || result.has(key) || ["__proto__", "prototype", "constructor"].includes(key))
      return null;
    result.set(key, property.value);
  }
  return result;
};

const literalText = (node: EsTreeNode | undefined): string | null => {
  if (isNodeOfType(node, "Literal") && typeof node.value === "string") return node.value;
  if (
    isNodeOfType(node, "TemplateLiteral") &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    const quasi = node.quasis[0];
    if (quasi && quasi.value.raw === quasi.value.cooked) return quasi.value.raw;
  }
  return null;
};

const isSourceDirectoryTemplate = (
  node: EsTreeNode | undefined,
  scopes: ReturnType<typeof analyzeScopes>,
): boolean => {
  return (
    isNodeOfType(node, "TemplateLiteral") &&
    node.expressions.length === 1 &&
    node.quasis.length === 2 &&
    node.quasis[0]?.value.raw === "" &&
    node.quasis[0]?.value.cooked === "" &&
    /^\/src\/?$/.test(node.quasis[1]?.value.raw ?? "") &&
    node.quasis[1]?.value.raw === node.quasis[1]?.value.cooked &&
    isNodeOfType(node.expressions[0], "Identifier") &&
    node.expressions[0].name === "__dirname" &&
    scopes.isGlobalReference(node.expressions[0])
  );
};

const isStaticOption = (
  node: EsTreeNode,
  scopes: ReturnType<typeof analyzeScopes>,
  depth = 0,
): boolean => {
  if (depth > 8) return false;
  if (isNodeOfType(node, "Literal"))
    return node.value === null || ["string", "number", "boolean"].includes(typeof node.value);
  if (literalText(node) !== null) return true;
  if (isNodeOfType(node, "TemplateLiteral")) return isSourceDirectoryTemplate(node, scopes);
  if (isNodeOfType(node, "ArrayExpression"))
    return node.elements.every(
      (item) =>
        item !== null &&
        !isNodeOfType(item, "SpreadElement") &&
        isStaticOption(item, scopes, depth + 1),
    );
  const properties = readObjectProperties(node);
  return (
    properties !== null &&
    [...properties.values()].every((item) => isStaticOption(item, scopes, depth + 1))
  );
};

// Pure AST front half, reusable by callers that already pinned/parsed config.
const readStaticGatsbyV1PluginNames = (program: EsTreeNode): ReadonlyArray<string> | null => {
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return null;
  const statement = program.body[0];
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "AssignmentExpression") ||
    statement.expression.operator !== "="
  )
    return null;
  const assignment = statement.expression;
  const member = assignment.left;
  const scopes = analyzeScopes(program);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.object, "Identifier") ||
    member.object.name !== "module" ||
    !scopes.isGlobalReference(member.object) ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "exports"
  )
    return null;
  const configuration = readObjectProperties(assignment.right);
  if (
    !configuration ||
    [...configuration.keys()].some((key) => !["siteMetadata", "plugins"].includes(key))
  )
    return null;
  const metadata = configuration.get("siteMetadata");
  if (metadata && !isStaticOption(metadata, scopes)) return null;
  const plugins = configuration.get("plugins");
  if (!isNodeOfType(plugins, "ArrayExpression")) return null;
  const names: string[] = [];
  const visitPlugin = (node: EsTreeNode, depth: number): boolean => {
    if (depth > 4) return false;
    const name = literalText(node);
    if (name !== null) {
      if (!allowedPlugins.has(name) || name === "gatsby-source-filesystem") return false;
      names.push(name);
      return true;
    }
    const record = readObjectProperties(node);
    if (!record || [...record.keys()].some((key) => key !== "resolve" && key !== "options"))
      return false;
    const selected = literalText(record.get("resolve"));
    if (selected === null || !allowedPlugins.has(selected)) return false;
    names.push(selected);
    const options = record.get("options");
    const values = options && readObjectProperties(options);
    if (selected === "gatsby-source-filesystem") {
      return (
        depth === 0 &&
        Boolean(
          values &&
          values.size === 2 &&
          literalText(values.get("name")) === "src" &&
          isSourceDirectoryTemplate(values.get("path"), scopes),
        )
      );
    }
    if (!options) return true;
    if (!values) return false;
    if (selected === "gatsby-transformer-remark") {
      const remarkPlugins = values.get("plugins");
      return (
        depth === 0 &&
        values.size === 1 &&
        isNodeOfType(remarkPlugins, "ArrayExpression") &&
        remarkPlugins.elements.every((item) => item !== null && visitPlugin(item, depth + 1))
      );
    }
    if (selected === "gatsby-remark-images") {
      const maxWidth = values.get("maxWidth");
      return (
        values.size === 1 &&
        isNodeOfType(maxWidth, "Literal") &&
        typeof maxWidth.value === "number" &&
        Number.isSafeInteger(maxWidth.value) &&
        maxWidth.value > 0
      );
    }
    return values.size === 0;
  };
  if (!plugins.elements.every((item) => item !== null && visitPlugin(item, 0))) return null;
  // The SSR wrapper must be unconditional and top-level, exactly once.
  if (
    plugins.elements.filter(
      (item) => item !== null && literalText(item) === "gatsby-plugin-styled-components",
    ).length !== 1 ||
    names.filter((name) => name === "gatsby-plugin-styled-components").length !== 1
  )
    return null;
  if (
    names.filter((name) => name === "gatsby-source-filesystem").length !== 1 ||
    names.filter((name) => name === "gatsby-transformer-remark").length !== 1
  )
    return null;
  return names;
};

export const readDeclaredGatsbyV1StyledSsrRoute = (
  rootDirectory: string,
): DeclaredGatsbyV1StyledSsrRoute | null => {
  if (!path.isAbsolute(rootDirectory)) return null;
  const root = path.resolve(rootDirectory);
  const configPath = path.join(root, "gatsby-config.js");
  const packageText = readText(path.join(root, "package.json"));
  if (!packageText) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    return null;
  }
  if (!isRecord(manifest) || manifest.private !== true || !isRecord(manifest.dependencies))
    return null;
  for (const key of [
    "imports",
    "exports",
    "browser",
    "react-native",
    "resolutions",
    "overrides",
    "workspaces",
    "babel",
    "webpack",
    "gatsby",
    "type",
  ])
    if (manifest[key] !== undefined) return null;
  if (
    manifest.scripts !== undefined &&
    (!isRecord(manifest.scripts) ||
      Object.entries(manifest.scripts).some(
        ([key, value]) =>
          !["build", "develop", "start", "serve"].includes(key) ||
          typeof value !== "string" ||
          !/^gatsby (?:build|develop|serve)$/.test(value),
      ))
  )
    return null;
  if (
    typeof manifest.dependencies.gatsby !== "string" ||
    typeof manifest.dependencies["styled-components"] !== "string"
  )
    return null;
  for (const alternate of [
    "gatsby-config",
    "gatsby-config.ts",
    "gatsby-config.mjs",
    "gatsby-config.cjs",
    "gatsby-config.json",
    "gatsby-config.node",
    "gatsby-ssr",
    "gatsby-ssr.js",
    "gatsby-ssr.ts",
    "gatsby-ssr.mjs",
    "gatsby-ssr.cjs",
    "gatsby-ssr.json",
    "gatsby-ssr.node",
    "package-lock.json",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    ".pnp.cjs",
    ".pnp.js",
    ".yarnrc",
    ".yarnrc.yml",
  ])
    if (exists(path.join(root, alternate))) return null;
  const program = parseSourceFile(configPath);
  if (!program) return null;
  const pluginNames = readStaticGatsbyV1PluginNames(program);
  if (!pluginNames) return null;
  const runtimeHookPaths: string[] = [];
  for (const name of [
    "gatsby-node",
    "gatsby-browser",
    "gatsby-node.js",
    "gatsby-browser.js",
    "gatsby-node.json",
    "gatsby-browser.json",
    "gatsby-node.node",
    "gatsby-browser.node",
    "gatsby-node.ts",
    "gatsby-browser.ts",
    "gatsby-node.mjs",
    "gatsby-browser.mjs",
    "gatsby-node.cjs",
    "gatsby-browser.cjs",
  ])
    if (exists(path.join(root, name))) runtimeHookPaths.push(path.join(root, name));
  return { pluginNames, sourceDirectory: path.join(root, "src"), runtimeHookPaths };
};
