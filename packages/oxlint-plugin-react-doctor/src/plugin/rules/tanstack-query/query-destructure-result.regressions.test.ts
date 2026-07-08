import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryDestructureResult } from "./query-destructure-result.js";
import { queryNoRestDestructuring } from "./query-no-rest-destructuring.js";

describe("tanstack-query/query-destructure-result — regressions", () => {
  // #1082: direct property access is tracked per-field by TanStack Query's
  // proxy, exactly like destructuring — the playground repro must stay silent.
  it("stays silent on the issue-1082 repro: assign then read query.data in JSX", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function Todos() {
  const query = useQuery({ queryKey: ['todos'] });
  return <div>{query.data}</div>;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  // #1082: rest-destructuring is query-no-rest-destructuring's territory.
  // Exactly one of the two rules may claim the two-step rest destructure,
  // or the same line gets reported twice.
  it("does not double-report a two-step rest destructure", () => {
    const twoStepRestDestructure = `import { useQuery } from '@tanstack/react-query';
function C() {
  const query = useQuery({ queryKey: ['todos'] });
  const { data, ...rest } = query;
  return [data, rest];
}`;
    expect(runRule(queryDestructureResult, twoStepRestDestructure).diagnostics).toHaveLength(0);
    expect(runRule(queryNoRestDestructuring, twoStepRestDestructure).diagnostics).toHaveLength(1);
  });

  it("stays silent when the result is assigned and consumed field-by-field in render", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function LoadConfigButton() {
  const backupFileQuery = useQuery({ queryKey: ['backup-file'] });
  if (backupFileQuery.error) return <ErrorBanner error={backupFileQuery.error} />;
  return <pre>{JSON.stringify(backupFileQuery.data)}</pre>;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a custom hook reads data/isLoading/error off the result object", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
export function useSkills(workspaceId) {
  const query = useQuery({ queryKey: ['skills', workspaceId] });
  return { skills: query.data ?? [], skillsIsLoading: query.isLoading, skillsError: query.error };
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a field read feeds a useEffect via a derived binding", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function LoadDefaultConfig() {
  const defaultConfigQuery = useQuery({ queryKey: ['default-connection'] });
  const defaultConnectionConfigs = defaultConfigQuery.data;
  useEffect(() => {
    if (!defaultConnectionConfigs) return;
    applyConfigs(defaultConnectionConfigs);
  }, [defaultConnectionConfigs]);
  return defaultConfigQuery.isLoading ? <Spinner /> : null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent for an infinite query consumed via property access", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useInfiniteQuery } from '@tanstack/react-query';
function GroupChat() {
  const history = useInfiniteQuery({ queryKey: ['messages'] });
  return (
    <List
      pages={history.data?.pages}
      hasMore={history.hasNextPage}
      onLoadMore={() => history.fetchNextPage()}
    />
  );
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the whole query is returned from a custom hook", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; export function useUser(id) { const query = useQuery({ queryKey: ['user', id] }); return query; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the whole query is forwarded as a JSX prop", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; function C() { const todosQuery = useQuery({ queryKey: ['todos'] }); return <Inner query={todosQuery} />; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the binding appears in a dependency array", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; function C() { const query = useQuery({ queryKey: ['user'] }); useEffect(() => { console.log(query.data); }, [query]); return query.data; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when console.log(query) mentions the binding", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function C() {
  const query = useQuery({ queryKey: ['user'] });
  console.log(query);
  return query.data;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the query is plainly destructured from the binding later", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; function C() { const query = useQuery({ queryKey: ['user'] }); const { data } = query; return data; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a custom hook returns { ...query } with an overridden field", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
export function useMetadata(options) {
  const query = useQuery({ queryKey: ['metadata'], ...options });
  return {
    ...query,
    isLoading: query.isLoading || isLoadingSources,
  };
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when an arrow-body custom hook forwards { ...query }", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
export const usePatterns = (config) => {
  const query = useQuery({ queryKey: ['patterns', config] });
  return { ...query, patterns: query.data ?? [] };
};`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags { ...query } spread into a non-returned object inside a hook", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
export function useChartConfig() {
  const query = useQuery({ queryKey: ['chart'] });
  const snapshot = { ...query, label: 'chart' };
  return snapshot.data;
}`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("still flags { ...query } returned from a plain component", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function buildViewModel() {
  const query = useQuery({ queryKey: ['rows'] });
  return { ...query, label: 'rows' };
}`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags a JSX spread behind a TS assertion", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function C() {
  const query = useQuery({ queryKey: ['user'] });
  return <Inner {...(query as UserQueryResult)} />;
}`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("does not flag a spread of a shadowed unrelated binding", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function C() {
  const query = useQuery({ queryKey: ['user'] });
  const buildPayload = () => {
    const query = buildSearchQuery();
    return { ...query };
  };
  return <button onClick={buildPayload}>{query.data}</button>;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("does not flag spreading an array unrelated to the query binding", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function C() {
  const query = useQuery({ queryKey: ['user'] });
  const items = [...(query.data ?? [])];
  return items.length;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("reports each enumerating reference of the same binding", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function C() {
  const query = useQuery({ queryKey: ['user'] });
  const snapshot = { ...query };
  return <Inner {...query} snapshot={snapshot} />;
}`,
    );
    expect(diagnostics).toHaveLength(2);
  });
});
