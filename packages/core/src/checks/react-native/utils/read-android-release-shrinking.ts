import * as fs from "node:fs";
import * as path from "node:path";
import { isFile } from "../../../project-info/index.js";

const ANDROID_APP_BUILD_FILE_NAMES: ReadonlyArray<string> = ["build.gradle", "build.gradle.kts"];
const BUILD_TYPES_BLOCK_PATTERN = /\bbuildTypes\s*\{/g;
const RELEASE_STRING_MARKER = "__RD_RELEASE__";
const RELEASE_BLOCK_PATTERNS: ReadonlyArray<RegExp> = [
  /\brelease\s*\{/g,
  /\b(?:getByName|named)\s*\(\s*(?:["']release["']|__RD_RELEASE__)\s*\)\s*\{/g,
];
const MINIFY_ASSIGNMENT_PATTERN =
  /\b(?:isMinifyEnabled|minifyEnabled)\b\s*(?:\(\s*|=\s*|\s+)([^;}\r\n]+)/g;
const SHRINK_RESOURCES_ASSIGNMENT_PATTERN =
  /\b(?:isShrinkResources|shrinkResources)\b\s*(?:\(\s*|=\s*|\s+)([^;}\r\n]+)/g;

export interface AndroidReleaseShrinking {
  readonly filePath: string;
  readonly hasDisabledMinification: boolean;
  readonly hasDisabledResourceShrinking: boolean;
}

const stripGradleComments = (contents: string): string => {
  let result = "";
  let index = 0;
  let quote: string | null = null;
  while (index < contents.length) {
    const character = contents[index];
    const nextCharacter = contents[index + 1];
    if (quote !== null) {
      result += character;
      if (character === "\\") {
        result += nextCharacter ?? "";
        index += 2;
        continue;
      }
      if (character === quote) quote = null;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      while (index < contents.length && contents[index] !== "\n") {
        result += " ";
        index += 1;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      result += "  ";
      index += 2;
      while (index < contents.length && !(contents[index] === "*" && contents[index + 1] === "/")) {
        result += contents[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < contents.length) {
        result += "  ";
        index += 2;
      }
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
};

const maskGradleStrings = (contents: string): string => {
  let result = "";
  let index = 0;
  let quote: string | null = null;
  while (index < contents.length) {
    const character = contents[index];
    if (quote === null) {
      if (character === '"' || character === "'") {
        quote = character;
        result += " ";
      } else {
        result += character;
      }
      index += 1;
      continue;
    }
    if (character === "\\") {
      result += "  ";
      index += 2;
      continue;
    }
    if (character === quote) quote = null;
    result += character === "\n" ? "\n" : " ";
    index += 1;
  }
  return result;
};

const findBlockContents = (contents: string, pattern: RegExp): ReadonlyArray<string> => {
  const blocks: string[] = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(contents);
  while (match !== null) {
    const openingBraceIndex = pattern.lastIndex - 1;
    let depth = 1;
    let index = openingBraceIndex + 1;
    let quote: string | null = null;
    while (index < contents.length && depth > 0) {
      const character = contents[index];
      if (quote !== null) {
        if (character === "\\") {
          index += 2;
          continue;
        }
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
      }
      index += 1;
    }
    if (depth === 0) blocks.push(contents.slice(openingBraceIndex + 1, index - 1));
    match = pattern.exec(contents);
  }
  return blocks;
};

const getFinalStaticBoolean = (contents: string, pattern: RegExp): boolean | null => {
  pattern.lastIndex = 0;
  let finalValue: boolean | null = null;
  let match = pattern.exec(contents);
  while (match !== null) {
    const staticValue = match[1]?.trim().replace(/\)$/, "").trim();
    if (staticValue === "true") {
      finalValue = true;
    } else if (staticValue === "false") {
      finalValue = false;
    } else {
      finalValue = null;
    }
    match = pattern.exec(contents);
  }
  return finalValue;
};

const getReleaseBlocks = (contents: string): ReadonlyArray<string> =>
  findBlockContents(contents, BUILD_TYPES_BLOCK_PATTERN).flatMap((buildTypesBlock) =>
    RELEASE_BLOCK_PATTERNS.flatMap((pattern) => findBlockContents(buildTypesBlock, pattern)),
  );

export const readAndroidReleaseShrinking = (
  rootDirectory: string,
): AndroidReleaseShrinking | null => {
  for (const buildFileName of ANDROID_APP_BUILD_FILE_NAMES) {
    const filePath = path.posix.join("android", "app", buildFileName);
    const absoluteFilePath = path.join(rootDirectory, filePath);
    if (!isFile(absoluteFilePath)) continue;

    let contents: string;
    try {
      contents = stripGradleComments(fs.readFileSync(absoluteFilePath, "utf-8"));
    } catch {
      return null;
    }

    const blockDetectionContents = maskGradleStrings(
      contents.replace(/(["'])release\1/g, RELEASE_STRING_MARKER),
    );
    const releaseBlocks = getReleaseBlocks(blockDetectionContents);
    const [releaseBlock] = releaseBlocks;
    if (releaseBlock === undefined || releaseBlocks.length !== 1) return null;
    const hasDisabledMinification =
      getFinalStaticBoolean(releaseBlock, MINIFY_ASSIGNMENT_PATTERN) === false;
    const hasDisabledResourceShrinking =
      getFinalStaticBoolean(releaseBlock, SHRINK_RESOURCES_ASSIGNMENT_PATTERN) === false;
    if (!hasDisabledMinification && !hasDisabledResourceShrinking) return null;

    return { filePath, hasDisabledMinification, hasDisabledResourceShrinking };
  }
  return null;
};
