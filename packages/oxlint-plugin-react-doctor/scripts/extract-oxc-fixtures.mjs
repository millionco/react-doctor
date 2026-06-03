#!/usr/bin/env node
// Reads OXC's per-rule `.rs` source from a sparse-cloned copy of
// `oxc-project/oxc` and emits a TypeScript fixture file per rule, with
// every `pass`/`fail` test-vec entry preserved verbatim.
//
// Usage:
//   node scripts/extract-oxc-fixtures.mjs /tmp/oxc
//
// Output: src/plugin/rules/react-builtins/__fixtures__/<rule>.fixtures.ts
//
// Each emitted module exports:
//   export const passCases: ReadonlyArray<{ code: string; settings?: unknown }>;
//   export const failCases: ReadonlyArray<{ code: string; settings?: unknown }>;
//
// Settings are forwarded as the original OXC `Some(serde_json::json!(...))`
// JSON value (plain JS object/array). Tests can choose to honor them or
// not — most react-doctor ports use a different settings shape, so the
// fixture preserves the data without prescribing how rule tests should
// consume it.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

// Buckets the extractor walks, paired with the OXC `.rs` source
// directories to scan for matching upstream rules.
const BUCKETS = [
  {
    bucket: "react-builtins",
    upstreamSubdirs: ["react", "react_perf"],
  },
  {
    bucket: "a11y",
    upstreamSubdirs: ["jsx_a11y"],
  },
];

const RULES_ROOT = path.join(PACKAGE_ROOT, "src/plugin/rules");

// Per-file helper-fn → embedded-JSON map; populated by
// writeFixturesForRule and consulted by extractOptions inside
// parseEntry. Module-scoped so parseEntry's closure can see it
// without rewriting parseEntry's signature.
let currentHelperMap = new Map();

const collectPortedRules = (bucket) => {
  const portedRules = new Map();
  const bucketDir = path.join(RULES_ROOT, bucket);
  if (!fs.existsSync(bucketDir)) return portedRules;
  for (const fileName of fs.readdirSync(bucketDir)) {
    if (!fileName.endsWith(".ts") || fileName.endsWith(".test.ts")) continue;
    const filePath = path.join(bucketDir, fileName);
    const source = fs.readFileSync(filePath, "utf8");
    const idMatch = source.match(/^\s*id:\s*"([^"]+)",?\s*$/m);
    if (!idMatch) continue;
    portedRules.set(idMatch[1], fileName.replace(/\.ts$/, ""));
  }
  return portedRules;
};

const findOxcRuleFile = (oxcRoot, ruleId, upstreamSubdirs) => {
  const snake = ruleId.replaceAll("-", "_");
  for (const subdir of upstreamSubdirs) {
    const candidate = path.join(oxcRoot, "crates/oxc_linter/src/rules", subdir, `${snake}.rs`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

// Find the `vec![ ... ]` block following a `let <name> = vec!` line (or
// a bare `pass = vec!`). Returns the slice of source between the opening
// bracket of `vec![` and its matching closing bracket — bracket-balanced
// while respecting Rust string literals (regular and raw, with arbitrary
// `#` count).
const findVecBlock = (source, varName) => {
  const headerPattern = new RegExp(`(?:let\\s+)?${varName}\\s*=\\s*vec!\\s*\\[`, "g");
  const headerMatch = headerPattern.exec(source);
  if (!headerMatch) return null;
  const startIndex = headerMatch.index + headerMatch[0].length;
  let depth = 1;
  let cursor = startIndex;

  while (cursor < source.length && depth > 0) {
    const character = source[cursor];

    // Raw string literal: r#"..."# / r##"..."## / etc.
    if (character === "r" && (source[cursor + 1] === '"' || source[cursor + 1] === "#")) {
      let pad = 0;
      while (source[cursor + 1 + pad] === "#") pad += 1;
      if (source[cursor + 1 + pad] === '"') {
        const closer = '"' + "#".repeat(pad);
        const closeIndex = source.indexOf(closer, cursor + 2 + pad);
        if (closeIndex < 0) throw new Error(`Unterminated raw string in ${varName}`);
        cursor = closeIndex + closer.length;
        continue;
      }
    }
    // Regular string literal — handle escaped quotes.
    if (character === '"') {
      cursor += 1;
      while (cursor < source.length && source[cursor] !== '"') {
        if (source[cursor] === "\\") cursor += 2;
        else cursor += 1;
      }
      cursor += 1;
      continue;
    }
    // Char literal `'x'` or `'\n'`
    if (character === "'") {
      // Skip over until the matching `'`. Heuristic: limit to 6 chars.
      const closeIndex = source.indexOf("'", cursor + 1);
      if (closeIndex > cursor && closeIndex - cursor < 8) {
        cursor = closeIndex + 1;
        continue;
      }
    }
    // Line comment
    if (character === "/" && source[cursor + 1] === "/") {
      const newlineIndex = source.indexOf("\n", cursor);
      cursor = newlineIndex < 0 ? source.length : newlineIndex + 1;
      continue;
    }
    // Block comment
    if (character === "/" && source[cursor + 1] === "*") {
      const endIndex = source.indexOf("*/", cursor + 2);
      cursor = endIndex < 0 ? source.length : endIndex + 2;
      continue;
    }

    if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, cursor);
      }
    }
    cursor += 1;
  }
  return null;
};

