import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

const expectFail = (code: string): void => {
  const result = runRule(jsSetMapLookups, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsSetMapLookups, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-set-map-lookups — regressions", () => {
  it("flags `.includes()` against a named array inside a loop", () => {
    expectFail(
      `function f(users, roles){ const a=[]; for(const u of users){ if(roles.includes(u.role)) a.push(u);} return a; }`,
    );
  });

  it("does not flag `.includes()` against a small inline literal array", () => {
    expectPass(
      `function f(users){ const a=[]; for(const u of users){ if(["admin","owner"].includes(u.role)) a.push(u);} return a; }`,
    );
  });

  it("does not flag `.includes()` on a `.join()` result (substring search)", () => {
    expectPass(
      `function f(items, parts){ for (const item of items){ if (parts.join("/").includes("..")){ use(item); } } }`,
    );
  });

  it("flags `.includes()` against a 9-element inline literal array (over threshold)", () => {
    expectFail(
      `function f(users){ const out=[]; for(const u of users){ if(["a","b","c","d","e","f","g","h","i"].includes(u.role)) out.push(u); } return out; }`,
    );
  });

  it("flags `.includes()` against an inline array with spread", () => {
    expectFail(
      `function f(users, extra){ const out=[]; for(const u of users){ if(["a", ...extra].includes(u.role)) out.push(u); } return out; }`,
    );
  });

  it("does not flag an array variable named `key` (documents name-based FN)", () => {
    expectPass(
      `function f(items, key){ const out=[]; for(const item of items){ if(key.includes(item.id)) out.push(item); } return out; }`,
    );
  });

  it("does not flag destructured `pathname.includes(matchPath)` in a for loop (ant-design 404 page)", () => {
    expectPass(
      `function NotFound(pathname, DIRECT_MAP, router){ const directLinks = Object.keys(DIRECT_MAP); for (let i = 0; i < directLinks.length; i += 1) { const matchPath = directLinks[i]; if (pathname.includes(matchPath)) { router.replace(matchPath); } } }`,
    );
  });

  it("does not flag `.includes('{')` with a single-character literal (ant-design semantic-md)", () => {
    expectPass(
      `function parseTemplateUsage(content, importRegex){ const results = []; for (const match of content.matchAll(importRegex)) { const importClause = match[1].trim(); if (importClause.startsWith('{')) { results.push(1); } else if (importClause.includes('{')) { results.push(2); } } return results; }`,
    );
  });

  it("does not flag `.indexOf()` used as a position (ant-design usePositions index-of-minimum)", () => {
    expectPass(
      `function layout(itemHeights, columnCount, verticalGutter){ const columnHeights = new Array(columnCount).fill(0); for (let i = 0; i < itemHeights.length; i += 1) { const [itemKey, itemHeight, itemColumn] = itemHeights[i]; let targetColumnIndex = itemColumn ?? columnHeights.indexOf(Math.min(...columnHeights)); columnHeights[targetColumnIndex] += itemHeight + verticalGutter; } return columnHeights; }`,
    );
  });

  it("flags `.indexOf() !== -1` membership tests in a loop", () => {
    expectFail(
      `function f(users, roles){ const out=[]; for(const u of users){ if(roles.indexOf(u.role) !== -1) out.push(u); } return out; }`,
    );
  });

  it("flags `.indexOf() >= 0` membership tests in a loop", () => {
    expectFail(
      `function f(users, roles){ const out=[]; for(const u of users){ if(roles.indexOf(u.role) >= 0) out.push(u); } return out; }`,
    );
  });

  it("flags `~.indexOf()` membership tests in a loop", () => {
    expectFail(
      `function f(users, roles){ const out=[]; for(const u of users){ if(~roles.indexOf(u.role)) out.push(u); } return out; }`,
    );
  });

  it("does not flag `.indexOf()` assigned as an index position in a loop", () => {
    expectPass(
      `function f(rows, order){ for (const row of rows){ const position = order.indexOf(row.id); row.rank = position; } }`,
    );
  });

  it("flags `.includes()` inside a `.filter()` iteration callback", () => {
    expectFail(
      `function f(tokens, capturedTokenIndices){ return tokens.filter((token, index) => !capturedTokenIndices.includes(index)); }`,
    );
  });

  it("does not flag a receiver resolved to a small literal array through a binding", () => {
    expectPass(
      `function f(rows){ const kinds = ["read", "write", "edit"]; for (const row of rows){ if (kinds.includes(row.kind)) row.ok = true; } }`,
    );
  });

  it("does not flag a SCREAMING_SNAKE_CASE constant receiver", () => {
    expectPass(
      `import { VALID_PAGE_TYPES } from "./types"; function f(entries){ for (const entry of entries){ if (VALID_PAGE_TYPES.includes(entry.pageType)) entry.ok = true; } }`,
    );
  });

  it("does not flag a SCREAMING_SNAKE_CASE constant behind an `as` cast", () => {
    expectPass(
      `import { VALID_PAGE_TYPES } from "./types"; function f(entries){ for (const entry of entries){ if ((VALID_PAGE_TYPES as string[]).includes(entry.pageType)) entry.ok = true; } }`,
    );
  });

  it("does not flag a per-iteration array bound by a destructured for-of", () => {
    expectPass(
      `function f(dbMappings, viewId){ for (const [databaseId, viewIds] of Object.entries(dbMappings)){ if (viewIds.includes(viewId)) return databaseId; } }`,
    );
  });

  it("does not flag a per-item member array inside an iteration callback", () => {
    expectPass(
      `function f(columns, groupId){ return columns.filter((column) => column.parentGroupIds.includes(groupId)); }`,
    );
  });

  it("does not flag a string-array element receiver like `contentLines[i]`", () => {
    expectPass(
      `function f(contentLines, query){ for (let i = 0; i < contentLines.length; i++){ if (contentLines[i].includes(query)) return i; } }`,
    );
  });

  it("does not flag a punctuated template-literal argument (substring search)", () => {
    expectPass(
      `function f(connections, func){ for (const connection of connections){ if (connection.resource.includes(\`\${func}(\`)) return connection; } }`,
    );
  });

  it("does not flag `.indexOf() === 0` prefix checks", () => {
    expectPass(
      `function f(args, envParam){ for (const nextArgument of args){ if (nextArgument.indexOf(envParam) === 0) return nextArgument; } }`,
    );
  });

  it("does not flag a normalize*() call receiver (string-returning helper)", () => {
    expectPass(
      `function f(sources, needle){ return sources.filter((s) => normalizeForMatch(s.chunkText).includes(needle)); }`,
    );
  });

  it("does not flag a split*() call receiver (array rebuilt per call)", () => {
    expectPass(
      `function f(bindings, key){ for (const binding of bindings){ if (splitHotkeyBinding(binding).includes(key)) return binding; } }`,
    );
  });
});
