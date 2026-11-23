import * as fs from "node:fs";
import * as path from "node:path";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";

interface GatsbyV1FrontmatterInput {
  readonly siteDirectory: string;
  /**
   * The caller must prove stock Gatsby 1.9.270, the stock filesystem and Remark
   * providers and options, and that this sole dir supplies the effective
   * MarkdownRemark file nodes. Unknown sources must pass null.
   */
  readonly effectiveSourceDirectory: string | null;
  readonly query: string;
  readonly resultField: string;
  readonly frontmatterKey: string;
}

// Ordinary flat GraphQL selection of frontmatter fields. The specific string
// filter is part of the certificate, including whitespace inside the literal.
const DOCS_QUERY =
  /^\s*\{\s*allMarkdownRemark\s*\(\s*filter\s*:\s*\{\s*fileAbsolutePath\s*:\s*\{\s*regex\s*:\s*"\/\/docs\/"\s*\}\s*\}\s*\)\s*\{\s*edges\s*\{\s*node\s*\{\s*fileAbsolutePath\s+frontmatter\s*\{\s*([A-Za-z_][A-Za-z_0-9]*(?:\s+[A-Za-z_][A-Za-z_0-9]*)*)\s*\}\s*\}\s*\}\s*\}\s*\}\s*$/u;
const FRONTMATTER_FIELD = /^([A-Za-z_][A-Za-z_0-9-]*):[ \t]+(.+)$/u;
const ABSOLUTE_LOCAL_ROUTE = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/u;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mkd"]);
const MAX_CENSUS_ENTRIES = 8_192;
const MAX_MARKDOWN_BYTES = 256 * 1024;

const isSelectedQuery = (query: string): boolean => {
  const selection = DOCS_QUERY.exec(query)?.[1]?.split(/\s+/u);
  return Boolean(selection?.includes("path") && new Set(selection).size === selection.length);
};

const isInside = (directory: string, candidate: string): boolean => {
  const relative = path.relative(directory, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const matchesLockedDocsFilter = (filename: string): boolean => {
  // Gatsby 1 prepare-regex splits "//docs/" on slash and compiles the inner
  // string "/docs". The stock filesystem provider presents slash-normalized
  // absolute paths, so this also matches directories such as docs-alternate.
  return filename.replace(/\\/gu, "/").includes("/docs");
};

const readFlatScalar = (field: string): string | null => {
  const value = field.trim();
  // Reject multiline, flow mappings, tags, aliases, anchors and folded YAML.
  if (value.startsWith('"') || value.startsWith("'")) {
    const quoted = /^(["'])([^"'\\\r\n]+)\1$/u.exec(value);
    return quoted?.[2] ?? null;
  }
  if (!value || /^[[\]{},&*!|>@%\x60#?:]/u.test(value) || /:\s|\s#/u.test(value)) return null;
  return value;
};

const readPathFrontmatter = (body: string): string | null => {
  const lines = body.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (line.length === 0) continue;
    const field = FRONTMATTER_FIELD.exec(line);
    if (!field || fields.has(field[1])) return null;
    const value = readFlatScalar(field[2]);
    if (value === null) return null;
    fields.set(field[1], value);
  }
  const route = fields.get("path");
  return route && ABSOLUTE_LOCAL_ROUTE.test(route) && !/^\/index\/?$/iu.test(route) ? route : null;
};

const sameFile = (left: fs.Stats, right: fs.Stats): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;

const readRegularMarkdown = (filename: string, expected: fs.Stats): string | null => {
  recordContentProbe(filename);
  if (!expected.isFile() || expected.size > MAX_MARKDOWN_BYTES) return null;
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!sameFile(expected, fs.fstatSync(fd))) return null;
    const body = fs.readFileSync(fd);
    if (
      body.byteLength !== expected.size ||
      !sameFile(expected, fs.fstatSync(fd)) ||
      !sameFile(expected, fs.lstatSync(filename))
    )
      return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } finally {
    fs.closeSync(fd);
  }
};

/** Filesystem/data counterpart to the narrow Gatsby v1 page-action proof. */
export const readClosedStockGatsbyV1FrontmatterPaths = ({
  siteDirectory,
  effectiveSourceDirectory,
  query,
  resultField,
  frontmatterKey,
}: GatsbyV1FrontmatterInput): readonly string[] | null => {
  if (
    resultField !== "allMarkdownRemark" ||
    frontmatterKey !== "path" ||
    !isSelectedQuery(query) ||
    !effectiveSourceDirectory ||
    !path.isAbsolute(siteDirectory) ||
    !path.isAbsolute(effectiveSourceDirectory)
  )
    return null;

  // This branch supports exactly the private site's one stock src source.
  const logicalSite = path.resolve(siteDirectory);
  const logicalSource = path.resolve(effectiveSourceDirectory);
  if (path.relative(path.join(logicalSite, "src"), logicalSource) !== "") return null;

  try {
    recordExistenceProbe(logicalSite);
    recordExistenceProbe(logicalSource);
    if (!fs.lstatSync(logicalSite).isDirectory() || !fs.lstatSync(logicalSource).isDirectory())
      return null;
    const physicalSite = fs.realpathSync.native(logicalSite);
    const physicalSource = fs.realpathSync.native(logicalSource);
    if (
      !isInside(physicalSite, physicalSource) ||
      path.relative(path.join(physicalSite, "src"), physicalSource) !== ""
    )
      return null;
    // slash@1 does not rewrite extended Win32 or non-ASCII Windows paths.
    if (
      process.platform === "win32" &&
      (/[^ -~]/u.test(logicalSource + physicalSource) ||
        logicalSource.startsWith("\\\\?\\") ||
        physicalSource.startsWith("\\\\?\\"))
    )
      return null;

    const pend = [physicalSource];
    const paths = new Set<string>();
    let entries = 0;
    while (pend.length > 0) {
      const directory = pend.pop()!;
      recordExistenceProbe(directory);
      const before = fs.lstatSync(directory);
      if (!before.isDirectory()) return null;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (++entries > MAX_CENSUS_ENTRIES || entry.name.includes("\\")) return null;
        const filename = path.join(directory, entry.name);
        if (!isInside(physicalSource, filename)) return null;
        const actual = fs.lstatSync(filename);
        if (actual.isSymbolicLink()) return null;
        if (actual.isDirectory()) {
          pend.push(filename);
          continue;
        }
        if (!actual.isFile()) return null;
        if (!MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        const logicalName = path.join(logicalSource, path.relative(physicalSource, filename));
        if (process.platform === "win32" && /[^ -~]/u.test(filename + logicalName)) return null;
        const included = matchesLockedDocsFilter(filename);
        if (matchesLockedDocsFilter(logicalName) !== included) return null;
        if (!included) continue;
        const body = readRegularMarkdown(filename, actual);
        const route = body === null ? null : readPathFrontmatter(body);
        if (route === null || paths.has(route)) return null;
        paths.add(route);
      }
      if (!sameFile(before, fs.lstatSync(directory))) return null;
    }
    return [...paths].sort();
  } catch {
    return null;
  }
};
