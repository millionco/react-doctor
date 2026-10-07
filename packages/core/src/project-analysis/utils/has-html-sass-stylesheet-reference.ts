import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import ts from "typescript";
import { BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH } from "../constants.js";
import { extractScriptBinaryNames } from "./extract-script-binary-names.js";
import { extractInvokedBuildScriptPaths } from "../collect/build-script-consumed-files.js";
import { collectHtmlElementAttributes } from "./collect-html-element-attributes.js";

const SASS_PATH_PATTERN = /\.(?:scss|sass)$/i;
const PARCEL_BINARY_NAMES = new Set(["parcel", "parcel-bundler"]);

const splitShellSegments = (command: string): string[] => {
  const segments: string[] = [];
  let currentSegment = "";
  let quote = "";

  const collectCurrentSegment = (): void => {
    if (currentSegment.trim()) segments.push(currentSegment);
    currentSegment = "";
  };

  for (let characterIndex = 0; characterIndex < command.length; characterIndex++) {
    const character = command[characterIndex];
    if (quote) {
      currentSegment += character;
      if (character === "\\" && quote !== "'" && characterIndex + 1 < command.length) {
        characterIndex++;
        currentSegment += command[characterIndex];
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      currentSegment += character;
      continue;
    }
    if (character === "\\" && characterIndex + 1 < command.length) {
      currentSegment += character;
      characterIndex++;
      currentSegment += command[characterIndex];
      continue;
    }
    if (character === ";" || character === "|" || character === "&") {
      collectCurrentSegment();
      if (command[characterIndex + 1] === character) characterIndex++;
      continue;
    }
    currentSegment += character;
  }

  collectCurrentSegment();
  return segments;
};

const extractShellTokens = (segment: string): string[] => {
  const tokens: string[] = [];
  let currentToken = "";
  let quote = "";

  const collectCurrentToken = (): void => {
    if (currentToken) tokens.push(currentToken);
    currentToken = "";
  };

  for (let characterIndex = 0; characterIndex < segment.length; characterIndex++) {
    const character = segment[characterIndex];
    if (quote) {
      if (character === quote) {
        quote = "";
      } else if (character === "\\" && quote !== "'" && characterIndex + 1 < segment.length) {
        characterIndex++;
        currentToken += segment[characterIndex];
      } else {
        currentToken += character;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      collectCurrentToken();
      continue;
    }
    if (character === "\\" && characterIndex + 1 < segment.length) {
      characterIndex++;
      currentToken += segment[characterIndex];
      continue;
    }
    currentToken += character;
  }

  collectCurrentToken();
  return tokens;
};

const collectParcelHtmlEntryPaths = (rootDirectory: string): string[] => {
  const htmlEntryPaths = new Set<string>();
  const packageJsonPaths = fg.sync(["package.json", "**/package.json"], {
    cwd: rootDirectory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH,
  });

  for (const packageJsonPath of packageJsonPaths) {
    let packageJson: unknown;
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    } catch {
      continue;
    }
    if (typeof packageJson !== "object" || packageJson === null || !("scripts" in packageJson)) {
      continue;
    }
    const scripts = packageJson.scripts;
    if (typeof scripts !== "object" || scripts === null) continue;
    for (const command of Object.values(scripts)) {
      if (typeof command !== "string") continue;
      for (const segment of splitShellSegments(command)) {
        if (
          !extractScriptBinaryNames(segment).some((binaryName) =>
            PARCEL_BINARY_NAMES.has(binaryName),
          )
        ) {
          continue;
        }
        for (const token of extractShellTokens(segment)) {
          if (!/\.html?$/i.test(token) || token.startsWith("-")) continue;
          const htmlEntryPath = resolve(dirname(packageJsonPath), token);
          if (existsSync(htmlEntryPath)) htmlEntryPaths.add(htmlEntryPath);
        }
      }
    }
  }

  for (const scriptPath of extractInvokedBuildScriptPaths(rootDirectory)) {
    let sourceText: string;
    try {
      sourceText = readFileSync(scriptPath, "utf8");
    } catch {
      continue;
    }
    const sourceFile = ts.createSourceFile(
      scriptPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const parcelConstructorNames = new Set<string>();
    const variableInitializers = new Map<string, ts.Expression>();
    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "parcel-bundler"
      ) {
        const importClause = statement.importClause;
        if (importClause?.name) parcelConstructorNames.add(importClause.name.text);
      }
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        variableInitializers.set(declaration.name.text, declaration.initializer);
        if (
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          declaration.initializer.expression.text === "require" &&
          declaration.initializer.arguments.length === 1 &&
          ts.isStringLiteralLike(declaration.initializer.arguments[0]) &&
          declaration.initializer.arguments[0].text === "parcel-bundler"
        ) {
          parcelConstructorNames.add(declaration.name.text);
        }
      }
    }
    if (parcelConstructorNames.size === 0) continue;

    const evaluateEntryExpression = (
      expression: ts.Expression,
      visitedIdentifiers = new Set<string>(),
    ): string[] => {
      if (ts.isStringLiteralLike(expression)) return [expression.text];
      if (ts.isArrayLiteralExpression(expression)) {
        return expression.elements.flatMap((element) =>
          ts.isExpression(element) ? evaluateEntryExpression(element, visitedIdentifiers) : [],
        );
      }
      if (ts.isIdentifier(expression)) {
        if (visitedIdentifiers.has(expression.text)) return [];
        const initializer = variableInitializers.get(expression.text);
        if (!initializer) return [];
        return evaluateEntryExpression(
          initializer,
          new Set(visitedIdentifiers).add(expression.text),
        );
      }
      if (
        ts.isCallExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        (expression.expression.name.text === "join" ||
          expression.expression.name.text === "resolve") &&
        expression.arguments.length > 1 &&
        ts.isIdentifier(expression.arguments[0]) &&
        expression.arguments[0].text === "__dirname" &&
        expression.arguments.slice(1).every(ts.isStringLiteralLike)
      ) {
        const pathSegments = expression.arguments
          .slice(1)
          .flatMap((argument) => (ts.isStringLiteralLike(argument) ? [argument.text] : []));
        return [resolve(dirname(scriptPath), ...pathSegments)];
      }
      return [];
    };

    const visitNode = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        parcelConstructorNames.has(node.expression.text) &&
        node.arguments?.[0]
      ) {
        for (const entrySpecifier of evaluateEntryExpression(node.arguments[0])) {
          const entryPattern = isAbsolute(entrySpecifier)
            ? entrySpecifier
            : resolve(dirname(scriptPath), entrySpecifier);
          for (const htmlEntryPath of fg.sync(entryPattern.replaceAll("\\", "/"), {
            absolute: true,
            onlyFiles: true,
          })) {
            if (/\.html?$/i.test(htmlEntryPath)) htmlEntryPaths.add(htmlEntryPath);
          }
        }
      }
      ts.forEachChild(node, visitNode);
    };
    visitNode(sourceFile);
  }

  return [...htmlEntryPaths];
};

export const hasHtmlSassStylesheetReference = (rootDirectory: string): boolean => {
  for (const htmlFile of collectParcelHtmlEntryPaths(rootDirectory)) {
    let content: string;
    try {
      content = readFileSync(htmlFile, "utf8");
    } catch {
      continue;
    }

    for (const attributes of collectHtmlElementAttributes(content, "link")) {
      const relation = attributes.get("rel");
      const href = attributes.get("href")?.split(/[?#]/, 1)[0];
      if (
        !relation?.toLowerCase().split(/\s+/).includes("stylesheet") ||
        !href ||
        !SASS_PATH_PATTERN.test(href)
      ) {
        continue;
      }
      const stylesheetPath = isAbsolute(href)
        ? resolve(rootDirectory, `.${href}`)
        : resolve(dirname(htmlFile), href);
      if (existsSync(stylesheetPath)) return true;
    }
  }

  return false;
};
