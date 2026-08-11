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
