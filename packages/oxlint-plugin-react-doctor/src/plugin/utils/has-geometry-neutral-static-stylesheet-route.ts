import {
  STOCK_GATSBY_MAX_STYLESHEET_BYTES,
  STOCK_GATSBY_MAX_STYLESHEET_FILES,
} from "../constants/design.js";

interface StaticStylesheetContext {
  readCss(absolutePath: string): string | null;
  resolveCss(from: string, relative: string): string | null;
}
const PAINT = new Set([
  "color",
  "background",
  "background-color",
  "cursor",
  "font-weight",
  "font-style",
]);
const CODE = new Set([
  "font-family",
  "text-align",
  "white-space",
  "word-spacing",
  "word-break",
  "word-wrap",
  "font-size",
  "line-height",
  "-moz-tab-size",
  "-o-tab-size",
  "tab-size",
  "-webkit-hyphens",
  "-moz-hyphens",
  "-ms-hyphens",
  "hyphens",
  "padding",
  "margin",
  "overflow",
  "border-radius",
]);
const HTML = new Set([
  "font-family",
  "-ms-text-size-adjust",
  "-webkit-text-size-adjust",
  "text-rendering",
  "-webkit-font-smoothing",
  "-moz-osx-font-smoothing",
]);
const codeSelector = (s: string): boolean =>
  /^(?::not\(pre\)\s*>\s*)?(?:code|pre)\[class\*="language-"\]$/.test(s);
const tokenSelector = (s: string): boolean => /^\.token\.[a-z][a-z-]*$/.test(s);
const safeValue = (s: string): boolean =>
  s.length > 0 &&
  !/[{};@\\!<>]/.test(s) &&
  !/\b(?:var|env|attr|expression|url)\s*\(/i.test(s) &&
  /^[\w\s#.,%+'"-]+$/.test(s);
const declarationsAreNeutral = (selectors: readonly string[], body: string): boolean => {
  if (!selectors.length || !body.trim()) return false;
  for (const raw of body.split(";")) {
    if (!raw.trim()) continue;
    const match = /^\s*(-?[a-z][a-z-]*)\s*:\s*([^:]+?)\s*$/i.exec(raw);
    if (!match) return false;
    const property = match[1]?.toLowerCase();
    const value = match[2]?.trim();
    if (!property || !value) return false;
    for (const selector of selectors) {
      if (selector === "html") {
        if (!HTML.has(property) || !safeValue(value)) return false;
      } else if (selector === "body") {
        // These ancestor-only declarations cannot change the proven fixed px subject boxes.
        if (property === "background-image") {
          if (!/^url\("\.\.\/[a-z0-9_./-]+\.png"\)$/.test(value)) return false;
        } else if (
          !(property === "margin" && value === "0") &&
          !(property === "position" && value === "relative") &&
          !(property === "padding-top" && /^\d+px$/.test(value)) &&
          !(property === "background-size" && /^\d+px \d+px$/.test(value)) &&
          !(property === "background-color" && /^#[\da-f]{3,8}$/i.test(value))
        )
          return false;
      } else if (selector === "*" || selector === "*:before" || selector === "*:after") {
        if (property !== "box-sizing" || value !== "border-box") return false;
      } else if (codeSelector(selector)) {
        if (!(PAINT.has(property) || CODE.has(property)) || !safeValue(value)) return false;
      } else if (tokenSelector(selector)) {
        if (!PAINT.has(property) || !safeValue(value)) return false;
      } else return false;
    }
  }
  return true;
};
export const hasGeometryNeutralStaticStylesheetRoute = (
  entry: string,
  context: StaticStylesheetContext,
): boolean => {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (file: string): boolean => {
    if (active.has(file)) return false;
    if (visited.has(file)) return true;
    if (!file.endsWith(".css") || visited.size + active.size >= STOCK_GATSBY_MAX_STYLESHEET_FILES)
      return false;
    const input = context.readCss(file);
    if (
      input === null ||
      input.length > STOCK_GATSBY_MAX_STYLESHEET_BYTES ||
      input.includes("\\") ||
      input.includes("\0")
    )
      return false;
    // Comments cannot nest; reject unterminated comments rather than stripping to EOF.
    if (/\/\*[^]*$/.test(input) && input.lastIndexOf("/*") > input.lastIndexOf("*/")) return false;
    let css = input.replace(/\/\*[^]*?\*\//g, "").trim();
    active.add(file);
    while (css.startsWith("@import")) {
      const match = /^@import\s+(["'])(\.\/[a-zA-Z0-9_./-]+\.css)\1\s*;\s*/.exec(css);
      if (!match?.[2]) return false;
      const request = match[2];
      if (request.split("/").includes("..")) return false;
      const target = context.resolveCss(file, request);
      if (!target || !visit(target)) return false;
      css = css.slice(match[0].length).trim();
    }
    if (css.includes("@") || css.includes("/*") || css.includes("*/")) return false;
    while (css) {
      const block = /^([^{}]+)\{([^{}]*)\}\s*/.exec(css);
      if (!block?.[1] || block[2] === undefined) return false;
      const selectors = block[1].split(",").map((s) => s.trim());
      if (!declarationsAreNeutral(selectors, block[2])) return false;
      css = css.slice(block[0].length).trim();
    }
    active.delete(file);
    visited.add(file);
    return true;
  };
  return visit(entry);
};
