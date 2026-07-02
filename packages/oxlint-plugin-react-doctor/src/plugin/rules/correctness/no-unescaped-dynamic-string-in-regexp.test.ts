import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnescapedDynamicStringInRegexp } from "./no-unescaped-dynamic-string-in-regexp.js";

describe("no-unescaped-dynamic-string-in-regexp", () => {
  it("flags a search term dropped straight into RegExp", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const search = params.get('search') ?? '';
       const matcher = new RegExp(search, 'i');`,
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
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a template pattern composed with a query term", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const regex = new RegExp('(^|\\\\s)' + queryString, 'i');`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a highlight prop passed to RegExp without new", () => {
    const result = runRule(noUnescapedDynamicStringInRegexp, `const re = RegExp(highlight, 'gi');`);
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
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a value escaped before construction", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const escaped = escapeRegExp(query);
       const re = new RegExp(escaped, 'gi');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inline escapeRegExp in the same expression", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(escapeRegExp(searchTerm), 'gi');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a known-safe constant source", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(SAFE_TOKEN_SOURCE, 'g');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-literal pattern", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp('\\\\d+', 'g');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a source composed of other RegExp .source constants", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(ANSI_PATTERN.source + OSC_PATTERN.source, 'g');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an escaped value whose name keeps the search word (escapedQuery idiom)", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const escapedQuery = escapeRegExp(query);
       const re = new RegExp(escapedQuery, 'gi');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a filter escaped on a prior line into a differently-named binding", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const resultFilter = escapeRegExp(filter);
       const re = new RegExp(resultFilter, 'i');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a term sanitized via replaceAll on the preceding line (MDN escape idiom)", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      String.raw`const escapedSearchString = searchString.replaceAll(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
       const re = new RegExp(escapedSearchString, 'i');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the ES2025 RegExp.escape builtin", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(RegExp.escape(searchTerm), 'gi');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a provably-literal local constant whose name contains a search word", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const QUERY_SEPARATOR = '[?&]';
       const re = new RegExp(QUERY_SEPARATOR, 'g');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag recomposition from an existing regex's .source", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(searchWordRegex.source, 'gi');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag names where 'term' is only a substring (terminalSequence)", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(terminalSequence, 'g');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a two-hop chain back to an escaped binding", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const escaped = escapeRegExp(query);
       const searchPattern = escaped;
       const re = new RegExp(searchPattern, 'gi');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a search term interpolated into a template pattern (grid highlight idiom)", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      "const regex = new RegExp(`(${searchTerm})`, 'gi');",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary initializer composed entirely from escaped bindings", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      "const escapedFilter = escapeRegExp(filter);\n" +
        "const resultFilter = matchWholeWord ? `\\\\b${escapedFilter}\\\\b` : escapedFilter;\n" +
        "const regExp = new RegExp(resultFilter, flags);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a template initializer wrapping an escaped binding", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      "const escapedQuery = escapeRegExp(query);\n" +
        "const queryPattern = `^${escapedQuery}`;\n" +
        "const re = new RegExp(queryPattern, 'i');",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a ternary initializer where one branch is a raw search term", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      "const escapedFilter = escapeRegExp(filter);\n" +
        "const resultFilter = matchWholeWord ? escapedFilter : filter;\n" +
        "const regExp = new RegExp(resultFilter, flags);",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a raw query concatenated next to an escaped prefix", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const re = new RegExp(escapeRegExp(prefix) + query, 'i');`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