// Split a vec![...] inner block into top-level comma-separated entries,
// honoring strings, parens, brackets, braces.
const splitTopLevelEntries = (block) => {
  const entries = [];
  let depthSquare = 0;
  let depthParen = 0;
  let depthBrace = 0;
  let cursor = 0;
  let entryStart = 0;

  while (cursor < block.length) {
    const character = block[cursor];

    if (character === "r" && (block[cursor + 1] === '"' || block[cursor + 1] === "#")) {
      let pad = 0;
      while (block[cursor + 1 + pad] === "#") pad += 1;
      if (block[cursor + 1 + pad] === '"') {
        const closer = '"' + "#".repeat(pad);
        const closeIndex = block.indexOf(closer, cursor + 2 + pad);
        cursor = closeIndex + closer.length;
        continue;
      }
    }
    if (character === '"') {
      cursor += 1;
      while (cursor < block.length && block[cursor] !== '"') {
        if (block[cursor] === "\\") cursor += 2;
        else cursor += 1;
      }
      cursor += 1;
      continue;
    }
    if (character === "/" && block[cursor + 1] === "/") {
      const newlineIndex = block.indexOf("\n", cursor);
      cursor = newlineIndex < 0 ? block.length : newlineIndex + 1;
      continue;
    }
    if (character === "/" && block[cursor + 1] === "*") {
      const endIndex = block.indexOf("*/", cursor + 2);
      cursor = endIndex < 0 ? block.length : endIndex + 2;
      continue;
    }
    if (character === "(") depthParen += 1;
    else if (character === ")") depthParen -= 1;
    else if (character === "[") depthSquare += 1;
    else if (character === "]") depthSquare -= 1;
    else if (character === "{") depthBrace += 1;
    else if (character === "}") depthBrace -= 1;

    if (character === "," && depthParen === 0 && depthSquare === 0 && depthBrace === 0) {
      const entryText = block.slice(entryStart, cursor).trim();
      if (entryText.length > 0) entries.push(entryText);
      entryStart = cursor + 1;
    }
    cursor += 1;
  }
  const tail = block.slice(entryStart).trim();
  if (tail.length > 0) entries.push(tail);
  return entries;
};

