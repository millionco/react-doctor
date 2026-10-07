import { extractPackageName } from "./package-name.js";
import { stripCoffeeScriptComment } from "./strip-coffee-script-comment.js";

const BINDING_GYP_REQUIRE_PATTERN =
  /<!@?\(\s*node\s+(?:-p|--print)\s+\\?["']\s*require\(\s*\\?["']([^"'\\]+)\\?["']\s*\)\.(?:gyp|include|include_dir|targets)\s*\\?["']\s*\)/g;

export const collectBindingGypPackageReferences = (content: string): Set<string> => {
  const packageNames = new Set<string>();
  const executableContent = content
    .split("\n")
    .map(stripCoffeeScriptComment)
    .map((line) => {
      let quote = "";
      for (let characterIndex = 0; characterIndex < line.length - 1; characterIndex++) {
        const character = line[characterIndex];
        if (character === "\\") {
          characterIndex++;
          continue;
        }
        if (quote) {
          if (character === quote) quote = "";
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }
        if (character === "/" && line[characterIndex + 1] === "/") {
          return line.slice(0, characterIndex);
        }
      }
      return line;
    })
    .join("\n");

  for (const match of executableContent.matchAll(BINDING_GYP_REQUIRE_PATTERN)) {
    if (!match[1]) continue;
    const packageName = extractPackageName(match[1]);
    if (packageName) packageNames.add(packageName);
  }

  return packageNames;
};
