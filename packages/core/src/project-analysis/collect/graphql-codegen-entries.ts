import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import fg from "fast-glob";
import { GRAPHQL_CODEGEN_CONFIG_SCAN_MAX_DEPTH } from "../constants.js";

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

export interface GraphqlCodegenEntries {
  documentEntries: string[];
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

export const extractGraphqlCodegenEntries = (directory: string): GraphqlCodegenEntries => {
  const documentEntries = new Set<string>();
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
    } catch {
      continue;
    }
  }

  return { documentEntries: [...documentEntries], schemaEntries: [...schemaEntries] };
};
