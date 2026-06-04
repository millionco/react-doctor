import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

const collectFiles = (directory) => {
  const entries = readdirSync(directory);
  const files = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (EXTENSIONS.has(extname(fullPath))) files.push(fullPath);
  }
  return files;
};

const parseNamedImport = (source, moduleSpecifier) => {
  const pattern = new RegExp(
    `import\\s+\\{([^}]+)\\}\\s+from\\s+["']${moduleSpecifier.replace(":", "\\:")}["'];?`,
    "g",
  );
  const names = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const imported = match[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const aliasMatch = part.match(/^(\w+)\s+as\s+(\w+)$/);
        if (aliasMatch) return { local: aliasMatch[2], imported: aliasMatch[1] };
        return { local: part, imported: part };
      });
    names.push(...imported);
  }
  return names;
};

const removeNamedImports = (source, moduleSpecifier) => {
  const pattern = new RegExp(
    `import\\s+\\{[^}]+\\}\\s+from\\s+["']${moduleSpecifier.replace(":", "\\:")}["'];?\\n?`,
    "g",
  );
  return source.replace(pattern, "");
};

const hasNamespaceImport = (source, moduleSpecifier, alias) => {
  const pattern = new RegExp(
    `import\\s+\\*\\s+as\\s+${alias}\\s+from\\s+["']${moduleSpecifier.replace(":", "\\:")}["']`,
  );
  return pattern.test(source);
};

const ensureNamespaceImport = (source, moduleSpecifier, alias) => {
  if (hasNamespaceImport(source, moduleSpecifier, alias)) return source;
  const importLine = `import * as ${alias} from "${moduleSpecifier}";\n`;
  const importMatch = source.match(/^((?:import\s.+;\n)*)/);
  if (importMatch) {
    return source.replace(importMatch[1], `${importMatch[1]}${importLine}`);
  }
  return `${importLine}${source}`;
};

const prefixUsages = (source, names, alias) => {
  let result = source;
  for (const { local, imported } of names) {
    const member = imported === local ? local : imported;
    const replacement = `${alias}.${member}`;
    const pattern = new RegExp(`(?<![\\w.])${local}(?=\\s*\\()`, "g");
    result = result.replace(pattern, replacement);
    const memberPattern = new RegExp(`(?<![\\w.])${local}\\.(?=\\w)`, "g");
    result = result.replace(memberPattern, `${replacement}.`);
    const standalonePattern = new RegExp(`(?<![\\w.])${local}(?![\\w.])`, "g");
    result = result.replace(standalonePattern, replacement);
  }
  return result;
};

const convertFile = (filePath) => {
  let source = readFileSync(filePath, "utf8");
  const original = source;

  source = source.replace(
    /import\s+fs\s+from\s+["']node:fs["'];?/g,
    'import * as fs from "node:fs";',
  );
  source = source.replace(
    /import\s+path\s+from\s+["']node:path["'];?/g,
    'import * as path from "node:path";',
  );
  source = source.replace(
    /import\s+\*\s+as\s+Path\s+from\s+["']node:path["'];?/g,
    'import * as path from "node:path";',
  );
  source = source.replace(/\bPath\./g, "path.");

  const fsNames = parseNamedImport(source, "node:fs");
  const pathNames = parseNamedImport(source, "node:path");

  if (fsNames.length > 0) {
    source = removeNamedImports(source, "node:fs");
    source = ensureNamespaceImport(source, "node:fs", "fs");
    source = prefixUsages(source, fsNames, "fs");
  }

  if (pathNames.length > 0) {
    source = removeNamedImports(source, "node:path");
    source = ensureNamespaceImport(source, "node:path", "path");
    source = prefixUsages(source, pathNames, "path");
  }

  source = source.replace(/\n{3,}/g, "\n\n");

  if (source !== original) {
    writeFileSync(filePath, source);
    return true;
  }
  return false;
};

const files = collectFiles(ROOT).filter(
  (filePath) => !filePath.includes("convert-node-imports.mjs"),
);
const changed = files.filter(convertFile);
console.log(`Updated ${changed.length} files`);
