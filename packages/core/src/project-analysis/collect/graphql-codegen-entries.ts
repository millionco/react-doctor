import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseYAML } from "confbox";
import fg from "fast-glob";
import ts from "typescript";
import { GRAPHQL_CODEGEN_CONFIG_SCAN_MAX_DEPTH, SOURCE_EXTENSIONS } from "../constants.js";
import { evaluateStaticConfig } from "../utils/evaluate-static-config.js";

const GRAPHQL_CODEGEN_CONFIG_GLOBS = [
  "codegen.{ts,js,mts,mjs,cts,cjs,yml,yaml}",
  "codegen-*.{ts,js,mts,mjs,cts,cjs,yml,yaml}",
  "**/codegen.{ts,js,mts,mjs,cts,cjs,yml,yaml}",
  "**/codegen-*.{ts,js,mts,mjs,cts,cjs,yml,yaml}",
  ".graphqlrc.{ts,js,mts,mjs,cts,cjs,json,yml,yaml}",
  "**/.graphqlrc.{ts,js,mts,mjs,cts,cjs,json,yml,yaml}",
  "vite.config.{ts,js,mts,mjs,cts,cjs}",
  "**/vite.config.{ts,js,mts,mjs,cts,cjs}",
];

export interface GraphqlCodegenEntries {
  documentEntries: string[];
  generatedEntries: string[];
  schemaEntries: string[];
}

const resolveCodegenPatterns = (patterns: string[], configDirectory: string): string[] =>
  fg.sync(
    patterns.filter(
      (pattern) =>
        !pattern.includes("://") && !pattern.startsWith("@") && !pattern.startsWith("node:"),
    ),
    {
      cwd: configDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    },
  );

const resolveGeneratedOutputs = (patterns: string[], configDirectory: string): string[] => {
  const generatedEntries = new Set<string>();
  const sourceExtensionGlob = `**/*.{${SOURCE_EXTENSIONS.join(",")}}`;

  for (const pattern of patterns) {
    const outputPath = resolve(configDirectory, pattern);
    if (!existsSync(outputPath)) continue;
    const outputStats = statSync(outputPath);
    if (outputStats.isFile()) {
      generatedEntries.add(outputPath);
      continue;
    }
    if (!outputStats.isDirectory()) continue;
    for (const generatedEntry of fg.sync(sourceExtensionGlob, {
      cwd: outputPath,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**"],
    })) {
      generatedEntries.add(generatedEntry);
    }
  }

  return [...generatedEntries];
};

