import fs from "node:fs";

// HACK: `.gitattributes` lines look like `path/spec attr1 attr2=value`.
// GitHub's linguist library reads `linguist-vendored` and
// `linguist-generated` to mark code excluded from language stats —
// exactly what a quality audit should also skip. We support `attr`,
// `attr=true`, and `attr=1` (case-insensitive); `attr=false`/`=0`
// counts as an explicit opt-IN to linting and is NOT treated as
// truthy. The `-attr` git-style "set to false" form is similarly
// excluded.
const LINGUIST_ATTRIBUTE_PATTERN = /^linguist-(?:vendored|generated)(?:=([a-zA-Z0-9]+))?$/i;
const FALSY_VALUES = new Set(["false", "0", "off", "no"]);

const isTruthyLinguistAttribute = (token: string): boolean => {
  const match = LINGUIST_ATTRIBUTE_PATTERN.exec(token);
  if (!match) return false;
  if (match[1] === undefined) return true;
  return !FALSY_VALUES.has(match[1].toLowerCase());
};

export const parseGitattributesLinguistPaths = (filePath: string): string[] => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    // Tokens are whitespace-separated. The first token is the path spec;
    // remaining tokens are attributes. Quoted paths with spaces would
    // need escape handling, but those are extremely rare in real
    // `.gitattributes` files — skip the complication.
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    const [pathSpec, ...attributes] = tokens;
    if (attributes.some(isTruthyLinguistAttribute)) {
      paths.push(pathSpec);
    }
  }
  return paths;
};
