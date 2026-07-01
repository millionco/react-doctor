import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnescapedDynamicStringInRegexp } from "./no-unescaped-dynamic-string-in-regexp.js";

describe("no-unescaped-dynamic-string-in-regexp", () => {
  it("flags a search term dropped straight into RegExp", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const search = params.get('search') ?? '';
       const matcher = new RegExp(search, 'i');`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unescaped user query", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const handleSearch = (query) => {
        const re = new RegExp(query, 'gi');
        return re;
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a template pattern composed with a query term", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const regex = new RegExp('(^|\\\\s)' + queryString, 'i');`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a highlight prop passed to RegExp without new", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = RegExp(highlight, 'gi');`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a try/catch-guarded regex-input UI", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `try {
        new RegExp(searchPattern);
        setError(null);
      } catch {
        setError('Invalid pattern');
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a value escaped before construction", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const escaped = escapeRegExp(query);
       const re = new RegExp(escaped, 'gi');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inline escapeRegExp in the same expression", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(escapeRegExp(searchTerm), 'gi');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a known-safe constant source", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(SAFE_TOKEN_SOURCE, 'g');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-literal pattern", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp('\\\\d+', 'g');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a source composed of other RegExp .source constants", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(ANSI_PATTERN.source + OSC_PATTERN.source, 'g');`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
