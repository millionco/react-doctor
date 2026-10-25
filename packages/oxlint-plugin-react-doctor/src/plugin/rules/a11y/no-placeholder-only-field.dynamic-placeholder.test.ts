import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPlaceholderOnlyField } from "./no-placeholder-only-field.js";

interface DynamicPlaceholderCase {
  readonly name: string;
  readonly code: string;
  readonly expectedDiagnostics: number;
}

const dynamicPlaceholderCases: ReadonlyArray<DynamicPlaceholderCase> = [
  {
    name: "literal prefix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={'Search ' + query} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "literal suffix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={count + ' results'} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "nested addition suffix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={(count + query) + ' entries'} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "nested addition inner suffix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={count + (query + ' entries')} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "nested addition prefix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={('Search ' + prefix) + suffix} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "unknown call with separate literal suffix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={format(query) + ' entries'} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "template prefix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={`Search ${query}`} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "template suffix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={`${count} results`} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "template middle",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={`${prefix} matching ${suffix}`} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "nonempty cooked escape template",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={`\\u0046ind ${query}`} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "nonempty escaped literal",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={'\\u0046ind ' + query} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "template affix within addition",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={query + `${count} entries`} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "parenthesized addition",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={((count + ' records'))} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "TypeScript as wrapper",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={((count + ' records') as string)} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "TypeScript satisfies wrapper",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={((count + ' records') satisfies string)} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "TypeScript nonnull wrapper",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={((count + ' records')!)} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "whitespace before literal word",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={' \\t' + ('results' + query)} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "no identifier inference",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={query} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "no unknown call inference",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={format(query)} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "empty literal",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={''} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "only escaped whitespace literal",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={'\\t\\u00a0\\ufeff'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "only escaped whitespace suffix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={count + '\\t\\u00a0'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "only escaped whitespace prefix",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={'\\n\\r ' + query} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "only escaped cooked template whitespace",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={`\\n${query}\\u0020`} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "only template substitution",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={`${query}`} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "only multiple template substitutions",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={`${prefix}${suffix}`} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "literal inside substitution is not a quasi",
    code: 'const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={`${"Search"}`} />;',
    expectedDiagnostics: 0,
  },
  {
    name: "no tagged template inference",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={format`Search ${query}`} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "no conditional widening",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={flag ? 'Search' : query} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "no logical widening",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={query || 'Search'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "no conditional leaf descent",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={(flag ? 'Search' : '') + query} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "no nullish leaf descent",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={(prefix ?? 'Search') + query} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "no multiplication leaf descent",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={('Search' * count) + query} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "no array coercion inference",
    code: "const SearchField = ({ count, query, prefix, suffix, flag }) => <input placeholder={['Search'] + query} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "no const binding inference",
    code: "const hint = 'Search'; const SearchField = () => <input placeholder={hint} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "native explicit label",
    code: "const SearchField = ({ count }) => <><label htmlFor='query'>Search</label><input id='query' placeholder={count + ' results'} /></>;",
    expectedDiagnostics: 0,
  },
  {
    name: "native wrapping label",
    code: "const SearchField = ({ count }) => <label>Search<input placeholder={`${count} results`} /></label>;",
    expectedDiagnostics: 0,
  },
  {
    name: "named ARIA field",
    code: "const SearchField = ({ count }) => <input aria-label='Search' placeholder={count + ' results'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "ARIA labelledby field",
    code: "const SearchField = ({ count }) => <><span id='query-label'>Search</span><input aria-labelledby='query-label' placeholder={count + ' results'} /></>;",
    expectedDiagnostics: 0,
  },
  {
    name: "possibly supplied ARIA field",
    code: "const SearchField = ({ count, label }) => <input aria-label={label} placeholder={count + ' results'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "unknown spread after affix",
    code: "const SearchField = ({ count, field }) => <input placeholder={count + ' results'} {...field} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "unknown spread before affix",
    code: "const SearchField = ({ count, field }) => <input {...field} placeholder={count + ' results'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "irrelevant inline spread",
    code: "const SearchField = ({ count }) => <input {...{className:'field'}} placeholder={count + ' results'} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "effective ARIA after spread",
    code: "const SearchField = ({ count, field }) => <input {...field} aria-label='Search' placeholder={count + ' results'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "known text attributes after spread",
    code: "const SearchField = ({ count, field }) => <input {...field} aria-label='' aria-labelledby='' type='text' id={null} placeholder={count + ' results'} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "hidden field ancestor",
    code: "const SearchField = ({ count }) => <div hidden><input placeholder={count + ' results'} /></div>;",
    expectedDiagnostics: 0,
  },
  {
    name: "nontext input",
    code: "const SearchField = ({ count }) => <input type='checkbox' placeholder={count + ' results'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "unknown input type",
    code: "const SearchField = ({ count, type }) => <input type={type} placeholder={count + ' results'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "unknown field id",
    code: "const SearchField = ({ count, id }) => <input id={id} placeholder={count + ' results'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "custom component",
    code: "const SearchField = ({ count }) => <Field placeholder={count + ' results'} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "textarea affix",
    code: "const SearchField = ({ count }) => <textarea placeholder={`${count} notes`} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "last placeholder unknown",
    code: "const SearchField = ({ count, hint }) => <input placeholder={count + ' results'} placeholder={hint} />;",
    expectedDiagnostics: 0,
  },
  {
    name: "last placeholder affixed",
    code: "const SearchField = ({ count, hint }) => <input placeholder={hint} placeholder={count + ' results'} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "label in different owner",
    code: "const SearchLabel = () => <label htmlFor='query'>Search</label>; const SearchField = ({ count }) => <input id='query' placeholder={count + ' results'} />;",
    expectedDiagnostics: 1,
  },
  {
    name: "conditional label exclusion",
    code: "const SearchField = ({ count, showLabel }) => showLabel ? <label htmlFor='query'>Search</label> : <input id='query' placeholder={count + ' results'} />;",
    expectedDiagnostics: 1,
  },
];

describe("no-placeholder-only-field literal-affixed expressions", () => {
  it.each(dynamicPlaceholderCases)("$name", ({ code, expectedDiagnostics }) => {
    const result = runRule(noPlaceholderOnlyField, code, { filename: "src/search-field.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});
