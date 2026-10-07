import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import fg from "fast-glob";

const WORDPRESS_ENQUEUE_CALL_PATTERN = /\bwp_enqueue_script\s*\([\s\S]*?\);/g;
const SCRIPT_LITERAL_PATTERN = /["']([^"']+\.(?:[cm]?[jt]sx?))["']/g;

export const extractWordPressScriptEntries = (directory: string): string[] => {
  const entries = new Set<string>();
  const phpFilePaths = fg.sync(["*.php", "**/*.php"], {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/vendor/**"],
  });

  for (const phpFilePath of phpFilePaths) {
    let source: string;
    try {
      source = readFileSync(phpFilePath, "utf8");
    } catch {
      continue;
    }
    let enqueueCallMatch: RegExpExecArray | null;
    WORDPRESS_ENQUEUE_CALL_PATTERN.lastIndex = 0;
    while ((enqueueCallMatch = WORDPRESS_ENQUEUE_CALL_PATTERN.exec(source)) !== null) {
      let scriptLiteralMatch: RegExpExecArray | null;
      SCRIPT_LITERAL_PATTERN.lastIndex = 0;
      while ((scriptLiteralMatch = SCRIPT_LITERAL_PATTERN.exec(enqueueCallMatch[0])) !== null) {
        const scriptPath = resolve(directory, scriptLiteralMatch[1].replace(/^\/+/, ""));
        if (existsSync(scriptPath)) entries.add(scriptPath);
      }
    }
  }

  return [...entries];
};
