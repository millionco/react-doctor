import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";
import { stripCoffeeScriptComment } from "../utils/strip-coffee-script-comment.js";

interface CoffeeScriptRequireFactory {
  methodName: string;
  parameterIndex: number;
  requireTemplate: string;
  parameterName: string;
}

const METHOD_PATTERN = /^(\s*)@([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*[-=]>/;
const REQUIRE_PATTERN = /\brequire\s+["']([^"']*#\{([A-Za-z_$][\w$]*)\}[^"']*)["']/;
const CALL_PATTERN = /^\s*@([A-Za-z_$][\w$]*)\s+(.+)$/;
const STRING_ARGUMENT_PATTERN = /(["'])(.*?)\1/g;
const STATIC_REQUIRE_PATTERN = /\brequire(?:\s*\(\s*|\s+)["']([^"'#]+)["']/g;

const extractFactories = (lines: string[]): CoffeeScriptRequireFactory[] => {
  const factories: CoffeeScriptRequireFactory[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const methodMatch = METHOD_PATTERN.exec(lines[lineIndex]);
    if (!methodMatch) continue;
    const methodIndent = methodMatch[1].length;
    const parameterNames = methodMatch[3].split(",").map((parameter) => parameter.trim());
    for (let bodyLineIndex = lineIndex + 1; bodyLineIndex < lines.length; bodyLineIndex++) {
      const bodyLine = lines[bodyLineIndex];
      if (bodyLine.trim().length === 0) continue;
      const bodyIndent = bodyLine.length - bodyLine.trimStart().length;
      if (bodyIndent <= methodIndent) break;
      const requireMatch = REQUIRE_PATTERN.exec(bodyLine);
      if (!requireMatch) continue;
      const parameterIndex = parameterNames.indexOf(requireMatch[2]);
      if (parameterIndex === -1) continue;
      factories.push({
        methodName: methodMatch[2],
        parameterIndex,
        requireTemplate: requireMatch[1],
        parameterName: requireMatch[2],
      });
    }
  }
  return factories;
};

const extractStringArguments = (source: string): string[] => {
  const argumentsList: string[] = [];
  STRING_ARGUMENT_PATTERN.lastIndex = 0;
  let argumentMatch: RegExpExecArray | null;
  while ((argumentMatch = STRING_ARGUMENT_PATTERN.exec(source)) !== null) {
    argumentsList.push(argumentMatch[2]);
  }
  return argumentsList;
};

export const extractCoffeeScriptRequireEntries = (directory: string): string[] => {
  const entries = new Set<string>();
  const coffeeScriptPaths = fg.sync("**/*.{coffee,cjsx}", {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  });
  for (const coffeeScriptPath of coffeeScriptPaths) {
    let source = "";
    try {
      source = readFileSync(coffeeScriptPath, "utf-8");
    } catch {
      continue;
    }
    const lines = source.split(/\r?\n/).map(stripCoffeeScriptComment);
    for (const line of lines) {
      STATIC_REQUIRE_PATTERN.lastIndex = 0;
      let staticRequireMatch: RegExpExecArray | null;
      while ((staticRequireMatch = STATIC_REQUIRE_PATTERN.exec(line)) !== null) {
        if (!staticRequireMatch[1].startsWith(".")) continue;
        const resolvedEntry = resolveEntryWithExtensions(
          resolve(dirname(coffeeScriptPath), staticRequireMatch[1]),
        );
        if (resolvedEntry) entries.add(resolvedEntry);
      }
    }
    const factories = extractFactories(lines);
    if (factories.length === 0) continue;
    for (const line of lines) {
      const callMatch = CALL_PATTERN.exec(line);
      if (!callMatch) continue;
      const stringArguments = extractStringArguments(callMatch[2]);
      for (const factory of factories) {
        if (factory.methodName !== callMatch[1]) continue;
        const parameterValue = stringArguments[factory.parameterIndex];
        if (!parameterValue) continue;
        const relativePath = factory.requireTemplate.replace(
          `#{${factory.parameterName}}`,
          parameterValue,
        );
        const resolvedEntry = resolveEntryWithExtensions(
          resolve(dirname(coffeeScriptPath), relativePath),
        );
        if (resolvedEntry) entries.add(resolvedEntry);
      }
    }
  }
  return [...entries];
};