const extractVitePluginConfigContents = (content: string): string[] => {
  const pluginConfigContents: string[] = [];
  const sourceFile = ts.createSourceFile(
    "vite.config.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const pluginImport = sourceFile.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "vite-plugin-graphql-codegen" &&
      statement.importClause?.name !== undefined,
  );
  const pluginName = pluginImport?.importClause?.name?.text;
  if (!pluginName) return [];
  const exportAssignment = sourceFile.statements.find(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  if (!exportAssignment) return [];
  const topLevelVariableInitializers = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        topLevelVariableInitializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  const unwrapExpression = (expression: ts.Expression): ts.Expression => {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return unwrapExpression(expression.expression);
    }
    return expression;
  };
  const collectPluginExpression = (
    expression: ts.Expression,
    variableInitializers: ReadonlyMap<string, ts.Expression>,
    isPluginNameShadowed: boolean,
    visitedIdentifiers = new Set<string>(),
  ): void => {
    const unwrappedExpression = unwrapExpression(expression);
    if (
      ts.isCallExpression(unwrappedExpression) &&
      ts.isIdentifier(unwrappedExpression.expression) &&
      unwrappedExpression.expression.text === pluginName
    ) {
      const configArgument = unwrappedExpression.arguments[0];
      if (configArgument && !isPluginNameShadowed) {
        const bindingStatements = [...variableInitializers.entries()]
          .map(
            ([variableName, initializer]) =>
              `const ${variableName} = (${initializer.getText(sourceFile)});`,
          )
          .join("\n");
        pluginConfigContents.push(
          `${bindingStatements}\nexport default (${configArgument.getText(sourceFile)});`,
        );
      }
      return;
    }
    if (ts.isIdentifier(unwrappedExpression) && !visitedIdentifiers.has(unwrappedExpression.text)) {
      const initializer = variableInitializers.get(unwrappedExpression.text);
      if (!initializer) return;
      collectPluginExpression(
        initializer,
        variableInitializers,
        isPluginNameShadowed,
        new Set(visitedIdentifiers).add(unwrappedExpression.text),
      );
      return;
    }
    if (ts.isArrayLiteralExpression(unwrappedExpression)) {
      for (const element of unwrappedExpression.elements) {
        collectPluginExpression(
          ts.isSpreadElement(element) ? element.expression : element,
          variableInitializers,
          isPluginNameShadowed,
          visitedIdentifiers,
        );
      }
      return;
    }
    if (ts.isConditionalExpression(unwrappedExpression)) {
      collectPluginExpression(
        unwrappedExpression.whenTrue,
        variableInitializers,
        isPluginNameShadowed,
        visitedIdentifiers,
      );
      collectPluginExpression(
        unwrappedExpression.whenFalse,
        variableInitializers,
        isPluginNameShadowed,
        visitedIdentifiers,
      );
      return;
    }
    if (
      ts.isBinaryExpression(unwrappedExpression) &&
      (unwrappedExpression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        unwrappedExpression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        unwrappedExpression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      collectPluginExpression(
        unwrappedExpression.left,
        variableInitializers,
        isPluginNameShadowed,
        visitedIdentifiers,
      );
      collectPluginExpression(
        unwrappedExpression.right,
        variableInitializers,
        isPluginNameShadowed,
        visitedIdentifiers,
      );
    }
  };
  const collectConfigPlugins = (
    expression: ts.Expression,
    variableInitializers: ReadonlyMap<string, ts.Expression>,
    isPluginNameShadowed: boolean,
    visitedIdentifiers = new Set<string>(),
  ): void => {
    const unwrappedExpression = unwrapExpression(expression);
    if (ts.isIdentifier(unwrappedExpression) && !visitedIdentifiers.has(unwrappedExpression.text)) {
      const initializer = variableInitializers.get(unwrappedExpression.text);
      if (!initializer) return;
      collectConfigPlugins(
        initializer,
        variableInitializers,
        isPluginNameShadowed,
        new Set(visitedIdentifiers).add(unwrappedExpression.text),
      );
      return;
    }
    if (ts.isCallExpression(unwrappedExpression)) {
      const calledExpression = unwrapExpression(unwrappedExpression.expression);
      if (!ts.isIdentifier(calledExpression) || calledExpression.text !== "defineConfig") return;
      const configArgument = unwrappedExpression.arguments[0];
      if (!configArgument) return;
      const unwrappedArgument = unwrapExpression(configArgument);
      if (ts.isArrowFunction(unwrappedArgument) || ts.isFunctionExpression(unwrappedArgument)) {
        let callbackPluginNameShadowed =
          isPluginNameShadowed ||
          unwrappedArgument.parameters.some(
            (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === pluginName,
          );
        if (!ts.isBlock(unwrappedArgument.body)) {
          collectConfigPlugins(
            unwrappedArgument.body,
            variableInitializers,
            callbackPluginNameShadowed,
          );
          return;
        }
        const callbackVariableInitializers = new Map(variableInitializers);
        for (const statement of unwrappedArgument.body.statements) {
          if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
              if (!ts.isIdentifier(declaration.name)) continue;
              if (declaration.name.text === pluginName) callbackPluginNameShadowed = true;
              if (declaration.initializer) {
                callbackVariableInitializers.set(declaration.name.text, declaration.initializer);
              }
            }
          }
          if (ts.isReturnStatement(statement) && statement.expression) {
            collectConfigPlugins(
              statement.expression,
              callbackVariableInitializers,
              callbackPluginNameShadowed,
            );
            return;
          }
        }
        return;
      }
      collectConfigPlugins(unwrappedArgument, variableInitializers, isPluginNameShadowed);
      return;
    }
    if (!ts.isObjectLiteralExpression(unwrappedExpression)) return;
    for (const property of unwrappedExpression.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ((ts.isIdentifier(property.name) && property.name.text === "plugins") ||
          (ts.isStringLiteral(property.name) && property.name.text === "plugins"))
      ) {
        collectPluginExpression(property.initializer, variableInitializers, isPluginNameShadowed);
      }
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === "plugins") {
        collectPluginExpression(property.name, variableInitializers, isPluginNameShadowed);
      }
    }
  };
  collectConfigPlugins(exportAssignment.expression, topLevelVariableInitializers, false);

  return pluginConfigContents;
};