// Parse a Rust string literal at the start of `source`, returning the
// JavaScript-decoded string and the index just past it.
const parseRustString = (source, startIndex) => {
  let cursor = startIndex;
  // Raw string?
  if (source[cursor] === "r" && (source[cursor + 1] === "#" || source[cursor + 1] === '"')) {
    cursor += 1;
    let pad = 0;
    while (source[cursor] === "#") {
      pad += 1;
      cursor += 1;
    }
    if (source[cursor] !== '"') return null;
    cursor += 1;
    const valueStart = cursor;
    const closer = '"' + "#".repeat(pad);
    const closeIndex = source.indexOf(closer, cursor);
    if (closeIndex < 0) return null;
    return { value: source.slice(valueStart, closeIndex), endIndex: closeIndex + closer.length };
  }
  if (source[cursor] !== '"') return null;
  cursor += 1;
  let decoded = "";
  while (cursor < source.length && source[cursor] !== '"') {
    if (source[cursor] === "\\") {
      const escape = source[cursor + 1];
      switch (escape) {
        case "n":
          decoded += "\n";
          break;
        case "t":
          decoded += "\t";
          break;
        case "r":
          decoded += "\r";
          break;
        case "0":
          decoded += "\0";
          break;
        case '"':
          decoded += '"';
          break;
        case "\\":
          decoded += "\\";
          break;
        case "'":
          decoded += "'";
          break;
        default:
          decoded += escape;
      }
      cursor += 2;
    } else {
      decoded += source[cursor];
      cursor += 1;
    }
  }
  return { value: decoded, endIndex: cursor + 1 };
};

// Extract `serde_json::json!(...)` payload as raw JSON-ish source. We
// capture the contents and let the TypeScript file embed it as a JS
// expression — the macro syntax `json!([{...}])` is already valid JS.
const extractJsonMacro = (source) => {
  const idx = source.indexOf("json!");
  if (idx < 0) return null;
  let cursor = idx + "json!".length;
  if (source[cursor] !== "(" && source[cursor] !== "[") return null;
  const open = source[cursor];
  const close = open === "(" ? ")" : "]";
  cursor += 1;
  let depth = 1;
  const start = cursor;
  while (cursor < source.length && depth > 0) {
    const character = source[cursor];
    if (character === '"') {
      cursor += 1;
      while (cursor < source.length && source[cursor] !== '"') {
        if (source[cursor] === "\\") cursor += 2;
        else cursor += 1;
      }
      cursor += 1;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, cursor);
      }
    }
    cursor += 1;
  }
  return null;
};

