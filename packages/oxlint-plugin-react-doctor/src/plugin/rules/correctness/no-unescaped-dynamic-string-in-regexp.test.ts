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

  it("flags TypeScript-wrapped RegExp constructors and calls", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const first = new (RegExp as RegExpConstructor)(searchTerm, "i");
      const second = (RegExp as RegExpConstructor)(filterQuery, "i");`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a try/catch-guarded regex-input UI because catching syntax errors does not prevent over-matching", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `try {
        new RegExp(searchPattern);
        setError(null);
      } catch {
        setError('Invalid pattern');
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a shadowed local RegExp constructor", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `function build(query) { const RegExp = (value) => value; return RegExp(query); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a fake regex validation that permits metacharacters", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `function build(query) { if (/./.test(query)) return new RegExp(query); return null; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a pattern accepted by the imported regexp validator", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `import { isValidRegexp } from "lib/utils/regexp";
      function replace(path, filter) {
        const isValidRegex = isValidRegexp(filter.regex ?? "");
        if (isValidRegex) return path.replace(new RegExp(filter.regex ?? "", "gi"), "");
        return path;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a pattern after the imported regexp validator rejects invalid input", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `import { isValidRegexp } from "lib/utils/regexp";
      function replace(path, filter) {
        if (!isValidRegexp(filter.regex ?? "")) return path;
        return path.replace(new RegExp(filter.regex ?? "", "gi"), "");
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a local helper merely named isValidRegexp", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const isValidRegexp = () => true;
      function replace(path, filter) {
        if (!isValidRegexp(filter.regex ?? "")) return path;
        return path.replace(new RegExp(filter.regex ?? "", "gi"), "");
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores search-shaped identifiers in TypeScript type annotations", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const matcher = new RegExp(urls.insightView("([^/]+)" as QueryModel["shortId"]));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags construction in the rejected branch of a safe-character guard", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `function build(query) { if (!/^[A-Za-z0-9_ -]*$/.test(query)) return new RegExp(query); return null; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag recompiling a RegExp object to add a flag", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const globalPattern = searchPattern.global
        ? searchPattern
        : new RegExp(searchPattern, searchPattern.flags + "g");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a raw query when an unrelated shadowed binding with the same name is a RegExp object", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const build = (searchPattern) => new RegExp(searchPattern, "i");
      const readFlags = () => {
        const searchPattern = /fixed/;
        return searchPattern.flags;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an arbitrary replace call that does not escape regex metacharacters", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const matcher = new RegExp(searchTerm.replaceAll(" ", "-"), "i");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag per-element escapeRegExp inside a .map callback", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const buildHighlightMatcher = (searchWords) =>
        new RegExp(searchWords.map((word) => escapeRegExp(word)).join("|"), "gi");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag point-free .map(escapeRegExp)", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const matcher = new RegExp(searchTerms.map(escapeRegExp).join("|"), "gi");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the MDN replace-escape inside a .map callback", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      String.raw`const buildKeywordFilter = (keywords) =>
        new RegExp(
          keywords
            .map((keyword) => {
              const escapedKeyword = keyword.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\$&");
              return "\\b" + escapedKeyword + "\\b";
            })
            .join("|"),
          "i",
        );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-literal keyword-table alternation", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const SQL_KEYWORDS = ["SELECT", "FROM", "WHERE", "JOIN", "LIMIT"];
      const keywordPattern = new RegExp("\\b(" + SQL_KEYWORDS.join("|") + ")\\b", "gi");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .filter(Boolean) in a blessed .source composition", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const combinedPattern = new RegExp(
        [EMAIL_REGEX.source, PHONE_REGEX.source].filter(Boolean).join("|"),
        "g",
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an in-file escape helper with a non-matching name", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      String.raw`const escapeSpecialChars = (value) => value.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\$&");
      const parts = text.split(new RegExp("(" + escapeSpecialChars(query) + ")", "gi"));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a helper that escapes an unrelated value before returning its raw parameter", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const buildPattern = (value) => {
        escapeRegExp("unused");
        return value;
      };
      const matcher = new RegExp(buildPattern(searchTerm), "i");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a helper with one raw return path", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const buildPattern = (value, shouldEscape) => {
        if (shouldEscape) return escapeRegExp(value);
        return value;
      };
      const matcher = new RegExp(buildPattern(searchTerm, enabled), "i");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a self-recursive helper without overflowing", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const sanitize = (value) => sanitize(value);
      const matcher = new RegExp(sanitize(searchTerm), "i");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutually recursive helpers without overflowing", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const sanitizeFirst = (value) => sanitizeSecond(value);
      const sanitizeSecond = (value) => sanitizeFirst(value);
      const matcher = new RegExp(sanitizeFirst(searchTerm), "i");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a block helper whose returned parameter is escaped", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const quotePattern = (value) => {
        const escapedValue = escapeRegExp(value);
        return "^" + escapedValue + "$";
      };
      const first = new RegExp(quotePattern(searchTerm), "i");
      const second = new RegExp(quotePattern(filterQuery), "i");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a term shape-tested by a dominating character-class guard", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const matchesAtWordStart = (value, query) => {
        if (!/^[\\w\\s]*$/.test(query)) return value.includes(query);
        return new RegExp("\\b" + query, "i").test(value);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an imported SCREAMING_SNAKE pattern constant", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `import { SEARCH_TOKEN_PATTERN } from "./constants";
      const tokenMatcher = new RegExp("^" + SEARCH_TOKEN_PATTERN + "$", "u");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an aliased escapeRegExp import", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `import { escapeRegExp as esc } from "lodash";
      const matcher = new RegExp(esc(searchQuery), "i");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal-returning source getter named with search", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const getSearchFieldSource = () => "^field:";
      const matcher = new RegExp(getSearchFieldSource() + "(\\w+)");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag RegExp.escape applied per token in a map", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const matcher = new RegExp(searchTokens.map((token) => RegExp.escape(token)).join("|"), "gi");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a unit-test file exercising a highlight API (innovaccer shape)", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const customRegex = (searchTerm) => new RegExp(\`(\${searchTerm})\`, "i");`,
      { filename: "core/components/organisms/table/__tests__/Table.test.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a Playwright e2e page object under tests/e2e (hyperdx shape)", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `class FilterComponent {
        locate(filterGroupName) {
          return this.page.getByTestId(new RegExp(\`^filter-group-\${filterGroupName}\`));
        }
      }`,
      { filename: "packages/app/tests/e2e/components/FilterComponent.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a private helper whose keyword parameter only receives metacharacter-free literals (lumina shape)", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `function parseLengthAfter(prompt, keyword) {
        const pattern = new RegExp(\`\${keyword}\\\\s+(\\\\d+(?:\\\\.\\\\d+)?)(mm|cm|in|pt|px|em|rem)\`, "i");
        return prompt.match(pattern);
      }
      export function parseAiPromptToSchema(prompt) {
        const margin = parseLengthAfter(prompt, "margin") ?? parseLengthAfter(prompt, "margins");
        const header = parseLengthAfter(prompt, "header");
        const footer = parseLengthAfter(prompt, "footer");
        return { margin, header, footer };
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a parameter regex when a call site passes a dynamic value", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `function highlightMatches(text, searchTerm) {
        return new RegExp(searchTerm, "gi").test(text);
      }
      const matches = highlightMatches(content, userTypedQuery);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a parameter regex when a call-site literal carries metacharacters", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `function matchKeyword(prompt, keyword) {
        return new RegExp(keyword + "\\\\s+", "i").test(prompt);
      }
      const priced = matchKeyword(text, "price (usd)");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an exported function's parameter even when local call sites are literals", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `export function matchKeyword(prompt, keyword) {
        return new RegExp(keyword, "i").test(prompt);
      }
      const inline = matchKeyword(text, "margin");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes a TypeScript-wrapped RegExp.escape call", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const matcher = new RegExp((RegExp.escape as (value: string) => string)(searchTerm), "i");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a shadowed RegExp.escape inside a sanitizer helper", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const normalize = (value) => {
        const RegExp = { escape: (innerValue) => innerValue };
        return RegExp.escape(value);
      };
      const searchPattern = normalize(searchTerm);
      const matcher = new RegExp(searchPattern, "i");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("invalidates an escaped binding after reassignment", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `let escapedSearchTerm = RegExp.escape(searchTerm);
      escapedSearchTerm = searchTerm;
      const matcher = new RegExp(escapedSearchTerm, "i");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a regex guard over a shadowed binding", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const build = (searchTerm) => {
        if (["safe"].some((searchTerm) => /^[\\w ]+$/.test(searchTerm))) {
          return new RegExp(searchTerm, "i");
        }
        return null;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("invalidates a regex shape guard after reassignment", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const build = (searchTerm) => {
        if (!/^[\\w ]+$/.test(searchTerm)) return null;
        searchTerm = readSearchTerm();
        return new RegExp(searchTerm, "i");
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a deferred reassignment invalidate a regex shape guard", () => {
    const result = runRule(
      noUnescapedDynamicStringInRegexp,
      `const build = (searchTerm) => {
        if (!/^[\\w ]+$/.test(searchTerm)) return null;
        queueMicrotask(() => { searchTerm = readSearchTerm(); });
        return new RegExp(searchTerm, "i");
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
