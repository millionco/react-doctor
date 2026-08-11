import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import { GRAPHQL_CODEGEN_CONFIG_SCAN_MAX_DEPTH, SOURCE_EXTENSIONS } from "../constants.js";
import { maskJavaScriptStringsAndComments } from "../utils/mask-javascript-strings-and-comments.js";

const GRAPHQL_CODEGEN_CONFIG_GLOBS = [
  "codegen.{ts,js,mts,mjs,cts,cjs,yml,yaml}",
  "codegen-*.{ts,js,mts,mjs,cts,cjs,yml,yaml}",
  "**/codegen.{ts,js,mts,mjs,cts,cjs,yml,yaml}",
  "**/codegen-*.{ts,js,mts,mjs,cts,cjs,yml,yaml}",
];

const DOCUMENTS_ARRAY_PATTERN = /^[ \t]*documents\s*:\s*\[([\s\S]*?)\]/gm;
const DOCUMENTS_STRING_PATTERN = /^[ \t]*documents\s*:\s*['"`]([^'"`\n]+)['"`]/gm;
const SCHEMA_ARRAY_PATTERN = /^[ \t]*schema\s*:\s*\[([\s\S]*?)\]/gm;
const SCHEMA_STRING_PATTERN = /^[ \t]*schema\s*:\s*['"`]([^'"`\n]+)['"`]/gm;
const QUOTED_STRING_PATTERN = /['"`]([^'"`\n]+)['"`]/g;
const DOCUMENTS_YAML_BLOCK_PATTERN = /^[ \t]*documents\s*:\s*(?:#.*)?$/;
const SCHEMA_YAML_BLOCK_PATTERN = /^[ \t]*schema\s*:\s*(?:#.*)?$/;
const YAML_LIST_ITEM_PATTERN = /^[ \t]*-[ \t]*(.+)$/;
const GENERATES_PROPERTY_PATTERN = /^[ \t]*generates\s*:\s*(?:\{\s*)?(?:#.*)?$/;
const GENERATED_OUTPUT_KEY_PATTERN = /^(?:(["'`])(.*?)\1|([^:]+?))\s*:/;
const GENERATES_OBJECT_PATTERN = /\bgenerates\s*:\s*\{/g;

export interface GraphqlCodegenEntries {
  documentEntries: string[];
  generatedEntries: string[];
  schemaEntries: string[];
}

const collectCodegenPatterns = (
  content: string,
  arrayPropertyPattern: RegExp,
  stringPropertyPattern: RegExp,
): string[] => {
  const patterns: string[] = [];

  for (const propertyMatch of content.matchAll(arrayPropertyPattern)) {
    for (const valueMatch of propertyMatch[1].matchAll(QUOTED_STRING_PATTERN)) {
      patterns.push(valueMatch[1]);
    }
  }

  for (const propertyMatch of content.matchAll(stringPropertyPattern)) {
    patterns.push(propertyMatch[1]);
  }

  return patterns.filter(
    (pattern) =>
      !pattern.includes("://") && !pattern.startsWith("@") && !pattern.startsWith("node:"),
  );
};

const extractYamlListValue = (rawValue: string): string | undefined => {
  const trimmedValue = rawValue.trim();
  const quotedValueMatch = trimmedValue.match(/^(['"])(.*?)\1(?:\s+#.*)?$/);
  if (quotedValueMatch) return quotedValueMatch[2];

  const inlineCommentIndex = trimmedValue.search(/\s+#/);
  const value = (
    inlineCommentIndex === -1 ? trimmedValue : trimmedValue.slice(0, inlineCommentIndex)
  ).trim();
  return value.length > 0 ? value : undefined;
};

const collectYamlBlockPatterns = (content: string, propertyPattern: RegExp): string[] => {
  const patterns: string[] = [];
  let propertyIndent: number | undefined;

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) continue;

    const lineIndent = line.length - line.trimStart().length;
    if (propertyIndent !== undefined && lineIndent > propertyIndent) {
      const listItemMatch = line.match(YAML_LIST_ITEM_PATTERN);
      const listValue = listItemMatch ? extractYamlListValue(listItemMatch[1]) : undefined;
      if (listValue) patterns.push(listValue);
      continue;
    }

    propertyIndent = propertyPattern.test(line) ? lineIndent : undefined;
  }

  return patterns.filter(
    (pattern) =>
      !pattern.includes("://") && !pattern.startsWith("@") && !pattern.startsWith("node:"),
  );
};

const resolveCodegenPatterns = (patterns: string[], configDirectory: string): string[] =>
  fg.sync(patterns, {
    cwd: configDirectory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });

const extractGeneratedOutputKey = (line: string): string | undefined => {
  const match = line.trim().match(GENERATED_OUTPUT_KEY_PATTERN);
  const outputPath = (match?.[2] ?? match?.[3])?.trim();
  if (
    !outputPath ||
    outputPath.includes("://") ||
    outputPath.startsWith("@") ||
    outputPath.startsWith("node:") ||
    outputPath.includes("*") ||
    outputPath.includes("?")
  ) {
    return undefined;
  }
  return outputPath;
};

const collectGeneratedObjectOutputPatterns = (content: string): string[] => {
  const outputPatterns: string[] = [];
  const syntaxContent = maskJavaScriptStringsAndComments(content);
  GENERATES_OBJECT_PATTERN.lastIndex = 0;
  let generatesMatch: RegExpExecArray | null;
  while ((generatesMatch = GENERATES_OBJECT_PATTERN.exec(syntaxContent)) !== null) {
    const openBraceIndex = content.indexOf("{", generatesMatch.index);
    let braceDepth = 1;
    let quote: string | undefined;
    let quoteStart = 0;
    let isEscaped = false;
    let isLineComment = false;
    let isBlockComment = false;

    for (let position = openBraceIndex + 1; position < content.length; position++) {
      const character = content[position];
      const nextCharacter = content[position + 1];
      if (isLineComment) {
        if (character === "\n") isLineComment = false;
        continue;
      }
      if (isBlockComment) {
        if (character === "*" && nextCharacter === "/") {
          isBlockComment = false;
          position++;
        }
        continue;
      }
      if (quote) {
        if (isEscaped) {
          isEscaped = false;
        } else if (character === "\\") {
          isEscaped = true;
        } else if (character === quote) {
          if (braceDepth === 1) {
            let nextTokenPosition = position + 1;
            while (/\s/.test(content[nextTokenPosition] ?? "")) nextTokenPosition++;
            if (content[nextTokenPosition] === ":") {
              const outputPath = extractGeneratedOutputKey(
                content.slice(quoteStart, nextTokenPosition + 1),
              );
              if (outputPath) outputPatterns.push(outputPath);
            }
          }
          quote = undefined;
        }
        continue;
      }
      if (character === "/" && nextCharacter === "/") {
        isLineComment = true;
        position++;
        continue;
      }
      if (character === "/" && nextCharacter === "*") {
        isBlockComment = true;
        position++;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        quoteStart = position;
        continue;
      }
      if (character === "{") braceDepth++;
      if (character === "}") braceDepth--;
      if (braceDepth === 0) break;
    }
  }
  return outputPatterns;
};

const collectGeneratedOutputPatterns = (content: string): string[] => {
  const outputPatterns = collectGeneratedObjectOutputPatterns(content);
  let generatesIndent: number | undefined;
  let outputIndent: number | undefined;

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("//") || trimmedLine.startsWith("#")) {
      continue;
    }

    const lineIndent = line.length - line.trimStart().length;
    if (generatesIndent === undefined) {
      if (GENERATES_PROPERTY_PATTERN.test(line)) generatesIndent = lineIndent;
      continue;
    }

    if (lineIndent <= generatesIndent) {
      generatesIndent = GENERATES_PROPERTY_PATTERN.test(line) ? lineIndent : undefined;
      outputIndent = undefined;
      continue;
    }

    const outputPath = extractGeneratedOutputKey(line);
    if (!outputPath) continue;
    if (outputIndent === undefined) outputIndent = lineIndent;
    if (lineIndent === outputIndent) outputPatterns.push(outputPath);
  }

  return outputPatterns;
};

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
      const content = readFileSync(configPath, "utf-8")
        .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\r?$/gm, "")
        .replace(/^[ \t]*(?:\/\/|#).*$/gm, "");
      const configDirectory = dirname(configPath);
      const documentPatterns = collectCodegenPatterns(
        content,
        DOCUMENTS_ARRAY_PATTERN,
        DOCUMENTS_STRING_PATTERN,
      );
      const schemaPatterns = collectCodegenPatterns(
        content,
        SCHEMA_ARRAY_PATTERN,
        SCHEMA_STRING_PATTERN,
      );
      const generatedOutputPatterns = collectGeneratedOutputPatterns(content);
      if (configPath.endsWith(".yml") || configPath.endsWith(".yaml")) {
        documentPatterns.push(...collectYamlBlockPatterns(content, DOCUMENTS_YAML_BLOCK_PATTERN));
        schemaPatterns.push(...collectYamlBlockPatterns(content, SCHEMA_YAML_BLOCK_PATTERN));
      }
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
