import { dirname, isAbsolute, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import { BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH } from "../constants.js";
import { extractScriptBinaryNames } from "./extract-script-binary-names.js";

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const HTML_LINK_PATTERN = /<link\b[^>]*>/gi;
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

  return [...htmlEntryPaths];
};

const getHtmlAttribute = (tag: string, attributeName: string): string | undefined => {
  const attributePattern = new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return tag.match(attributePattern)?.[2];
};

export const hasHtmlSassStylesheetReference = (rootDirectory: string): boolean => {
  for (const htmlFile of collectParcelHtmlEntryPaths(rootDirectory)) {
    let content: string;
    try {
      content = readFileSync(htmlFile, "utf8");
    } catch {
      continue;
    }

    const commentRanges = [...content.matchAll(HTML_COMMENT_PATTERN)].map((commentMatch) => ({
      start: commentMatch.index,
      end: commentMatch.index + commentMatch[0].length,
    }));
    for (const linkTagMatch of content.matchAll(HTML_LINK_PATTERN)) {
      if (
        commentRanges.some(
          (commentRange) =>
            linkTagMatch.index >= commentRange.start && linkTagMatch.index < commentRange.end,
        )
      ) {
        continue;
      }
      const linkTag = linkTagMatch[0];
      const relation = getHtmlAttribute(linkTag, "rel");
      const href = getHtmlAttribute(linkTag, "href")?.split(/[?#]/, 1)[0];
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
