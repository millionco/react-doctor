type Directive = {
  readonly kind: "import" | "use" | "forward" | "config";
  readonly source: string;
  readonly line: number;
};

const LOCAL_STYLE_AT_RULES = new Set([
  "media",
  "supports",
  "keyframes",
  "for",
  "function",
  "return",
  "use",
]);
const LOCAL_STYLE_ASSET_FUNCTION =
  /^(?:url|(?:-webkit-)?image-set|src|unquote|inspect|call|get-function|get-mixin|load-css)\s*\(/iu;
const SASS_INTERPOLATED_NUMBER =
  /^#\{\$[A-Za-z_][A-Za-z0-9_-]*(?:[ \t]+[+*-][ \t]+[0-9]+(?:\.[0-9]+)?)*\}/u;

const readLayoutInterpolation = (text: string, start: number): string | null => {
  const token = SASS_INTERPOLATED_NUMBER.exec(text.slice(start))?.[0];
  if (!token) return null;
  const before = text.slice(text.lastIndexOf("\n", start - 1) + 1, start);
  const after = text.slice(start + token.length);
  return (/^[ \t]*&[ \t]+[a-z][a-z0-9-]*:nth-of-type\([ \t]*$/u.test(before) &&
    /^[ \t]*\)[ \t]*\{/u.test(after)) ||
    (/^[ \t]*animation-delay:[ \t]*$/u.test(before) && /^(?:ms|s)[ \t]*;/u.test(after))
    ? token
    : null;
};

export const readStyleFileDirectives = (
  text: string,
  scss: boolean,
  mode: "default" | "local-sass" = "default",
): Directive[] | null => {
  const localOnly = mode === "local-sass";
  const loops: { readonly variable: string; readonly depth: number }[] = [];
  const assignments = new Set<string>();
  const interpolated = new Set<string>();
  let braces = 0;
  const items: Directive[] = [];
  let line = 1;
  let parentheses = 0;
  for (let start = 0; start < text.length; ) {
    const c = text[start];
    if (c === "\n") {
      line += 1;
      start += 1;
      continue;
    }
    if (text.startsWith("/*", start)) {
      const end = text.indexOf("*/", start + 2);
      if (end < 0) return null;
      line += (text.slice(start, end).match(/\n/g) ?? []).length;
      start = end + 2;
      continue;
    }
    if (scss && text.startsWith("//", start)) {
      if (parentheses !== 0 || text[start - 1] === ":") return null;
      const end = text.indexOf("\n", start + 2);
      start = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"') {
      let end = start + 1;
      for (; end < text.length && text[end] !== c; end++) {
        if (scss && text.startsWith("#{", end)) return null;
        if (text[end] === "\\") end += 1;
        else if (text[end] === "\n") line += 1;
      }
      if (end >= text.length) return null;
      start = end + 1;
      continue;
    }
    if (
      localOnly &&
      (c === "\\" ||
        ((start === 0 || !/[A-Za-z0-9_-]/u.test(text[start - 1] ?? "")) &&
          LOCAL_STYLE_ASSET_FUNCTION.test(text.slice(start))))
    )
      return null;
    if (localOnly) {
      if (c === "{") braces++;
      if (c === "}") {
        if (loops.at(-1)?.depth === braces) loops.pop();
        if (--braces < 0) return null;
      }
      if (c === "$") {
        const assignment = /^\$([A-Za-z_][A-Za-z0-9_-]*)\s*:/u.exec(text.slice(start))?.[1];
        if (assignment) assignments.add(assignment.replaceAll("_", "-"));
      }
    }
    if (scss && text.startsWith("#{", start)) {
      const interpolation = localOnly && readLayoutInterpolation(text, start);
      const variable =
        interpolation &&
        /^#\{\$([A-Za-z_][A-Za-z0-9_-]*)/u.exec(interpolation)?.[1]?.replaceAll("_", "-");
      if (!interpolation || !variable || !loops.some((loop) => loop.variable === variable))
        return null;
      interpolated.add(variable);
      start += interpolation.length;
      continue;
    }
    if (c === "(") parentheses += 1;
    if (c === ")") parentheses -= 1;
    if (parentheses < 0) return null;
    if (c !== "@") {
      start += 1;
      continue;
    }
    const name = /^[A-Za-z-]+/u.exec(text.slice(start + 1))?.[0];
    if (!name || text[start + 1 + name.length] === "\\") return null;
    const lower = name.toLowerCase();
    if (localOnly) {
      if (
        !LOCAL_STYLE_AT_RULES.has(lower) ||
        (!scss && !["media", "supports", "keyframes"].includes(lower)) ||
        (["use", "function"].includes(lower) && (parentheses !== 0 || braces !== 0))
      )
        return null;
      if (lower === "for") {
        const span =
          /^[ \t]+\$([A-Za-z_][A-Za-z0-9_-]*)[ \t]+from[ \t]+([0-9]+)[ \t]+through[ \t]+([0-9]+)[ \t]*\{/u.exec(
            text.slice(start + 1 + name.length),
          );
        if (!span?.[1] || Number(span[2]) > Number(span[3]) || Number(span[3]) > 64) return null;
        loops.push({ variable: span[1].replaceAll("_", "-"), depth: ++braces });
        start += 1 + name.length + span[0].length;
        continue;
      }
    } else if (scss && (lower === "at-root" || lower === "function")) return null;
    if (lower === "config" || lower === "import" || lower === "use" || lower === "forward") {
      const rule = /^\s+(['"])([A-Za-z0-9_@./-]+)\1\s*;/u.exec(text.slice(start + 1 + name.length));
      if (!rule?.[0] || !rule[2]) return null;
      items.push({ kind: lower, source: rule[2], line });
      line += (rule[0].match(/\n/g) ?? []).length;
      start += 1 + name.length + rule[0].length;
    } else {
      start += 1 + name.length;
    }
  }
  return parentheses === 0 &&
    (!localOnly || (braces === 0 && ![...interpolated].some((name) => assignments.has(name))))
    ? items
    : null;
};
