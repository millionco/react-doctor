import * as fs from "node:fs";
import picomatch from "picomatch";
import { DISABLED_LINGUIST_ATTRIBUTE_VALUES } from "./constants.js";

interface LinguistPathRule {
  matches: (filePath: string) => boolean;
  attributes: Map<string, boolean>;
}

const LINGUIST_ATTRIBUTE_PATTERN = /^([-!]?)(linguist-(?:vendored|generated))(?:=(.*))?$/;

export const parseGitattributesLinguistPaths = (
  filePath: string,
  relativePaths: ReadonlyArray<string>,
): string[] => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const rules: LinguistPathRule[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const parts = /^("(?:\\.|[^"\\])*"|\S+)\s+(.*)$/.exec(line);
    if (!parts) continue;
    let pathSpec = parts[1];
    if (pathSpec.startsWith('"')) {
      try {
        pathSpec = JSON.parse(pathSpec);
      } catch {
        continue;
      }
    }
    if (!pathSpec || pathSpec.startsWith("!") || pathSpec.endsWith("/")) continue;
    const tokens = parts[2].split(/\s+/);
    const attributes = new Map<string, boolean>();
    for (const token of tokens) {
      const match = LINGUIST_ATTRIBUTE_PATTERN.exec(token);
      if (!match) continue;
      const [, prefix, attribute, value] = match;
      if (prefix && value !== undefined) continue;
      attributes.set(
        attribute,
        !prefix &&
          (value === undefined || !DISABLED_LINGUIST_ATTRIBUTE_VALUES.has(value.toLowerCase())),
      );
    }
    if (attributes.size === 0) continue;
    rules.push({
      matches: picomatch(
        pathSpec
          .replace(/^\//, "")
          .replace(/\\.|[()|]/g, (token) => (token.startsWith("\\") ? token : `\\${token}`)),
        {
          dot: true,
          basename: !pathSpec.includes("/"),
          nobrace: true,
          noext: true,
          nonegate: true,
          regex: false,
        },
      ),
      attributes,
    });
  }
  return relativePaths.filter((relativePath) => {
    const attributes = new Map<string, boolean>();
    for (const rule of rules) {
      if (!rule.matches(relativePath)) continue;
      for (const [attribute, value] of rule.attributes) attributes.set(attribute, value);
    }
    return [...attributes.values()].some(Boolean);
  });
};