// Parse a single entry from the pass/fail vec. Three accepted shapes:
//   1. Bare string literal → { code }
//   2. Tuple `(code, None)` / `(code, None, None)` → { code }
//   3. Tuple `(code, Some(json!(...)))` / longer tuples → { code, options }
//   4. Tuple `(code, Some(json!(...)), Some(json!(settings)))` → { code, options, settings }
const parseEntry = (entry) => {
  const trimmed = entry.trim().replace(/^&/, "");
  // Case 1: bare string literal (raw or regular)
  if (trimmed.startsWith('"') || trimmed.startsWith('r"') || trimmed.startsWith("r#")) {
    const parsed = parseRustString(trimmed, 0);
    if (!parsed) return null;
    return { code: parsed.value };
  }
  // Case 2/3/4: starts with `(`
  if (!trimmed.startsWith("(")) return null;
  const innerSource = trimmed.slice(1, -1).trim();
  // Find the first comma at top level inside the tuple — the code is
  // everything before that comma.
  let depthParen = 0;
  let depthBrace = 0;
  let depthSquare = 0;
  let cursor = 0;
  while (cursor < innerSource.length) {
    const character = innerSource[cursor];
    // skip strings + comments same as splitTopLevelEntries
    if (character === "r" && (innerSource[cursor + 1] === '"' || innerSource[cursor + 1] === "#")) {
      let pad = 0;
      while (innerSource[cursor + 1 + pad] === "#") pad += 1;
      if (innerSource[cursor + 1 + pad] === '"') {
        const closer = '"' + "#".repeat(pad);
        const closeIndex = innerSource.indexOf(closer, cursor + 2 + pad);
        cursor = closeIndex + closer.length;
        continue;
      }
    }
    if (character === '"') {
      cursor += 1;
      while (cursor < innerSource.length && innerSource[cursor] !== '"') {
        if (innerSource[cursor] === "\\") cursor += 2;
        else cursor += 1;
      }
      cursor += 1;
      continue;
    }
    if (character === "(") depthParen += 1;
    else if (character === ")") depthParen -= 1;
    else if (character === "[") depthSquare += 1;
    else if (character === "]") depthSquare -= 1;
    else if (character === "{") depthBrace += 1;
    else if (character === "}") depthBrace -= 1;
    if (character === "," && depthParen === 0 && depthSquare === 0 && depthBrace === 0) break;
    cursor += 1;
  }

  const codeSlice = innerSource.slice(0, cursor).trim();
  const parsed = parseRustString(codeSlice, 0);
  if (!parsed) return null;

  const remainder = innerSource.slice(cursor + 1).trim();
  // Handle multi-element tuples: tuples in OXC's test files can be
  //   (code,)
  //   (code, Some(json!([…])))                    — rule options
  //   (code, options, settings)                   — settings (3rd slot)
  //   (code, options, settings, Some(PathBuf::from("foo.jsx")))  — filename
  const segmentSplit = splitTopLevelEntries(remainder);
  const [optionsSegment, settingsSegment, filenameSegment] = segmentSplit;

  const extractOptions = (segment) => {
    if (!segment) return null;
    if (segment.startsWith("None")) return null;
    if (segment.startsWith("Some(")) {
      // Try direct json! macro first.
      const direct = extractJsonMacro(segment);
      if (direct !== null) return direct;
      // Then try a helper-call match — `Some(name())`.
      const helperMatch = segment.match(/^Some\(\s*([A-Za-z_]\w*)\s*\(\s*\)\s*\)/);
      if (helperMatch && currentHelperMap.has(helperMatch[1])) {
        return currentHelperMap.get(helperMatch[1]);
      }
    }
    return null;
  };

  // PathBuf filename literals look like:
  //   Some(PathBuf::from("foo.jsx"))
  // — extract the inner string for embedding.
  const extractFilename = (segment) => {
    if (!segment) return null;
    if (!segment.startsWith("Some(PathBuf::from(")) return null;
    const startIndex = segment.indexOf('"');
    if (startIndex < 0) return null;
    const closeIndex = segment.indexOf('"', startIndex + 1);
    if (closeIndex < 0) return null;
    return segment.slice(startIndex + 1, closeIndex);
  };

  const optionsRaw = extractOptions(optionsSegment);
  const settingsRaw = extractOptions(settingsSegment);
  const filename = extractFilename(filenameSegment);

  const result = { code: parsed.value };
  if (optionsRaw !== null) result.optionsRaw = optionsRaw;
  if (settingsRaw !== null) result.settingsRaw = settingsRaw;
  if (filename !== null) result.filename = filename;
  return result;
};