const collectStructuredCodegenPatterns = (config: unknown): GraphqlCodegenEntries => {
  const documentEntries: string[] = [];
  const generatedEntries: string[] = [];
  const schemaEntries: string[] = [];
  const visitedValues = new WeakSet<object>();
  const visitedPatternValues = new WeakSet<object>();
  const visitedNestedStringValues = new WeakSet<object>();
  const collectNestedStringValues = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (typeof value !== "object" || value === null) return [];
    if (visitedNestedStringValues.has(value)) return [];
    visitedNestedStringValues.add(value);
    if (Array.isArray(value)) return value.flatMap(collectNestedStringValues);
    return Object.values(value).flatMap(collectNestedStringValues);
  };
  const collectPatternValues = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (typeof value !== "object" || value === null) return [];
    if (visitedPatternValues.has(value)) return [];
    visitedPatternValues.add(value);
    if (Array.isArray(value)) return value.flatMap(collectPatternValues);
    return [...Object.keys(value), ...Object.values(value).flatMap(collectNestedStringValues)];
  };
  const visitValue = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visitValue(item);
      return;
    }
    if (typeof value !== "object" || value === null || visitedValues.has(value)) return;
    visitedValues.add(value);
    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === "generates" && typeof nestedValue === "object" && nestedValue !== null) {
        generatedEntries.push(...Object.keys(nestedValue));
      } else if (key === "documents") {
        documentEntries.push(...collectPatternValues(nestedValue));
      } else if (key === "schema") {
        schemaEntries.push(...collectPatternValues(nestedValue));
      }
      visitValue(nestedValue);
    }
  };
  visitValue(config);
  return { documentEntries, generatedEntries, schemaEntries };
};

export const extractGraphqlCodegenEntries = (directory: string): GraphqlCodegenEntries => {
  const documentEntries = new Set<string>();
  const generatedEntries = new Set<string>();
  const schemaEntries = new Set<string>();
  const configPaths = fg.sync(GRAPHQL_CODEGEN_CONFIG_GLOBS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: GRAPHQL_CODEGEN_CONFIG_SCAN_MAX_DEPTH,
  });

  for (const configPath of configPaths) {
    try {
      const rawContent = readFileSync(configPath, "utf-8");
      const isViteConfig = basename(configPath).startsWith("vite.config.");
      const isJsonConfig = configPath.endsWith(".json");
      const isYamlConfig = configPath.endsWith(".yml") || configPath.endsWith(".yaml");
      const isJavaScriptConfig = /\.[cm]?[jt]s$/.test(configPath);
      const relevantContents = isViteConfig
        ? extractVitePluginConfigContents(rawContent)
        : [rawContent];
      if (relevantContents.length === 0) continue;
      const configDirectory = dirname(configPath);
      const structuredPatterns: GraphqlCodegenEntries = {
        documentEntries: [],
        generatedEntries: [],
        schemaEntries: [],
      };
      if (isJsonConfig) {
        const patterns = collectStructuredCodegenPatterns(JSON.parse(rawContent));
        structuredPatterns.documentEntries.push(...patterns.documentEntries);
        structuredPatterns.generatedEntries.push(...patterns.generatedEntries);
        structuredPatterns.schemaEntries.push(...patterns.schemaEntries);
      } else if (isYamlConfig) {
        const patterns = collectStructuredCodegenPatterns(parseYAML<unknown>(rawContent));
        structuredPatterns.documentEntries.push(...patterns.documentEntries);
        structuredPatterns.generatedEntries.push(...patterns.generatedEntries);
        structuredPatterns.schemaEntries.push(...patterns.schemaEntries);
      } else if (isJavaScriptConfig) {
        for (const relevantContent of relevantContents) {
          const patterns = collectStructuredCodegenPatterns(
            evaluateStaticConfig(relevantContent, configPath),
          );
          structuredPatterns.documentEntries.push(...patterns.documentEntries);
          structuredPatterns.generatedEntries.push(...patterns.generatedEntries);
          structuredPatterns.schemaEntries.push(...patterns.schemaEntries);
        }
      }
      const documentPatterns = structuredPatterns.documentEntries;
      const schemaPatterns = structuredPatterns.schemaEntries;
      const generatedOutputPatterns = structuredPatterns.generatedEntries;
      for (const entryPath of resolveCodegenPatterns(documentPatterns, configDirectory)) {
        documentEntries.add(entryPath);
      }
      for (const entryPath of resolveCodegenPatterns(schemaPatterns, configDirectory)) {
        schemaEntries.add(entryPath);
      }
      for (const entryPath of resolveGeneratedOutputs(generatedOutputPatterns, configDirectory)) {
        generatedEntries.add(entryPath);
      }
    } catch {
      continue;
    }
  }

  return {
    documentEntries: [...documentEntries],
    generatedEntries: [...generatedEntries],
    schemaEntries: [...schemaEntries],
  };
};