// Some OXC test modules define a helper closure / function that
// returns a `serde_json::json!(...)` value and reference it as
// `Some(settings())` (or `Some(other_helper())`) in the test tuple.
// Our `Some(json!(...))` extractor doesn't see those at all.
//
// To recover them, we scan for top-level `fn <name>() ... json!({...})`
// blocks in the source and build a `name → embedded-json` map. Then,
// inside `extractOptions`, we substitute `Some(<name>())` calls with
// the matching JSON inline.
const buildHelperMap = (source) => {
  const helpers = new Map();
  const fnPattern = /fn\s+([A-Za-z_][\w]*)\s*\(\s*\)\s*->[^{]*\{/g;
  let match;
  while ((match = fnPattern.exec(source)) !== null) {
    const fnName = match[1];
    const startIndex = match.index + match[0].length;
    let cursor = startIndex;
    let depth = 1;
    while (cursor < source.length && depth > 0) {
      const character = source[cursor];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      cursor += 1;
    }
    const fnBody = source.slice(startIndex, cursor - 1);
    const jsonValue = extractJsonMacro(fnBody);
    if (jsonValue !== null) helpers.set(fnName, jsonValue);
  }
  return helpers;
};

const writeFixturesForRule = (ruleId, fileBaseName, oxcFilePath, fixturesDir, oxcRoot) => {
  const source = fs.readFileSync(oxcFilePath, "utf8");
  const helperMap = buildHelperMap(source);
  // Make helper map reachable by parseEntry via module scope below.
  currentHelperMap = helperMap;
  const passBlock = findVecBlock(source, "pass");
  const failBlock = findVecBlock(source, "fail");
  if (!passBlock && !failBlock) return false;

  const parseBlock = (block) => {
    if (!block) return [];
    return splitTopLevelEntries(block)
      .map(parseEntry)
      .filter((entry) => entry !== null);
  };
  const passCases = parseBlock(passBlock);
  const failCases = parseBlock(failBlock);

  if (passCases.length === 0 && failCases.length === 0) return false;

  const escapeBacktick = (input) =>
    input.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
  const formatCase = (entry) => {
    const codeLiteral = "`" + escapeBacktick(entry.code) + "`";
    const parts = [`code: ${codeLiteral}`];
    if (entry.optionsRaw !== undefined) parts.push(`oxcOptions: ${entry.optionsRaw}`);
    if (entry.settingsRaw !== undefined) parts.push(`oxcSettings: ${entry.settingsRaw}`);
    if (entry.filename !== undefined) parts.push(`oxcFilename: ${JSON.stringify(entry.filename)}`);
    return `  { ${parts.join(", ")} }`;
  };

  // Compute path relative to OXC's `crates/oxc_linter/src/rules` root
  // so the generated header carries the bucket subdirectory (e.g.
  // `react/no_array_index_key.rs`) instead of just the filename.
  const oxcRulesRoot = path.join(oxcRoot, "crates/oxc_linter/src/rules");
  const upstreamRelative = path.relative(oxcRulesRoot, oxcFilePath).replace(/\\/g, "/");
  const fileContent = `// GENERATED FROM OXC — do not edit by hand. Run \`pnpm gen:fixtures\` to regenerate.
// Source: oxc-project/oxc \`crates/oxc_linter/src/rules/${upstreamRelative}\`
// Each entry is a verbatim port of an OXC \`pass\`/\`fail\` vec entry.
// \`oxcOptions\` (optional) is OXC's first config arg (\`Some(json!([…]))\`),
// preserved as JS for tests that want to translate it. \`oxcSettings\`
// (optional) mirrors the third tuple slot used for plugin settings.

export interface OxcFixture {
  code: string;
  oxcOptions?: unknown;
  oxcSettings?: unknown;
  oxcFilename?: string;
}

export const passCases: ReadonlyArray<OxcFixture> = [
${passCases.map(formatCase).join(",\n")}
];

export const failCases: ReadonlyArray<OxcFixture> = [
${failCases.map(formatCase).join(",\n")}
];
`;

  fs.mkdirSync(fixturesDir, { recursive: true });
  fs.writeFileSync(path.join(fixturesDir, `${fileBaseName}.fixtures.ts`), fileContent);
  return true;
};

const main = () => {
  const oxcRoot = process.argv[2];
  if (!oxcRoot) {
    console.error("Usage: extract-oxc-fixtures.mjs <path-to-oxc-clone>");
    process.exit(1);
  }
  const generated = [];
  const skipped = [];
  for (const { bucket, upstreamSubdirs } of BUCKETS) {
    const fixturesDir = path.join(RULES_ROOT, bucket, "__fixtures__");
    const portedRules = collectPortedRules(bucket);
    for (const [ruleId, fileBaseName] of portedRules.entries()) {
      const oxcFilePath = findOxcRuleFile(oxcRoot, ruleId, upstreamSubdirs);
      if (!oxcFilePath) {
        skipped.push({ bucket, ruleId, reason: "no upstream .rs found" });
        continue;
      }
      const wrote = writeFixturesForRule(ruleId, fileBaseName, oxcFilePath, fixturesDir, oxcRoot);
      if (wrote) generated.push(`${bucket}/${ruleId}`);
      else skipped.push({ bucket, ruleId, reason: "no pass/fail vec found" });
    }
  }
  console.log(`Generated fixtures for ${generated.length} rules.`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} rules:`);
    for (const item of skipped) console.log(`  ${item.bucket}/${item.ruleId} (${item.reason})`);
  }
};

main();
